import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "launch-blockers.mjs");
const copy = (sample) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-"));
  fs.cpSync(path.join(ROOT, "samples", sample), dir, { recursive: true });
  return dir;
};
const install = (dir) => execFileSync("node", [BIN, "install", dir], { encoding: "utf8" });
// Calls the installed guard exactly as Claude Code does: hook JSON on stdin, decision JSON on stdout.
const hook = (dir, command, tool = "Bash") => {
  const r = spawnSync("node", [path.join(dir, ".claude", "hooks", "launch-blockers-guard.mjs")], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: { command }, cwd: dir }),
    encoding: "utf8",
    env: { ...process.env, LAUNCH_BLOCKERS_CMD: `node ${BIN}` },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
};
const decision = (o) => o?.hookSpecificOutput?.permissionDecision ?? null;

test("check: exit codes and statuses for leaky, clean, Firebase and missing projects", () => {
  const run = (p) => spawnSync("node", [BIN, "check", p, "--json"], { encoding: "utf8" });
  const leaky = run(path.join(ROOT, "samples", "leaky"));
  assert.equal(leaky.status, 1);
  assert.equal(JSON.parse(leaky.stdout).status, "BLOCKED");
  const clean = run(path.join(ROOT, "samples", "clean"));
  assert.equal(clean.status, 0);
  assert.equal(JSON.parse(clean.stdout).status, "CLEAR");
  assert.ok(JSON.parse(clean.stdout).notChecked.length >= 1, "CLEAR always says what it didn't check");
  const fb = JSON.parse(run(path.join(ROOT, "samples", "firebase")).stdout);
  assert.equal(fb.status, "BLOCKED");
  assert.ok(fb.blocking.some((f) => f.id.startsWith("scan:firebase-open:")));
  const missing = run(path.join(ROOT, "samples", "does-not-exist"));
  assert.equal(missing.status, 3);
  assert.equal(JSON.parse(missing.stdout).status, "NOT CHECKED");
});

test("guard: a deploy of a leaky project is refused, with the fix prompts", () => {
  const dir = copy("leaky");
  install(dir);
  for (const cmd of ["vercel --prod", "npx vercel deploy", "supabase db push", "firebase deploy --only hosting", "npm run deploy", "cd web && netlify deploy --prod"]) {
    const o = hook(dir, cmd);
    assert.equal(decision(o), "deny", cmd);
    assert.match(o.hookSpecificOutput.permissionDecisionReason, /VITE_OPENAI_API_KEY/);
  }
  fs.rmSync(dir, { recursive: true });
});

test("guard: ordinary commands, other tools and a clean deploy pass untouched", () => {
  const leaky = copy("leaky");
  install(leaky);
  for (const cmd of ["npm test", "vercel env pull", "vercel login", "git push", "ls supabase"]) assert.equal(hook(leaky, cmd), null, cmd);
  assert.equal(hook(leaky, "vercel --prod", "Read"), null, "only shell commands are looked at");
  const clean = copy("clean");
  install(clean);
  const o = hook(clean, "vercel --prod");
  assert.equal(decision(o), null, "CLEAR never grants permission by itself");
  assert.match(o.systemMessage, /CLEAR/);
  assert.match(o.systemMessage, /Not checked/);
  fs.rmSync(leaky, { recursive: true });
  fs.rmSync(clean, { recursive: true });
});

test("guard: when the check can't run, you're asked; it never passes silently", () => {
  const dir = copy("clean");
  install(dir);
  const r = spawnSync("node", [path.join(dir, ".claude", "hooks", "launch-blockers-guard.mjs")], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "vercel --prod" }, cwd: dir }),
    encoding: "utf8",
    env: { ...process.env, LAUNCH_BLOCKERS_CMD: "node /nonexistent/launch-blockers.mjs" },
  });
  assert.equal(decision(JSON.parse(r.stdout)), "ask");
  fs.rmSync(dir, { recursive: true });
});

test("install: adds to existing settings without touching them, and only once", () => {
  const dir = copy("clean");
  fs.mkdirSync(path.join(dir, ".claude"));
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash(npm test)"] }, hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo hi" }] }] } }));
  install(dir);
  install(dir);
  const s = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(s.permissions, { allow: ["Bash(npm test)"] });
  assert.equal(s.hooks.PreToolUse.length, 2);
  assert.ok(fs.existsSync(path.join(dir, ".claude", "skills", "launch-blockers", "SKILL.md")));
  const guard = fs.readFileSync(path.join(dir, ".claude", "hooks", "launch-blockers-guard.mjs"), "utf8");
  assert.ok(!guard.includes("__VERSION__"), "the guard is pinned to this version");
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), "{ not json");
  assert.throws(() => install(dir), /isn't valid JSON/);
  fs.rmSync(dir, { recursive: true });
});

test("data: every pattern has a source, a fix prompt and an honest detection field; the README count matches", () => {
  const { patterns } = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "patterns.json"), "utf8"));
  const ids = new Set();
  for (const p of patterns) {
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`);
    ids.add(p.id);
    assert.ok(["scan", "agent-review", "outside-check"].includes(p.detection), p.id);
    assert.ok(p.incidents.length + p.rules.length > 0, `${p.id} needs a dated incident or an official rule`);
    for (const s of [...p.incidents, ...p.rules]) assert.match(s.source_url, /^https:\/\//, p.id);
    assert.ok(p.fix_prompt.length > 80, p.id);
  }
  for (const f of ["README.md", "PLAYBOOK.md", "skill/launch-blockers/SKILL.md"]) {
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(text.includes(`${patterns.length} `), `${f} states the real count (${patterns.length})`);
  }
});
