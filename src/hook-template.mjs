#!/usr/bin/env node
// launch-blockers guard for Claude Code (installed by `npx launch-blockers install`).
// Runs before every shell command the agent wants to run. Anything that isn't a deploy passes straight through
// in a few milliseconds. A deploy first gets a launch-blockers check of this project:
//   BLOCKED     -> the deploy is refused, with the reasons and fix prompts handed to the agent
//   NOT CHECKED -> you're asked whether to deploy anyway (the check couldn't run, so nothing passed)
//   CLEAR       -> nothing changes (your usual approval still applies), plus a note of what a file scan can't see
import { execFileSync } from "node:child_process";

const VERSION = "__VERSION__";
// A command counts as a deploy only when the deploy tool is the program being run, not text inside it:
// `git commit -m "firebase deploy"`, `cat vercel.json` and `npm i vercel` are not deploys.
const WRAPPERS = new Set(["npx", "bunx", "sudo", "env", "time", "exec"]);
function isDeploy(command) {
  // A command handed to a shell (bash -c "...") is checked as a command of its own.
  for (const m of command.matchAll(/\b(?:ba|z)?sh\s+-c\s+(["'])((?:(?!\1).)*)\1/g)) if (isDeploy(m[2])) return true;
  // Quoted text is data (a commit message, an echo), never a command: blank it before reading.
  command = command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
  for (const seg of command.split(/&&|\|\||[;|\n&()]/)) {
    let t = seg.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/^["']|["']$/g, ""));
    let wrapped = false;
    while (t.length) {
      if (/^\w+=/.test(t[0]) || WRAPPERS.has(t[0])) (t.shift(), (wrapped = true));
      else if (wrapped && /^-/.test(t[0])) t.shift(); // a wrapper's own flags, like npx -y
      else break;
    }
    if (["pnpm", "yarn"].includes(t[0]) && t[1] === "dlx") t = t.slice(2);
    if (t[0] === "npm" && t[1] === "exec") t = t.slice(2).filter((w) => w !== "--");
    const [prog, a, b] = [t[0]?.split("/").pop(), t[1], t[2]];
    if (!prog) continue;
    if (prog === "vercel" && (a === undefined || a === "deploy" || a === "--prod" || a?.startsWith("-") && t.includes("--prod"))) return true;
    if (prog === "netlify" && a === "deploy") return true;
    if (prog === "supabase" && ((a === "db" && b === "push") || (a === "functions" && b === "deploy"))) return true;
    if (prog === "firebase" && a === "deploy") return true;
    if (prog === "wrangler" && (a === "deploy" || (a === "pages" && b === "deploy"))) return true;
    if ((prog === "fly" || prog === "flyctl") && a === "deploy") return true;
    if (prog === "railway" && a === "up") return true;
    if (["npm", "pnpm", "yarn", "bun"].includes(prog) && ((a === "run" && b === "deploy") || (prog === "yarn" && a === "deploy"))) return true;
  }
  return false;
}

const out = (decision, reason, note) =>
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason }, ...(note ? { systemMessage: note } : {}) }));

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
let input = {};
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0); // not something we understand: stay out of the way
}
const command = input?.tool_input?.command;
if (input?.tool_name !== "Bash" || typeof command !== "string" || !isDeploy(command)) process.exit(0);

const cwd = input.cwd || process.cwd();
let result;
try {
  const [bin, ...args] = process.env.LAUNCH_BLOCKERS_CMD ? process.env.LAUNCH_BLOCKERS_CMD.split(" ") : ["npx", "-y", `launch-blockers@${VERSION}`];
  let text;
  try {
    text = execFileSync(bin, [...args, "check", cwd, "--json"], { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    // check exits 1 for BLOCKED and 3 for NOT CHECKED; the JSON on stdout is still the answer.
    if (e.status !== 1 && e.status !== 3) throw e;
    text = e.stdout;
  }
  result = JSON.parse(text);
  if (!["BLOCKED", "CLEAR", "NOT CHECKED"].includes(result.status)) throw new Error("unexpected answer from the check");
} catch (e) {
  out("ask", `launch-blockers couldn't check this project before the deploy (${String(e.message).split("\n")[0].slice(0, 160)}). Nothing was checked, so nothing passed. Deploy anyway?`);
  process.exit(0);
}

if (result.status === "BLOCKED") {
  const list = result.blocking.map((f, i) => `${i + 1}. ${f.title} (${f.where})\n   Fix: ${f.prompt}`).join("\n");
  out("deny", `launch-blockers stopped this deploy: ${result.blocking.length} way${result.blocking.length > 1 ? "s" : ""} this app can leak data.\n${list}\nFix these, then deploy again. Run \`npx launch-blockers check\` to see the full report.`);
} else if (result.status === "NOT CHECKED") {
  out("ask", `launch-blockers couldn't check this project (${result.reason}). Nothing was checked, so nothing passed. Deploy anyway?`);
} else {
  const gaps = result.notChecked.map((n) => n.what).join("; ");
  // No permission decision here: a clear check must never skip the approval you'd normally be asked for.
  process.stdout.write(JSON.stringify({ systemMessage: `launch-blockers: CLEAR for the ${result.files} files read. Not checked: ${gaps}.` }));
}
