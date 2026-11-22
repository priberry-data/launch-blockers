# Changelog

## 0.2.0 (unreleased)

Rebuilt after an adversarial audit (20 November 2026) that found about 60 ways to get a deploy past 0.1.0's guard. Every case is now a test.

- **The guard reads commands the way the shell will:** quoting, `&&`/`;`/pipes, subshells, heredocs, `cd`, wrappers (`npx`, `sudo`, `env`, `timeout`, `xargs`, `pnpm dlx`, `bunx` and others), `bash -c`, shell scripts, `eval`, `make`/`just` targets, and `npm`/`pnpm`/`yarn`/`bun` scripts resolved from package.json. About 40 deploy tools are known. `git push` to main or a deploy remote asks first when the host deploys from git, and so do MCP tools that deploy. `--help` and `--dry-run` pass.
- **Each finding links to a replay of that leak** in the leak simulator (greenlit.priberry.com/blockers/simulator), on a pretend app, for the 12 patterns it plays. The link is also in `--json` as `replay`.
- **It checks the folder being deployed** (`--cwd`, a path argument, `cd`), from the top of its git repository.
- **Nothing is downloaded at deploy time.** Install copies the check next to the guard, so an offline deploy doesn't stall and a package planted in `node_modules` can't answer CLEAR. If node can't run, the command is held.
- **No quiet passes:** in bypass mode anything that would ask is refused; a CLEAR that depends on an ignored serious finding asks, with the reason shown; ignore lines need a real reason; the agent is told never to write the ignore file.
- **The check:** a table everyone can read is a blocker when it holds something about people; a scan that hit the file cap or couldn't read a rules file is NOT CHECKED. Uses greenlitlab 0.5.0's new scan.
- **3 new patterns, 18 in all:** login secrets written into code (Invicti, Nov 2025), rules that trust `user_metadata` (Supabase lint 0015), and views or functions that skip Row Level Security (Supabase lints 0010 and 0028). New sources for keys in the browser (Truffle Security on Google keys and Gemini) and agents with database access (General Analysis).
- The skill is also written to `.agents/skills` for Codex, Cursor, Gemini CLI and Copilot, and adds the dashboard checks (public buckets, published Firebase rules, Security Advisor).
- Exit codes: 0 CLEAR, 1 BLOCKED, 3 NOT CHECKED, 2 for a usage mistake or a crash.

## 0.1.0 (20 November 2026)

- 15 patterns, each tied to a dated public incident or study, or to the platform's own rule, with a fix prompt.
- `launch-blockers check`: BLOCKED, CLEAR or NOT CHECKED for a project on your computer, using Greenlit's project scan (greenlitlab 0.4.4, which adds Firebase rules).
- `launch-blockers install`: a Claude Code skill, and a guard that checks the project before deploy commands.
- `launch-blockers list`: every pattern with the incident behind it.
- Website at greenlit.priberry.com/blockers/: `site/` uses relative paths only and is copied into Greenlit's site with `npm run site`.
