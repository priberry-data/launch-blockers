// launch-blockers install: adds the skill and the deploy guard to Claude Code, for this project (default) or for
// every project (--global). It only adds; anything already in your settings stays as it was.
// The guard and the check it runs are copied in whole, so a deploy never downloads anything and a package planted
// in the project's node_modules can't answer for it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = "launch-blockers"; // .claude/hooks/launch-blockers/
const OLD_HOOK_FILE = "launch-blockers-guard.mjs"; // 0.1.0 installed a single file that ran npx
const MATCHER = "Bash|mcp__.*";
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function scanSource() {
  // The real scanner file from the pinned greenlitlab, wherever npm put it.
  const require = createRequire(import.meta.url);
  const pkg = require.resolve("greenlitlab/package.json");
  return path.join(path.dirname(pkg), "src", "scan.mjs");
}

export function install({ global = false, dir = ".", version }) {
  const project = path.resolve(dir);
  const base = global ? path.join(os.homedir(), ".claude") : path.join(project, ".claude");
  const settingsPath = path.join(base, "settings.json");

  // 1. Read and validate the settings before writing anything, so a refusal leaves no half-install behind.
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      throw new Error(`${settingsPath} isn't valid JSON, so nothing was changed. Fix it and run install again.`);
    }
  }
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(settings)) throw new Error(`${settingsPath} isn't a JSON object, so nothing was changed. Fix it and run install again.`);
  if (settings.hooks !== undefined && !isObj(settings.hooks)) throw new Error(`"hooks" in ${settingsPath} isn't an object, so nothing was changed.`);
  if (settings.hooks?.PreToolUse !== undefined && !Array.isArray(settings.hooks.PreToolUse)) throw new Error(`"hooks.PreToolUse" in ${settingsPath} isn't a list, so nothing was changed.`);

  const done = [];
  // 2. The skill, for Claude Code and for agents that read .agents/skills (Codex, Cursor, Gemini CLI, Copilot).
  const skillText = fs.readFileSync(path.join(ROOT, "skill", "launch-blockers", "SKILL.md"), "utf8");
  for (const skillBase of [path.join(base, "skills"), global ? path.join(os.homedir(), ".agents", "skills") : path.join(project, ".agents", "skills")]) {
    const skillDir = path.join(skillBase, "launch-blockers");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillText);
    done.push(`skill: ${path.join(skillDir, "SKILL.md")}`);
  }

  // 3. The guard and everything it needs, in one folder.
  const hookDir = path.join(base, "hooks", BUNDLE);
  fs.mkdirSync(hookDir, { recursive: true });
  for (const f of ["classify.mjs", "check.mjs", "run-check.mjs"]) fs.copyFileSync(path.join(ROOT, "src", f), path.join(hookDir, f));
  fs.copyFileSync(scanSource(), path.join(hookDir, "scan.mjs"));
  fs.writeFileSync(path.join(hookDir, "guard.mjs"), fs.readFileSync(path.join(ROOT, "src", "guard.mjs"), "utf8").replace("__VERSION__", version), { mode: 0o755 });
  fs.writeFileSync(path.join(hookDir, "VERSION"), `${version}\n`);
  const oldFile = path.join(base, "hooks", OLD_HOOK_FILE);
  if (fs.existsSync(oldFile)) fs.rmSync(oldFile);
  done.push(`guard: ${hookDir}/guard.mjs (with its own copy of the check; nothing is downloaded at deploy time)`);

  // 4. The setting. If node can't run, the command is held (exit 2) rather than let through.
  const held = `{ echo 'launch-blockers: the deploy guard could not run (is node on PATH?), so this command is held. To turn the guard off, remove its entry from .claude/settings.json.' >&2; exit 2; }`;
  const guardPath = global ? shq(path.join(hookDir, "guard.mjs")) : `"$CLAUDE_PROJECT_DIR/.claude/hooks/${BUNDLE}/guard.mjs"`;
  // A global install lives in your home folder, so it can remember where node is; a project install is shared, so it can't.
  const node = global ? `"$(command -v node || echo ${shq(process.execPath)})"` : "node";
  const command = `${node} ${guardPath} || ${held}`;

  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];
  const ours = (h) => typeof h?.command === "string" && (h.command === command || /^node "[^"]*launch-blockers-guard\.mjs"$/.test(h.command) || h.command.includes(`/hooks/${BUNDLE}/guard.mjs`));
  let replaced = false;
  for (const m of settings.hooks.PreToolUse) {
    if (!isObj(m) || !Array.isArray(m.hooks)) continue;
    const before = m.hooks.length;
    m.hooks = m.hooks.filter((h) => !ours(h));
    if (m.hooks.length !== before) replaced = true;
  }
  settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((m) => !isObj(m) || !Array.isArray(m.hooks) || m.hooks.length);
  settings.hooks.PreToolUse.push({ matcher: MATCHER, hooks: [{ type: "command", command, timeout: 120 }] });
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  done.push(`setting: ${replaced ? "updated" : "added"} the PreToolUse hook in ${settingsPath}`);
  return done;
}
