#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version: VERSION } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const HELP = `launch-blockers ${VERSION}: the ways AI-built apps leak their users' data, checked before you launch.

  npx launch-blockers check [folder]     BLOCKED, CLEAR or NOT CHECKED for a project on this computer
  npx launch-blockers check --json       the same, as JSON
  npx launch-blockers install            add the skill and the deploy guard to Claude Code for this project
  npx launch-blockers install --global   the same, for every project
  npx launch-blockers list               every pattern, with the incident behind it

Exit codes for check: 0 CLEAR, 1 BLOCKED, 3 NOT CHECKED. Nothing is sent anywhere.`;

const { values: opt, positionals } = parseArgs({ allowPositionals: true, options: { json: { type: "boolean" }, global: { type: "boolean" }, help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" } } });
const cmd = positionals[0];

if (opt.version) console.log(VERSION);
else if (opt.help || !cmd) console.log(HELP);
else if (cmd === "check") {
  const { check, render } = await import("../src/check.mjs");
  const r = check(positionals[1] || ".");
  console.log(opt.json ? JSON.stringify(r, null, 2) : render(r, { color: Boolean(process.stdout.isTTY && !process.env.NO_COLOR) }));
  process.exitCode = { CLEAR: 0, BLOCKED: 1, "NOT CHECKED": 3 }[r.status];
} else if (cmd === "install") {
  const { install } = await import("../src/install.mjs");
  try {
    const done = install({ global: opt.global, dir: positionals[1] || ".", version: VERSION });
    console.log(`launch-blockers installed for Claude Code${opt.global ? " (every project)" : ""}:\n${done.map((d) => `  ${d}`).join("\n")}\n\nIn Claude Code, ask: "run the launch-blockers skill". Deploy commands are now checked first.\nRestart Claude Code (or open /hooks) so it picks up the new setting.`);
  } catch (e) {
    console.error(`launch-blockers: ${e.message}`);
    process.exitCode = 2;
  }
} else if (cmd === "list") {
  const { patterns } = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "patterns.json"), "utf8"));
  if (opt.json) console.log(JSON.stringify(patterns, null, 2));
  else patterns.forEach((p, i) => console.log(`${String(i + 1).padStart(2)}. ${p.title}  [${p.severity}, ${p.detection}]\n    ${p.incidents.map((x) => `${x.date} ${x.title}`).join(" · ") || "rule: " + (p.rules[0]?.source_name || "")}`));
} else {
  console.error(`launch-blockers: unknown command "${cmd}"\n\n${HELP}`);
  process.exitCode = 2;
}
