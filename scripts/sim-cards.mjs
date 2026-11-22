// Builds one share card and one share page per real leak in simulator/cases.js:
//   brand/og-case-<id>.html  → simulator/og-<id>.png   (rendered with headless Chrome, 1200x630)
//   simulator/case/<id>/index.html                       (its own preview card, then opens the replay)
// A link to the simulator with #case=… can't carry its own preview, because crawlers never see the part after #.
// Run after `npm run sim`. Pass --no-render to write the pages without re-rendering the PNGs.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://greenlit.priberry.com/blockers/simulator/";
const load = (f, key) => {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "simulator", f), "utf8"), ctx);
  return ctx.window[key];
};
const CASES = load("cases.js", "CASES");
const P = load("patterns.js", "PATTERNS");
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const day = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "google-chrome", "chromium"].find((c) => !c.startsWith("/") || fs.existsSync(c));
const render = !process.argv.includes("--no-render");

for (const [id, c] of Object.entries(CASES)) {
  const inc = (P[c.pattern]?.incidents || []).find((i) => i.title.includes(c.match));
  if (!inc) throw new Error(`case ${id}: no incident matching "${c.match}" in pattern ${c.pattern}`);
  const record = `${day(inc.date)} · ${inc.name}`;

  // The card: the public number first, then where it's from.
  const card = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:M;src:url(../site/fonts/plex-mono-400.woff2)}@font-face{font-family:M;src:url(../site/fonts/plex-mono-600.woff2);font-weight:600}
html,body{margin:0;width:1200px;height:630px;background:#0B0606;color:#F4DCD6;font-family:M,monospace;overflow:hidden}
.w{padding:52px 64px;position:relative;height:100%;box-sizing:border-box}
.k{color:#A27770;font-size:22px}
.k b{color:#FF9F40;font-weight:600}
h1{margin:22px 0 26px;font-size:${c.headline.length > 70 ? 50 : 56}px;line-height:1.16;font-weight:600;color:#FF5A4E;text-shadow:0 0 14px rgba(255,90,78,.45);max-width:1060px}
.r{font-size:24px;color:#F4DCD6;max-width:1060px}
.r span{color:#A27770}
.c{position:absolute;left:64px;bottom:96px;font-size:24px;color:#7CE38B}
.f{position:absolute;right:64px;bottom:44px;font-size:22px;color:#A27770}
body::after{content:"";position:fixed;inset:0;background:repeating-linear-gradient(to bottom,transparent 0 2px,rgba(0,0,0,.18) 2px 3px)}
</style></head><body><div class="w">
<div class="k"><b>▶ replay a real leak</b> · leak simulator · launch blockers</div>
<h1>${esc(cap(c.headline))}.</h1>
<div class="r">${esc(cap(c.label))}<br><span>on the record: ${esc(record)}</span></div>
<div class="c">replay the setting · watch it leak · get the fix</div>
<div class="f">greenlit.priberry.com/blockers/simulator</div>
</div></body></html>
`;
  const cardFile = path.join(ROOT, "brand", `og-case-${id}.html`);
  fs.writeFileSync(cardFile, card);
  if (render) {
    if (!CHROME) throw new Error("No Chrome found to render the cards. Rerun with --no-render to keep the existing PNGs.");
    const png = path.join(ROOT, "simulator", `og-${id}.png`);
    const r = spawnSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1200,630", `--screenshot=${png}`, `file://${cardFile}`], { encoding: "utf8", timeout: 60000 });
    if (r.status !== 0 || !fs.existsSync(png)) throw new Error(`rendering ${id} failed: ${r.stderr}`);
  }

  // The share page: its own preview card, then straight into the replay.
  const target = `../../#v=1&case=${id}`;
  const title = `Replay a real leak: ${c.label}`;
  const desc = `${cap(c.headline)} (${record}). Replay the setting on a pretend app, watch it leak, and get the fix prompt.`;
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · leak simulator</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${SITE}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}case/${id}/">
<meta property="og:image" content="${SITE}og-${id}.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE}og-${id}.png">
<meta http-equiv="refresh" content="0;url=${target}">
<link rel="icon" href="../../../brand/icon.svg" type="image/svg+xml">
<style>body{margin:0;padding:40px 20px;background:#0B0606;color:#F4DCD6;font:15px/1.6 ui-monospace,Menlo,monospace}a{color:#FF5A4E}</style>
</head>
<body>
<p>Opening the replay… <a href="${target}">${esc(title)}</a></p>
<script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>
`;
  fs.mkdirSync(path.join(ROOT, "simulator", "case", id), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "simulator", "case", id, "index.html"), page);
  console.log(`case ${id}: ${render ? "card + " : ""}share page`);
}
