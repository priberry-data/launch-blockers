#!/usr/bin/env node
// launch-blockers deploy guard for Claude Code (installed by `npx launch-blockers install`).
// Claude Code runs it before every shell command, and before MCP tools that deploy. Anything that isn't a deploy
// passes in a few milliseconds. A deploy first gets a launch-blockers check of the folder being deployed:
//   BLOCKED     -> the deploy is refused, with the reasons and fix prompts handed to the agent
//   NOT CHECKED -> you're asked (the check couldn't run, so nothing passed)
//   CLEAR       -> nothing changes: your usual approval still applies, plus a note of what wasn't checked
// The check runs from the copy installed next to this file. Nothing is downloaded and nothing leaves this computer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classify } from "./classify.mjs";

const VERSION = "__VERSION__";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERIOUS = new Set(["critical", "high"]);
const CANT_PROMPT = new Set(["bypassPermissions", "dontAsk"]);

const clean = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").slice(0, 300);
const emit = (o) => process.stdout.write(JSON.stringify(o));
const decide = (decision, reason, note) => emit({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason }, ...(note ? { systemMessage: note } : {}) });

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0); // not a hook call we understand
}
const tool = String(input?.tool_name ?? "");
const cwd = typeof input?.cwd === "string" && input.cwd ? input.cwd : process.cwd();
// When nobody can answer a question, a question is the same as a yes. Refuse instead.
const ask = (reason) => (CANT_PROMPT.has(input?.permission_mode) ? decide("deny", `${reason}\n(You can't be asked in this permission mode, so the deploy is held. Run it yourself if you're sure.)`) : decide("ask", reason));

let deploys = [];
let maybe = [];
if (tool === "Bash") {
  const command = input?.tool_input?.command;
  if (typeof command !== "string") process.exit(0);
  try {
    ({ deploys, maybe } = classify(command, cwd));
  } catch (e) {
    maybe = [`the command couldn't be read (${clean(e.message)})`];
  }
} else if (/^mcp__/.test(tool) && /deploy|publish|promote|release|go_live|golive/i.test(tool)) {
  deploys = [{ kind: tool, dir: cwd }];
} else process.exit(0);
if (!deploys.length && !maybe.length) process.exit(0);

// Check the whole project the deploy comes from: the folder itself, up to its git root, so migrations and a
// committed .env at the top of a repo count even when the deploy runs in a subfolder.
function projectRoot(dir) {
  let d = path.resolve(dir);
  while (!fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d); // `cd web; vercel` runs here if web is missing
  try {
    const top = execFileSync("git", ["-C", d, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
    if (top && top !== os.homedir()) return top;
  } catch {}
  return d;
}
const roots = [...new Set((deploys.length ? deploys : [{ dir: cwd }]).map((d) => projectRoot(d.dir)))];

const results = [];
for (const root of roots) {
  try {
    const text = execFileSync(process.execPath, [path.join(HERE, "run-check.mjs"), root], { encoding: "utf8", timeout: 60000, maxBuffer: 64 * 1024 * 1024, cwd: os.tmpdir(), stdio: ["ignore", "pipe", "pipe"] });
    const r = JSON.parse(text);
    if (!["BLOCKED", "CLEAR", "NOT CHECKED"].includes(r.status)) throw new Error("unexpected answer from the check");
    results.push(r);
  } catch (e) {
    results.push({ status: "NOT CHECKED", dir: root, reason: `the check didn't finish: ${clean(String(e.message).split("\n")[0]).slice(0, 160)}`, blocking: [], ignored: [], notChecked: [] });
  }
}

const what = deploys.length ? [...new Set(deploys.map((d) => d.kind))].join(", ") : "this command";
const sure = deploys.some((d) => !d.soft);
const blocking = results.flatMap((r) => r.blocking);
const ignoredSerious = results.flatMap((r) => (r.ignored || []).filter((f) => SERIOUS.has(f.severity)));
const notChecked = results.filter((r) => r.status === "NOT CHECKED");
const list = (fs_) => fs_.map((f, i) => `${i + 1}. ${clean(f.title)} [${f.severity}] (${clean(f.where)})\n   Fix: ${clean(f.prompt).slice(0, 600)}`).join("\n");
const NO_SELF_IGNORE = "Don't add these to .launch-blockers-ignore yourself: only the user can decide a finding is fine.";

if (blocking.length) {
  const head = `launch-blockers found ${blocking.length} way${blocking.length > 1 ? "s" : ""} this app can leak data, so ${what} is held.`;
  const body = `${list(blocking)}\nFix these, then try again. Full report: npx launch-blockers check. ${NO_SELF_IGNORE}`;
  if (sure) decide("deny", `${head}\n${body}`);
  // A git push that may or may not deploy, or a command we couldn't fully read: ask rather than refuse.
  else ask(`${head} (${deploys.length ? "This push may deploy if your host deploys from git." : `It may deploy: ${maybe.join("; ")}.`})\n${body}\nGo ahead anyway?`);
} else if (notChecked.length) {
  ask(`launch-blockers couldn't check this project before ${what}: ${notChecked.map((r) => clean(r.reason)).join("; ")}. Nothing was checked, so nothing passed. Go ahead anyway?`);
} else if (ignoredSerious.length) {
  ask(`launch-blockers: CLEAR, but only because these serious findings are ignored in .launch-blockers-ignore:\n${ignoredSerious.map((f) => `- ${clean(f.title)} [${f.severity}] (${clean(f.id)}): "${clean(f.reason)}"`).join("\n")}\nDeploy with these ignored?`);
} else {
  const r = results[0];
  const gaps = [...new Set(results.flatMap((x) => x.notChecked.map((n) => n.what)))].join("; ");
  const ign = results.flatMap((x) => x.ignored || []);
  // No permission decision: a clear check never skips the approval you'd normally be asked for.
  emit({ systemMessage: `launch-blockers ${VERSION}: CLEAR for the ${r.files ?? 0} files read before ${what}.${ign.length ? ` Ignored by you: ${ign.map((f) => clean(f.id)).join(", ")}.` : ""}${maybe.length && !deploys.length ? ` (Checked because ${maybe.join("; ")}.)` : ""} Not checked: ${gaps}.` });
}
