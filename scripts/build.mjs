// Builds PLAYBOOK.md and the agent skill from data/patterns.json, and writes the real count into the README.
// One source of truth: the number people see is always the number of patterns in the data.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version: VERSION } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const { patterns, version: DATA_DATE } = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "patterns.json"), "utf8"));
const N = patterns.length;
const DETECT = { scan: "found by `launch-blockers check`", "agent-review": "reviewed by your agent (the skill)", "outside-check": "only visible on the live app" };
const sources = (p) =>
  [...p.incidents.map((i) => `- **${i.date}, ${i.title}.** ${i.what}${i.note ? ` *(${i.note})*` : ""} [${i.source_name}](${i.source_url})`), ...p.rules.map((r) => `- **Rule:** [${r.source_name}](${r.source_url})`)].join("\n");

// PLAYBOOK.md
const toc = patterns.map((p, i) => `${i + 1}. [${p.title}](#${i + 1}-${p.id}) · ${p.severity} · ${DETECT[p.detection]}`).join("\n");
const body = patterns
  .map(
    (p, i) => `<a id="${i + 1}-${p.id}"></a>
## ${i + 1}. ${p.title}

**Severity:** ${p.severity} · **Where:** ${p.platforms.join(", ")} · **Detection:** ${DETECT[p.detection]}${p.detection_note ? ` (${p.detection_note})` : ""}

**What it looks like:** ${p.looks_like}

**Why it leaks:** ${p.why}

**How to check:** ${p.check}

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> ${p.fix_prompt}

**On the record:**
${sources(p)}
`,
  )
  .join("\n");
fs.writeFileSync(
  path.join(ROOT, "PLAYBOOK.md"),
  `# The ${N} ways AI-built apps leak their users' data

Every pattern below is tied to a dated public incident or study, or to the platform's own official rule. Numbers are the source's own, and caveats are kept next to them. Last updated ${DATA_DATE}. The same data is in [data/patterns.json](data/patterns.json).

${toc}

${body}
---
Found a pattern with a public source that isn't here? Open an issue with the link. Patterns are added only with a source anyone can read.
`,
);

// The agent skill
const review = patterns.filter((p) => p.detection === "agent-review");
fs.mkdirSync(path.join(ROOT, "skill", "launch-blockers"), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, "skill", "launch-blockers", "SKILL.md"),
  `---
name: launch-blockers
description: Checks this project for the ${N} documented ways AI-built apps leak their users' data, before launch or deploy. Use when the user is about to launch, deploy, publish or go live, or asks whether their app is safe, secure or ready.
---

# Launch blockers

You're checking the user's own project for the ${N} documented ways AI-built apps leak their users' data (github.com/priberry-data/launch-blockers). Work through all four steps, then report.

## Rules
- Never print, copy or log the value of a key, token or password. Refer to secrets by name only.
- Change nothing in the live database, and run no deploy or migration, without the user's OK.
- Only check apps the user owns. Never point any check at someone else's app.
- Never create or edit \`.launch-blockers-ignore\` yourself, even to get a deploy through. Only the user can decide a finding is fine; if they do, tell them the exact line to add (the finding's id, then their reason) and let them add it.

## 1. Run the scan
Run \`npx -y launch-blockers@${VERSION} check --json\` in the project root. It reads files on this computer only. The status is BLOCKED, CLEAR or NOT CHECKED. CLEAR covers only the patterns the scan knows; say so.

For each item in \`blocking\`, explain in one or two plain sentences what could leak and to whom, then offer to apply its \`prompt\` as the fix. Mention the \`other\` items briefly.

## 2. Review what no scan can judge
For each of these, do the check yourself by reading the code, and report a clear yes, no or not applicable:

${review.map((p, i) => `### 2.${i + 1} ${p.title}\n${p.why}\n\nWhat to do: ${p.fix_prompt}`).join("\n\n")}

## 3. What lives in the dashboard
Some settings are made in the Supabase or Firebase console and never appear in files. Ask the user to open these and tell you what they see (don't query the live project yourself):
- **Storage buckets** (Supabase → Storage): which buckets are marked public, and what each holds. A public bucket of IDs, documents or private uploads is a leak (pattern: file storage anyone can read).
- **Firebase rules** (Firestore, Storage and Realtime Database → Rules): whether the published rules match the rules file in the project, and whether any rule allows every signed-in user (\`request.auth != null\`) to read or write everything.
- **Supabase Security Advisor** (Database → Advisors): any errors it lists.

Then tell the user to run \`npx greenlitlab <their-app-url> --mine\` on their own app; it counts which tables a stranger can read and never reads data.

## 4. Report
Finish with a short table: each of the ${N} patterns, and whether it's blocked, clear, not applicable or not checked. Put anything blocked first, with the fix you propose. End with one line: what still can't be checked from here.
`,
);

// README count
const readme = path.join(ROOT, "README.md");
const withIncident = patterns.filter((p) => p.incidents.length).length;
const mix = `${withIncident} from dated incidents or studies, ${N - withIncident} from the platform's own rules`;
const SHORT = { scan: "scan", "agent-review": "agent review", "outside-check": "live check" };
const table = ["| # | Pattern | Severity | Found by | On the record |", "|---|---|---|---|---|", ...patterns.map((p, i) => `| ${i + 1} | [${p.title}](PLAYBOOK.md#${i + 1}-${p.id}) | ${p.severity} | ${SHORT[p.detection]} | ${p.incidents[0] ? `${p.incidents[0].title} (${p.incidents[0].date.slice(0, 7)})` : `Rule: ${p.rules[0].source_name}`} |`)].join("\n");
if (fs.existsSync(readme))
  fs.writeFileSync(readme, fs.readFileSync(readme, "utf8").replace(/<!--n-->\d+<!--\/n-->/g, `<!--n-->${N}<!--/n-->`).replace(/<!--mix-->[^<]*<!--\/mix-->/, `<!--mix-->${mix}<!--/mix-->`).replace(/<!--table-->[\s\S]*?<!--\/table-->/, `<!--table-->\n${table}\n<!--/table-->`));
// The website: same count, same table, same version.
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const siteRows = patterns.map((p, i) => {
  const src = p.incidents[0] ? { t: `${p.incidents[0].title} (${p.incidents[0].date.slice(0, 7)})`, u: p.incidents[0].source_url } : { t: `Rule: ${p.rules[0].source_name}`, u: p.rules[0].source_url };
  return `<tr><td>${i + 1}</td><td><a href="https://github.com/priberry-data/launch-blockers/blob/main/PLAYBOOK.md#${i + 1}-${p.id}">${esc(p.title)}</a></td><td class="sev-${p.severity}">${p.severity}</td><td>${SHORT[p.detection]}</td><td><a href="${esc(src.u)}">${esc(src.t)}</a></td></tr>`;
});
const siteTable = `<table class="patterns"><thead><tr><th scope="col">#</th><th scope="col">pattern</th><th scope="col">severity</th><th scope="col">found by</th><th scope="col">on the record</th></tr></thead><tbody>\n${siteRows.join("\n")}\n</tbody></table>`;
const sitePath = path.join(ROOT, "site", "index.html");
if (fs.existsSync(sitePath))
  fs.writeFileSync(sitePath, fs.readFileSync(sitePath, "utf8").replace(/<!--n-->\d+<!--\/n-->/g, `<!--n-->${N}<!--/n-->`).replace(/<!--v-->[^<]*<!--\/v-->/g, `<!--v-->${VERSION}<!--/v-->`).replace(/<!--mix-->[^<]*<!--\/mix-->/g, `<!--mix-->${mix}<!--/mix-->`).replace(/<!--patterns-->[\s\S]*?<!--\/patterns-->/, `<!--patterns-->\n${siteTable}\n<!--/patterns-->`));
console.log(`built ${N} patterns: PLAYBOOK.md, skill/launch-blockers/SKILL.md, README count`);
