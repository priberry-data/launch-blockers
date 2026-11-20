// launch-blockers check: reads a project on this computer and says BLOCKED, CLEAR or NOT CHECKED.
// The pattern-matching is Greenlit's project scan (greenlitlab, pinned). This file decides what blocks a launch
// and, just as important, says out loud what no file scan can see, so "CLEAR" never means more than it checked.
import fs from "node:fs";
import path from "node:path";
import { codeScan } from "./scan.mjs";

// Anything this serious stops the deploy. Medium and low are shown but don't block.
const BLOCKS = new Set(["critical", "high"]);
export const SCHEMA = 2;
// A table that holds something about a person. Reading all of it, with no login, is the leak in the news.
const PEOPLE = /(^|_)(users?|profiles?|accounts?|customers?|members?|messages?|chats?|conversations?|orders?|payments?|invoices?|subscriptions?|contacts?|leads?|patients?|bookings?|appointments?|addresses|emails?|phones?|employees?|students?|applications?|applicants?|candidates?|documents?|uploads?|notes?|comments?|reviews?|sessions?|tokens?|keys?|secrets?|credentials?|passwords?|wallets?|transactions?|referrals?|signups?|waitlists?|registrations?|tickets?|feedback|surveys?|responses?|submissions?|kyc|verifications?|identities|ids|medical|health|records?|guests?|attendees?|clients?|tenants?|parents?|children|kids|drivers?|riders?|staff|teams?|organizations?|orgs?|companies)(_|$)/i;

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

// .launch-blockers-ignore: one finding per line, its id then the reason a person checked it, e.g.
//   scan:verify-jwt:stripe-webhook   signed webhook: verifies the Stripe-Signature header itself
// A line without a reason is ignored itself, so nothing gets waved through by accident. Ignored findings are always listed.
export const IGNORE_FILE = ".launch-blockers-ignore";
function readIgnores(root) {
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, IGNORE_FILE), "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.match(/^(\S+)\s+(.+)$/))
    .filter((m) => m && m[2].replace(/[\s.\-_*#x]/gi, "").length >= 8) // a reason, not padding
    .map((m) => ({ id: m[1], reason: m[2].trim() }));
}

export function check(dir = ".") {
  const root = path.resolve(dir);
  const shown = dir;
  let scan;
  try {
    scan = codeScan(root);
  } catch (e) {
    return { schema: SCHEMA, status: "NOT CHECKED", dir: shown, files: 0, reason: e.message, blocking: [], other: [], ignored: [], notChecked: [] };
  }
  const files = listFiles(root);
  const notChecked = [];
  if (files.some((f) => /supabase|firebase|firestore|\.rules$/i.test(f))) {
    notChecked.push({ pattern: "live-db-differs", what: "Your live database", how: "Rules changed in the Supabase or Firebase console never show up in files. Check the live app: npx greenlitlab <your-app-url> --mine" });
  }
  notChecked.push({ pattern: "client-side-auth", what: "Who-can-see-what logic in your own code", how: "No pattern scan can judge this. The launch-blockers skill walks your agent through it." });
  if (scan.gitUnavailable) notChecked.push({ pattern: "env-committed", what: "Whether a .env file is committed", how: "This folder isn't a git repository (or git isn't installed), so tracked files couldn't be listed." });

  const base = { schema: SCHEMA, dir: shown, files: scan.files };
  if (scan.files === 0) return { ...base, status: "NOT CHECKED", reason: "No code files were found here.", blocking: [], other: [], ignored: [], notChecked };
  // A partial read is not a clean read: say so instead of answering CLEAR for files that were never opened.
  if (scan.unread?.length) return { ...base, status: "NOT CHECKED", reason: `Some files that matter couldn't be read: ${scan.unread.slice(0, 5).join(", ")}${scan.unread.length > 5 ? ` and ${scan.unread.length - 5} more` : ""}.`, blocking: [], other: [], ignored: [], notChecked };
  if (scan.truncated) return { ...base, status: "NOT CHECKED", reason: `The project has more than ${scan.files} code files, which is more than one check reads. Run npx launch-blockers check on the app's own folder.`, blocking: [], other: [], ignored: [], notChecked };
  // A whole table readable by anyone is fine for products or courses and a leak for people's data: block those.
  const findings = [];
  for (const f of scan.findings) {
    if (f.id === "scan:public-read:everyone" && Array.isArray(f.tables)) {
      const people = f.tables.filter((t) => PEOPLE.test(t.table) || t.people);
      const rest = f.tables.filter((t) => !people.includes(t));
      for (const t of people)
        findings.push({ id: `lb:public-read:${t.table}`, severity: "high", where: t.where, title: `Anyone on the internet can read every row of "${t.table}"`, why: `A Row Level Security policy on "${t.table}" lets everyone read with the condition true, and the table looks like it holds information about people. This is the leak in CVE-2025-48757 and in the Moltbook incident.`, fix: "Limit reads to the row's owner (auth.uid() = the owner column), or to signed-in users who need it.", first: null, prompt: `In my database, the table "${t.table}" has a Row Level Security policy that lets anyone read every row (the condition is true). Tell me what personal information it holds. Then write a new migration that replaces that policy so a user can only read their own rows (auth.uid() = the owner column; add one if needed), or, if some fields must be public, move them to a separate public table or view. Don't edit old migrations. Show me the SQL.` });
      if (rest.length) findings.push({ ...f, tables: rest, title: `${rest.length} table${rest.length > 1 ? "s" : ""} can be read in full by everyone`, why: `${rest.map((t) => t.table).join(", ")}. Each has a policy whose condition is simply "true". That is fine for a public list such as products or courses, and a leak for anything about people.` });
      continue;
    }
    findings.push(f);
  }
  const ignores = readIgnores(root);
  const ignored = [];
  const live = [];
  for (const f of findings) {
    const rule = ignores.find((i) => i.id === f.id);
    if (rule) ignored.push({ ...f, reason: rule.reason });
    else live.push(f);
  }
  const blocking = live.filter((f) => BLOCKS.has(f.severity));
  const other = live.filter((f) => !BLOCKS.has(f.severity));
  return { ...base, status: blocking.length ? "BLOCKED" : "CLEAR", blocking, other, ignored, notChecked };
}

export function render(r, { color = false } = {}) {
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const safe = (s) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "?");
  r = JSON.parse(JSON.stringify(r), (k, v) => (typeof v === "string" ? safe(v) : v));
  const head = { BLOCKED: c("1;31", "BLOCKED"), CLEAR: c("1;32", "CLEAR"), "NOT CHECKED": c("1;33", "NOT CHECKED") }[r.status];
  const lines = [`launch-blockers · ${head}`, ""];
  if (r.reason) lines.push(`  ${r.reason}`, "");
  if (r.blocking.length) {
    lines.push(`${r.blocking.length} thing${r.blocking.length > 1 ? "s" : ""} to fix before you launch:`);
    r.blocking.forEach((f, i) => lines.push(``, `${i + 1}. ${f.title}  [${f.severity}]`, `   ${f.where}`, `   ${f.why}`, `   Fix prompt for your builder:`, `   ${c("2", f.prompt)}`));
    lines.push("", `Checked one yourself and it's fine (say, RLS turned on in the dashboard)? Add a line to ${IGNORE_FILE}: its id from the list below, then why. Only a person should do this, never an agent.`, ...r.blocking.map((f) => `   ${f.id}`), "");
  } else if (r.status === "CLEAR") lines.push(`Nothing in the ${r.files} files read matches a known leak pattern.`, "");
  if (r.ignored?.length) lines.push(`Ignored by you in ${IGNORE_FILE}:`, ...r.ignored.map((f) => `  - ${f.title} (${f.id}): ${f.reason}`), "");
  if (r.other.length) lines.push(`Also worth a look (doesn't block): ${r.other.map((f) => f.title).join("; ")}`, "");
  if (r.notChecked.length) {
    lines.push("Not checked (CLEAR never covers these):");
    r.notChecked.forEach((n) => lines.push(`  - ${n.what}: ${n.how}`));
    lines.push("");
  }
  lines.push("Read on this computer; your code wasn't sent anywhere. Patterns: github.com/priberry-data/launch-blockers");
  return lines.join("\n");
}
