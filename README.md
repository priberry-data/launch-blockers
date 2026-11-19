# Launch Blockers

**The <!--n-->15<!--/n--> ways AI-built apps leak their users' data, each one on the public record, checked before you launch.**

**[blockers.priberry.com](https://blockers.priberry.com)**

Built your app with Lovable, Bolt, v0, Replit, Cursor or Claude Code? These are the mistakes behind the leaks in the news: open databases, keys in the browser, Firebase left in test mode. Every pattern links to a dated public incident or the platform's own rule, comes with a fix prompt you paste into your builder, and has a check that runs before you deploy. (<!--mix-->11 from dated incidents or studies, 4 from the platform's own rules<!--/mix-->.)

```text
$ npx launch-blockers check
launch-blockers · BLOCKED

2 things to fix before you launch:

1. The secret VITE_OPENAI_API_KEY is named so it ships to the browser  [critical]
   src/ai.ts:1
   Fix prompt for your builder: My project has a secret named VITE_OPENAI_API_KEY...

2. The table "profiles" is created without Row Level Security  [high]
   supabase/migrations/20260101_init.sql:1
```

## Start here

| You are... | Do this | Takes |
|---|---|---|
| About to launch | `npx launch-blockers check` in your project folder | 1 minute |
| Using Claude Code | `npx launch-blockers install`, then ask Claude to "run the launch-blockers skill". Deploys are now checked first. | 1 minute |
| Not a developer (Lovable, Bolt, Base44) | Open [PLAYBOOK.md](PLAYBOOK.md) and paste each fix prompt into your builder | 10 minutes |
| Wondering if your live app leaks right now | `npx greenlitlab yourapp.com --mine` (your own app only) | 2 minutes |

## Why this exists

- **1.5 million API tokens and 35,000 emails** sat in a vibe-coded app's database with Row Level Security never switched on (Moltbook, Feb 2026, [Wiz](https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys)).
- **24,664 of 34,545** Lovable projects using Supabase returned database records to a visitor with no login (Crissy Field, Nov 2026; some of it may be meant to be public, [Techzine](https://www.techzine.eu/news/security/145550/thousands-of-lovable-apps-are-leaking-personal-data/)).
- **About 300 million messages** were exposed by one Firebase misconfiguration in an AI chat app (Jan 2026, [404 Media](https://www.404media.co/massive-ai-chat-app-leaked-millions-of-users-private-conversations/)).

None of these needed a hacker. Each was one setting.

## The patterns

<!--table-->
| # | Pattern | Severity | Found by | On the record |
|---|---|---|---|---|
| 1 | [Database tables with no Row Level Security](PLAYBOOK.md#1-no-rls) | critical | scan | CVE-2025-48757: Lovable apps without working RLS (2025-05) |
| 2 | [Row Level Security is on, but the rule checks nothing](PLAYBOOK.md#2-open-policy) | high | scan | CVE-2025-48757: Lovable apps without working RLS (2025-05) |
| 3 | [Firebase rules that let anyone in ("if true" or test mode)](PLAYBOOK.md#3-firebase-open-rules) | critical | scan | AI chat app exposes chat histories (2026-01) |
| 4 | [File storage anyone can read (ID photos, documents, uploads)](PLAYBOOK.md#4-public-storage) | critical | scan | Tea app: verification selfies and IDs exposed (2025-07) |
| 5 | [A paid API key (OpenAI, Gemini, Stripe...) shipped in the browser code](PLAYBOOK.md#5-secret-in-frontend) | critical | scan | About 3,000 websites exposing ChatGPT keys (2026-02) |
| 6 | [The Supabase service_role (secret) key in the browser](PLAYBOOK.md#6-service-role-in-frontend) | critical | scan | Rule: Supabase docs: API keys |
| 7 | [The .env file committed to git](PLAYBOOK.md#7-env-committed) | high | scan | 5,000+ GitHub repositories with OpenAI keys committed (2026-02) |
| 8 | [A backend function anyone on the internet can call](PLAYBOOK.md#8-unauthenticated-function) | high | scan | Rule: Supabase docs: function configuration (verify_jwt) |
| 9 | [A payment webhook that believes anyone](PLAYBOOK.md#9-webhook-unverified) | medium | scan | Rule: Stripe docs: verify webhook signatures |
| 10 | [An access check that's backwards or only in the browser](PLAYBOOK.md#10-backwards-access-check) | critical | agent review | Lovable-showcased app with an inverted access check (2026-02) |
| 11 | [Change the number in the address, see someone else's data](PLAYBOOK.md#11-other-users-records) | critical | agent review | Rule: OWASP API Security Top 10: API1 Broken Object Level Authorization |
| 12 | [A private app that still lets anyone sign up](PLAYBOOK.md#12-open-signup-private-app) | high | agent review | Base44: anyone could join private apps (2025-07) |
| 13 | [An internal tool published to the open internet](PLAYBOOK.md#13-internal-tool-public) | high | agent review | RedAccess: thousands of public vibe-coded apps with company data (2026-05) |
| 14 | [Your coding agent can change the production database](PLAYBOOK.md#14-agent-can-write-production) | medium | scan | Replit agent deletes a production database (2025-07) |
| 15 | [The live database isn't what your files say](PLAYBOOK.md#15-live-db-differs) | high | live check | Crissy Field scan of 159,041 Lovable projects (2026-11) |
<!--/table-->

Full detail, fix prompts and sources: **[PLAYBOOK.md](PLAYBOOK.md)**. Machine-readable: [data/patterns.json](data/patterns.json).

## The deploy guard (Claude Code)

`npx launch-blockers install` adds two things to your project's `.claude` folder:

- **A skill** that walks your agent through all <!--n-->15<!--/n--> patterns, including the ones no scanner can judge (backwards access checks, other users' records, private apps with open sign-up).
- **A guard** that runs before deploy commands (`vercel`, `netlify deploy`, `supabase db push`, `firebase deploy`, `wrangler deploy`, `fly deploy`, `railway up`, `npm run deploy`):
  - **BLOCKED:** the deploy is stopped and your agent gets the reasons and fix prompts.
  - **NOT CHECKED:** the check couldn't run, so you're asked. It never passes silently.
  - **CLEAR:** nothing changes; your usual approval still applies, with a note of what wasn't checked.

Checked a finding yourself and it's fine (say, Row Level Security switched on in the dashboard)? Add its id and your reason to `.launch-blockers-ignore`. A line without a reason doesn't count, and ignored findings are always listed in the output.

Use `--global` to install for every project. The skill file works in any agent that reads skills; the deploy guard is for Claude Code today.

## What it can't see

A file scan reads your files. It can't see:
- **your live database**, if rules were changed in the dashboard (run `npx greenlitlab yourapp.com --mine`);
- **logic mistakes in your own code**, which is why the skill has your agent review them;
- **anything new.** "CLEAR" means none of the known patterns matched. It doesn't mean safe.

## Privacy

Everything runs on your computer. Nothing is uploaded. Names in `.env` files are read, never values.

## Add a pattern

Open an issue with a public link: an incident write-up, a study, or the platform's own documentation. Patterns are added only with a source anyone can read, and counts are quoted as the source gives them.

## Made by Priberry

The scanning is [Greenlit](https://github.com/priberry-data/greenlitlab)'s project scan. From the same team: [Crumple](https://github.com/priberry-data/crumplelab) crash-tests your AI coding agent setup, and [Tare](https://github.com/priberry-data/tarelab) cuts its token bill. Apache-2.0.
