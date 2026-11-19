// launch-blockers check: reads a project on this computer and says BLOCKED, CLEAR or NOT CHECKED.
// The pattern-matching is Greenlit's project scan (greenlitlab, pinned). This file decides what blocks a launch
// and, just as important, says out loud what no file scan can see, so "CLEAR" never means more than it checked.
import fs from "node:fs";
import path from "node:path";
import { codeScan } from "greenlitlab/src/scan.mjs";

// Anything this serious stops the deploy. Medium and low are shown but don't block.
const BLOCKS = new Set(["critical", "high"]);

function listFiles(root, max = 4000) {
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", ".vercel", ".netlify", ".wrangler", "coverage"]);
  const out = [];
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {}
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) skip.has(e.name) || stack.push(full);
      else if (e.isFile()) out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return out;
}

export function check(dir = ".") {
  const root = path.resolve(dir);
  let scan;
  try {
    scan = codeScan(root);
  } catch (e) {
    return { status: "NOT CHECKED", dir: root, reason: e.message, blocking: [], other: [], notChecked: [] };
  }
  const files = listFiles(root);
  const notChecked = [];
  if (files.some((f) => /supabase|firebase|firestore|\.rules$/i.test(f))) {
    notChecked.push({ pattern: "live-db-differs", what: "Your live database", how: "Rules changed in the Supabase or Firebase console never show up in files. Check the live app: npx greenlitlab <your-app-url> --mine" });
  }
  notChecked.push({ pattern: "client-side-auth", what: "Who-can-see-what logic in your own code", how: "No pattern scan can judge this. The launch-blockers skill walks your agent through it." });

  if (scan.files === 0) return { status: "NOT CHECKED", dir: root, reason: "No code files were found here.", blocking: [], other: [], notChecked };
  const blocking = scan.findings.filter((f) => BLOCKS.has(f.severity));
  const other = scan.findings.filter((f) => !BLOCKS.has(f.severity));
  return { status: blocking.length ? "BLOCKED" : "CLEAR", dir: root, files: scan.files, blocking, other, notChecked };
}

export function render(r, { color = false } = {}) {
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const head = { BLOCKED: c("1;31", "BLOCKED"), CLEAR: c("1;32", "CLEAR"), "NOT CHECKED": c("1;33", "NOT CHECKED") }[r.status];
  const lines = [`launch-blockers · ${head}`, ""];
  if (r.reason) lines.push(`  ${r.reason}`, "");
  if (r.blocking.length) {
    lines.push(`${r.blocking.length} thing${r.blocking.length > 1 ? "s" : ""} to fix before you launch:`);
    r.blocking.forEach((f, i) => lines.push(``, `${i + 1}. ${f.title}  [${f.severity}]`, `   ${f.where}`, `   ${f.why}`, `   Fix prompt for your builder:`, `   ${c("2", f.prompt)}`));
    lines.push("");
  } else if (r.status === "CLEAR") lines.push(`Nothing in the ${r.files} files read matches a known leak pattern.`, "");
  if (r.other.length) lines.push(`Also worth a look (doesn't block): ${r.other.map((f) => f.title).join("; ")}`, "");
  if (r.notChecked.length) {
    lines.push("Not checked (CLEAR never covers these):");
    r.notChecked.forEach((n) => lines.push(`  - ${n.what}: ${n.how}`));
    lines.push("");
  }
  lines.push("Read on this computer; nothing was sent anywhere. Patterns: github.com/priberry-data/launch-blockers");
  return lines.join("\n");
}
