// launch-blockers install: adds the skill and the deploy guard to Claude Code, for this project (default) or for
// every project (--global). It only adds; anything already in your settings stays as it was.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK_FILE = "launch-blockers-guard.mjs";

export function install({ global = false, dir = ".", version }) {
  const base = global ? path.join(os.homedir(), ".claude") : path.join(path.resolve(dir), ".claude");
  const done = [];

  const skillDir = path.join(base, "skills", "launch-blockers");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "skill", "launch-blockers", "SKILL.md"), path.join(skillDir, "SKILL.md"));
  done.push(`skill: ${skillDir}/SKILL.md`);

  const hookDir = path.join(base, "hooks");
  fs.mkdirSync(hookDir, { recursive: true });
  const hookPath = path.join(hookDir, HOOK_FILE);
  fs.writeFileSync(hookPath, fs.readFileSync(path.join(ROOT, "src", "hook-template.mjs"), "utf8").replace("__VERSION__", version), { mode: 0o755 });
  done.push(`guard: ${hookPath}`);

  const settingsPath = path.join(base, global ? "settings.json" : "settings.json");
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      throw new Error(`${settingsPath} isn't valid JSON, so nothing was changed in it. Fix it and run install again.`);
    }
  }
  // Project installs use a path relative to the project, so the setting works for everyone who clones it.
  const command = global ? `node "${hookPath}"` : `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${HOOK_FILE}"`;
  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];
  const already = settings.hooks.PreToolUse.some((m) => (m.hooks || []).some((h) => typeof h.command === "string" && h.command.includes(HOOK_FILE)));
  if (!already) {
    settings.hooks.PreToolUse.push({ matcher: "Bash", hooks: [{ type: "command", command, timeout: 90 }] });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    done.push(`setting: PreToolUse hook added to ${settingsPath}`);
  } else done.push(`setting: already in ${settingsPath}`);
  return done;
}
