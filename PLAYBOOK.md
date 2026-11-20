# The 18 ways AI-built apps leak their users' data

Every pattern below is tied to a dated public incident or study, or to the platform's own official rule. Numbers are the source's own, and caveats are kept next to them. Last updated 2026-11-20. The same data is in [data/patterns.json](data/patterns.json).

1. [Database tables with no Row Level Security](#1-no-rls) · critical · found by `launch-blockers check`
2. [Row Level Security is on, but the rule checks nothing](#2-open-policy) · high · found by `launch-blockers check`
3. [Firebase rules that let anyone in ("if true" or test mode)](#3-firebase-open-rules) · critical · found by `launch-blockers check`
4. [File storage anyone can read (ID photos, documents, uploads)](#4-public-storage) · critical · found by `launch-blockers check`
5. [A paid API key (OpenAI, Gemini, Stripe...) shipped in the browser code](#5-secret-in-frontend) · critical · found by `launch-blockers check`
6. [The Supabase service_role (secret) key in the browser](#6-service-role-in-frontend) · critical · found by `launch-blockers check`
7. [The .env file committed to git](#7-env-committed) · high · found by `launch-blockers check`
8. [A backend function anyone on the internet can call](#8-unauthenticated-function) · high · found by `launch-blockers check`
9. [A payment webhook that believes anyone](#9-webhook-unverified) · medium · found by `launch-blockers check`
10. [An access check that's backwards or only in the browser](#10-backwards-access-check) · critical · reviewed by your agent (the skill)
11. [Change the number in the address, see someone else's data](#11-other-users-records) · critical · reviewed by your agent (the skill)
12. [A private app that still lets anyone sign up](#12-open-signup-private-app) · high · reviewed by your agent (the skill)
13. [An internal tool published to the open internet](#13-internal-tool-public) · high · reviewed by your agent (the skill)
14. [Your coding agent can change the production database](#14-agent-can-write-production) · medium · found by `launch-blockers check`
15. [The live database isn't what your files say](#15-live-db-differs) · high · only visible on the live app
16. [The secret that signs logins is written into the code](#16-hardcoded-auth-secret) · high · found by `launch-blockers check`
17. [A database rule trusts what users can change about themselves](#17-rls-user-metadata) · high · found by `launch-blockers check`
18. [A view or database function that skips Row Level Security](#18-definer-skips-rls) · high · found by `launch-blockers check`

<a id="1-no-rls"></a>
## 1. Database tables with no Row Level Security

**Severity:** critical · **Where:** Supabase, Lovable, Bolt, v0, Replit · **Detection:** found by `launch-blockers check`

**What it looks like:** A migration runs create table but never alter table ... enable row level security.

**Why it leaks:** Supabase apps ship a public key in the browser on purpose. Row Level Security is the only thing that stops that key reading every row. Without it, anyone can read (and often change) the whole table.

**How to check:** launch-blockers check, then confirm on the live app with npx greenlitlab <your-app> --mine, because RLS switched off in the dashboard never shows up in files.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> Go through every table in my Supabase database. For each one that doesn't have Row Level Security enabled, write a new migration that enables it and adds policies so a signed-in user reaches only their own rows (auth.uid() = the owner column; add one if needed). If a table is meant to be public, say which and make it read-only. Don't edit old migrations. Show me the SQL before running anything.

**On the record:**
- **2025-05-29, CVE-2025-48757: Lovable apps without working RLS.** Researchers found 170 of 1,645 apps listed on Lovable Launched with 303 exposed endpoints because Row Level Security was missing or misconfigured. NVD scores it 9.3 (critical); Lovable disputes it, saying each customer secures their own data. [Matt Palmer](https://mattpalmer.io/posts/statement-on-CVE-2025-48757/)
- **2026-02-02, Moltbook database left open.** Wiz found the vibe-coded AI-agent network's Supabase database had no Row Level Security, giving read and write access to 1.5 million API tokens, 35,000 email addresses and 4,060 private conversations. It was fixed within hours. *(The key Wiz found was the public Supabase key, which is meant to be public. The failure was the missing RLS.)* [Wiz Research](https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys)
- **2026-11-04, Crissy Field scan of 159,041 Lovable projects.** Of 34,545 projects using Supabase, 24,664 returned database records on load with no login, and 7,403 of those had records containing email addresses. *(The researchers say 30% is not a confirmed breach rate: some emails may be public contacts or test data.)* [Techzine](https://www.techzine.eu/news/security/145550/thousands-of-lovable-apps-are-leaking-personal-data/)
- **Rule:** [Supabase docs: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)

<a id="2-open-policy"></a>
## 2. Row Level Security is on, but the rule checks nothing

**Severity:** high · **Where:** Supabase, Lovable, Bolt, v0, Replit · **Detection:** found by `launch-blockers check` (A rule that lets anyone (or any account) change or delete rows is high and blocks. A rule that lets anyone read a whole table blocks when the table holds something about people (profiles, messages, orders...); public lists like products are shown as a question.)

**What it looks like:** create policy ... using (true), or a rule that only asks whether someone is signed in (auth.uid() is not null), often added by an AI builder to make an error go away.

**Why it leaks:** RLS looks enabled in the dashboard, so everyone relaxes, but a condition of true lets everyone through. Fine for a product list, a leak for anything about people.

**How to check:** launch-blockers check lists each table with a true policy. Decide for each one whether it holds anything about a person.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> Find every Row Level Security policy in my database whose condition is simply true. For each, tell me whether the table holds anything about a specific person (names, emails, messages, payments, activity). Change nothing yet. Then propose a rewrite that limits it to the row's owner (auth.uid() = the owner column), as a new migration, and wait for my OK.

**On the record:**
- **2025-05-29, CVE-2025-48757: Lovable apps without working RLS.** The researchers counted apps where Row Level Security was missing or misconfigured. [Matt Palmer](https://mattpalmer.io/posts/statement-on-CVE-2025-48757/)
- **Rule:** [Supabase docs: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)

<a id="3-firebase-open-rules"></a>
## 3. Firebase rules that let anyone in ("if true" or test mode)

**Severity:** critical · **Where:** Firebase, FlutterFlow, Replit, any app on Firestore · **Detection:** found by `launch-blockers check` (The scan catches if true and Firebase's test-mode rule. A rule that lets any signed-in user read everything (request.auth != null on its own) needs the skill's review.)

**What it looks like:** allow read, write: if true; an allow with no condition; test mode (request.time < timestamp.date(...)); or if request.auth != null on a catch-all {document=**} path.

**Why it leaks:** Firebase's config is public by design. The rules are the only lock. Test mode is meant for the first 30 days and is often forgotten.

**How to check:** launch-blockers check reads firestore.rules, storage.rules and database.rules.json. Rules edited in the Firebase console instead of files need the live check.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> Rewrite my Firebase security rules so no rule uses if true or the test-mode date check. A signed-in user should reach only their own documents (request.auth != null && request.auth.uid == the owner field or path segment). Keep anything truly public read-only and tell me which it is. Show me the new rules and how to test them in the Firebase emulator before deploying.

**On the record:**
- **2026-01-29, AI chat app exposes chat histories.** A researcher said a Firebase misconfiguration in the Chat & Ask AI app exposed about 300 million messages from more than 25 million users. 404 Media reports Firebase made it easy to become an 'authenticated' user. It was fixed within hours. *(The counts are the researcher's claims, and neither report gives the exact rule. The app is an AI chatbot; it isn't known to be AI-built.)* [404 Media](https://www.404media.co/massive-ai-chat-app-leaked-millions-of-users-private-conversations/)
- **2026-02-09, Same Firebase mistake in 103 of 200 iOS apps.** The same researcher scanned 200 iOS apps and found 103 with the same Firebase misconfiguration. [Malwarebytes](https://www.malwarebytes.com/blog/news/2026/02/ai-chat-app-leak-exposes-300-million-messages-tied-to-25-million-users)
- **2026-02-01, 285 open Firebase databases in Android AI apps.** Cybernews researchers found 285 Firebase databases with no authentication among 38,630 Android apps with AI features. [TechRadar (reporting Cybernews)](https://www.techradar.com/pro/shock-report-claims-android-apps-have-leaked-over-730tb-of-user-data-and-google-secrets-here-are-some-of-the-worst-offenders-around)
- **Rule:** [Firebase docs: avoid insecure rules](https://firebase.google.com/docs/rules/insecure-rules)

<a id="4-public-storage"></a>
## 4. File storage anyone can read (ID photos, documents, uploads)

**Severity:** critical · **Where:** Firebase Storage, Supabase Storage · **Detection:** found by `launch-blockers check` (Found in your files: buckets made public in a migration or supabase/config.toml, storage.objects policies with no owner check, and Firebase storage.rules. A bucket made public only in the dashboard isn't in your files: the skill asks your agent to list them. A public bucket whose name says it holds IDs or documents is critical; others (avatars, product photos) are shown as a question.)

**What it looks like:** insert into storage.buckets (..., public) values (..., true), [storage.buckets.x] public = true, a storage.objects policy using (true), or allow read: if true in storage.rules, holding user uploads.

**Why it leaks:** Uploads are where the most sensitive things end up: selfies, IDs, contracts. A public bucket hands them to anyone who finds the address.

**How to check:** launch-blockers check; for buckets made in the Supabase dashboard, list them and their public flag (Storage in the dashboard).

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> List every storage bucket in my project and whether it's public. For any bucket holding user uploads, make it private, serve files through signed URLs that expire, and add storage policies so a user reaches only their own files. Tell me which buckets you'd keep public (logos, product images) and why. Show me the changes.

**On the record:**
- **2025-07-25, Tea app: verification selfies and IDs exposed.** An exposed Firebase storage bucket with no authentication held users' verification selfies and driver's licences. Tea estimated 72,000 images were accessed, 13,000 of them verification photos and ID images. *(There's no public evidence Tea was AI-built. It's here because the mistake is the same one.)* [404 Media (figures via NBC News)](https://www.404media.co/women-dating-safety-app-tea-breached-users-ids-posted-to-4chan/)
- **Rule:** [Firebase docs: avoid insecure rules](https://firebase.google.com/docs/rules/insecure-rules)

<a id="5-secret-in-frontend"></a>
## 5. A paid API key (OpenAI, Gemini, Stripe...) shipped in the browser code

**Severity:** critical · **Where:** Vite, Next.js, Lovable, Bolt, v0, Expo · **Detection:** found by `launch-blockers check` (Found by name (VITE_, NEXT_PUBLIC_, EXPO_PUBLIC_... in front of a secret or a paid service's key), by shape (sk_live_, sk-proj-, sk-ant-, AKIA, ghp_ and other known key formats written into code, reported without the value), and by dangerouslyAllowBrowser: true. A Google AIza key is high in browser code of a project that uses Gemini, low otherwise.)

**What it looks like:** VITE_OPENAI_API_KEY, NEXT_PUBLIC_STRIPE_SECRET_KEY, a key pasted into a fetch() call in a component, or new OpenAI({ dangerouslyAllowBrowser: true }).

**Why it leaks:** Everything the browser runs, every visitor can read. A key there can be copied and used on your bill.

**How to check:** launch-blockers check; npx greenlitlab <your-app> for keys in the deployed JavaScript.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> Find every API key or secret my frontend code uses (anything with a VITE_, NEXT_PUBLIC_, REACT_APP_ or EXPO_PUBLIC_ prefix, and anything pasted directly into code). Move each call that needs a secret into a backend function (a Supabase Edge Function or a server route) that checks the user is signed in, read the key there from a secret, and confirm the key no longer appears in the built frontend. List the keys I must revoke and replace, because they've already been public.

**On the record:**
- **2026-02-12, About 3,000 websites exposing ChatGPT keys.** Cyble found about 3,000 public websites exposing ChatGPT API keys in client-side JavaScript. *(Cyble documents no measured bills for these keys.)* [Cyble](https://cyble.com/blog/when-ai-secrets-go-public-chatgpt/)
- **2025-10-29, Escape.tech scan of 5,600+ vibe-coded apps.** Escape found more than 400 exposed secrets, over 2,000 vulnerabilities and 175 instances of exposed personal data across apps built on vibe-coding platforms. *(A vendor study by a company that sells scanning; it calls its numbers lower bounds.)* [Escape.tech](https://escape.tech/blog/methodology-how-we-discovered-vulnerabilities-apps-built-with-vibe-coding/)
- **2026-02-01, Hardcoded secrets in Android AI apps.** Cybernews found nearly three-quarters of 38,630 Android apps with AI features had at least one hardcoded secret, 197,092 in all. *(Over 81% were Google Cloud identifiers, many low-risk.)* [TechRadar (reporting Cybernews)](https://www.techradar.com/pro/shock-report-claims-android-apps-have-leaked-over-730tb-of-user-data-and-google-secrets-here-are-some-of-the-worst-offenders-around)
- **2026-02-25, Google API keys quietly became Gemini keys.** Truffle Security showed that switching on the Generative Language API in a Google Cloud project lets that project's existing API keys, including Maps and Firebase keys already published in websites' JavaScript, call Gemini with no warning. It found 2,863 live keys that worked on Gemini in one Common Crawl snapshot. *(The 2,863 keys are from across the web, not only AI-built apps. RedHunt Labs separately reported over 300 working Gemini keys on sites from vibe-coding platforms.)* [Truffle Security](https://trufflesecurity.com/blog/google-api-keys-werent-secrets-but-then-gemini-changed-the-rules)

<a id="6-service-role-in-frontend"></a>
## 6. The Supabase service_role (secret) key in the browser

**Severity:** critical · **Where:** Supabase · **Detection:** found by `launch-blockers check` (Found by name (a service_role key behind a public prefix), by value (a Supabase key whose role is service_role written into code, reported without the value), and by browser code that builds a Supabase client with the service-role key.)

**What it looks like:** VITE_SUPABASE_SERVICE_ROLE_KEY, or createClient(url, serviceRoleKey) in a component.

**Why it leaks:** The service_role key skips every Row Level Security rule. In the browser, it's the master key to the whole database.

**How to check:** launch-blockers check; npx greenlitlab <your-app> looks for it in the deployed JavaScript.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> Check whether my Supabase service_role or secret key is used anywhere in frontend code or has a public prefix. If so, remove it from the frontend, use the publishable (anon) key there instead, and move anything that truly needs admin rights into an Edge Function that checks who's calling. Then tell me to rotate the key in the Supabase dashboard, because it's been public.

**On the record:**
- **Rule:** [Supabase docs: API keys](https://supabase.com/docs/guides/api/api-keys)

<a id="7-env-committed"></a>
## 7. The .env file committed to git

**Severity:** high · **Where:** any · **Detection:** found by `launch-blockers check`

**What it looks like:** git ls-files shows .env, .env.local or .env.production.

**Why it leaks:** Everyone with the repository has the keys, now and forever: deleting the file later doesn't remove it from history. If the repo is public, the world has them.

**How to check:** launch-blockers check looks at what git tracks.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> Check whether any .env file or hardcoded key is tracked by git. If so, remove it from version control without deleting my local copy (git rm --cached), add it to .gitignore, create an .env.example with names only, and list every key that was exposed so I can revoke and replace each one.

**On the record:**
- **2026-02-12, 5,000+ GitHub repositories with OpenAI keys committed.** Cyble reported over 5,000 public GitHub repositories with hardcoded OpenAI keys. *(These were keys hardcoded in committed code, not necessarily .env files; the exposure is the same.)* [Cyble](https://cyble.com/blog/when-ai-secrets-go-public-chatgpt/)

<a id="8-unauthenticated-function"></a>
## 8. A backend function anyone on the internet can call

**Severity:** high · **Where:** Supabase Edge Functions, serverless routes · **Detection:** found by `launch-blockers check` (verify_jwt = false in supabase/config.toml is found. API routes that never check the user need the skill's review.)

**What it looks like:** verify_jwt = false, or an /api route that does its work without looking at the session.

**Why it leaks:** The AI often turns off the sign-in check to fix a 401 error. Then anyone can run the function: send emails, spend your AI credits, read data.

**How to check:** launch-blockers check for verify_jwt; the skill reviews each API route.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> List every backend function and API route in my project and whether it checks who's calling. For each one that doesn't: if it's a webhook, make it verify the sender's signature; otherwise require a signed-in user and check what they're allowed to do. Remove verify_jwt = false unless it's a signed webhook. Show me what you changed.

**On the record:**
- **Rule:** [Supabase docs: function configuration (verify_jwt)](https://supabase.com/docs/guides/functions/function-configuration)

<a id="9-webhook-unverified"></a>
## 9. A payment webhook that believes anyone

**Severity:** medium · **Where:** Stripe, Lemon Squeezy, Paddle · **Detection:** found by `launch-blockers check` (Shown by the check, but doesn't block a deploy: the scan can't be sure (the check may live in another file).)

**What it looks like:** A Stripe webhook handler that parses the body and grants access without stripe.webhooks.constructEvent.

**Why it leaks:** Without the signature check, anyone can send a fake "payment succeeded" message and get the paid plan for free.

**How to check:** launch-blockers check flags Stripe handlers with no signature check.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> My payment webhook must verify the signature before doing anything. Change it to read the raw request body and call stripe.webhooks.constructEvent (constructEventAsync on edge runtimes) with the signing secret from a server secret, reject anything that fails with a 400, and only then act on the event. Show me the change.

**On the record:**
- **Rule:** [Stripe docs: verify webhook signatures](https://docs.stripe.com/webhooks#verify-events)

<a id="10-backwards-access-check"></a>
## 10. An access check that's backwards or only in the browser

**Severity:** critical · **Where:** any · **Detection:** reviewed by your agent (the skill)

**What it looks like:** if (!user) return data; an admin page hidden only by the menu; a database function whose check lets anonymous users in and blocks signed-in ones.

**Why it leaks:** The app looks right when you click through it, so nobody notices. Hiding a button isn't protection: the data behind it is still one request away.

**How to check:** The launch-blockers skill has your agent trace every place data is returned and confirm the check happens on the server, the right way round.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> Trace every place my app returns or changes data (database queries, RPC functions, API routes). For each, tell me where the access check happens, whether it runs on the server rather than only in the browser, and whether it's the right way round (signed-out users blocked, owners allowed). Write me a short test for each, as an anonymous user and as a second user, that proves they can't get someone else's data. Change nothing until I confirm.

**On the record:**
- **2026-02-27, Lovable-showcased app with an inverted access check.** A researcher said an app featured on Lovable's Discover page had a database access check that blocked logged-in users and allowed anonymous ones, exposing 18,697 user records. *(Counts are the researcher's. Lovable says the project included non-Lovable code and the database wasn't Lovable-hosted.)* [The Register](https://www.theregister.com/2026/02/27/lovable_app_vulnerabilities)

<a id="11-other-users-records"></a>
## 11. Change the number in the address, see someone else's data

**Severity:** critical · **Where:** any · **Detection:** reviewed by your agent (the skill)

**What it looks like:** /api/orders/123 returns order 123 to whoever asks; a query filtered by an id from the request, not by the signed-in user.

**Why it leaks:** The most common API flaw there is. The app only ever shows you your own records, so it works in testing.

**How to check:** The skill has your agent find every route or query that takes an id and confirm it also checks the owner.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> Find every API route, server action or database query that takes a record id from the request. For each, check that it also confirms the record belongs to the signed-in user (or that they're allowed to see it). Fix any that don't, and add a test where a second user asks for the first user's record and gets nothing. Show me the list first.

**On the record:**
- **Rule:** [OWASP API Security Top 10: API1 Broken Object Level Authorization](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization)

<a id="12-open-signup-private-app"></a>
## 12. A private app that still lets anyone sign up

**Severity:** high · **Where:** Base44, Supabase Auth, Firebase Auth, internal tools · **Detection:** reviewed by your agent (the skill)

**What it looks like:** An internal tool behind a login, where email sign-up is still switched on, or the sign-up endpoint works even though the page is hidden.

**Why it leaks:** "Behind a login" means nothing if anyone can create a login. That's all an attacker needs to see what members see.

**How to check:** The skill asks your agent whether sign-up should be open and where it's switched off.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> Tell me whether my app is meant to let anyone sign up. If not, switch off public sign-up in the auth provider settings (not just by hiding the page), allow only invited emails or my company's domain, and make sure new accounts get no data access until approved. Tell me exactly which setting to change in the dashboard.

**On the record:**
- **2025-07-29, Base44: anyone could join private apps.** Wiz found Base44's register and verify-OTP endpoints needed no authentication, so anyone with a private app's public id could create a verified account. Wix fixed it in under 24 hours. *(A flaw in the platform, not in builders' apps. Wix reported no evidence of exploitation.)* [Wiz Research](https://www.wiz.io/blog/critical-vulnerability-base44)

<a id="13-internal-tool-public"></a>
## 13. An internal tool published to the open internet

**Severity:** high · **Where:** Lovable, Replit, Base44, Bolt · **Detection:** reviewed by your agent (the skill)

**What it looks like:** A dashboard of company or customer data, built in an afternoon and published at a public address with no login.

**Why it leaks:** Builders publish to a public URL by default. A tool meant for five colleagues is then one search away for everyone.

**How to check:** The skill asks who the app is for and whether its address needs a login before anything loads.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> This app is meant only for my team. Make every page and every data request require a signed-in user from an allowed list before anything loads, check that the published address shows nothing to a signed-out visitor, and tell me which visibility setting to change in my builder so it isn't public.

**On the record:**
- **2026-05-07, RedAccess: thousands of public vibe-coded apps with company data.** RedAccess said it found about 380,000 publicly accessible assets built with vibe-coding tools, about 5,000 of them holding sensitive corporate information; Axios verified several, including a bank's internal financial data and hospital patient summaries. *(Replit's CEO disputed the framing; Lovable and Base44 said the reports lacked URLs to verify.)* [Security Boulevard](https://securityboulevard.com/2026/05/thousands-of-vibe-coded-apps-exposing-corporate-personal-data-redaccess/)

<a id="14-agent-can-write-production"></a>
## 14. Your coding agent can change the production database

**Severity:** medium · **Where:** Claude Code, Cursor, Replit Agent, any MCP database server · **Detection:** found by `launch-blockers check` (A database MCP server without read-only mode is found in .mcp.json, .cursor/mcp.json and similar files. Shown by the check, but doesn't block a deploy: the setting matters while you build, not to the deployed app.)

**What it looks like:** A Supabase or Postgres MCP server in .mcp.json with write access, pointed at the live project.

**Why it leaks:** Agents make confident mistakes. One with write access to production can delete it in a single step.

**How to check:** launch-blockers check reads your agent configuration.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> Look at my coding-agent configuration (.mcp.json, .cursor/mcp.json and similar). For any database connection, tell me whether it can write and whether it points at the live project. Change it to read-only and to a development project, and tell me how to keep a tested backup of production. Change nothing until I confirm.

**On the record:**
- **2025-07, Replit agent deletes a production database.** During a declared code freeze, Replit's AI agent deleted a live production database holding data on more than 1,200 executives and 1,190 companies. The data was recovered. *(Fortune published this on 23 Jul 2025; it gives no exact incident date.)* [Fortune](https://fortune.com/2025/07/23/ai-coding-tool-replit-wiped-database-called-it-a-catastrophic-failure/)
- **2025-07-08, A support ticket makes an agent leak private tables through the Supabase MCP server.** General Analysis showed Cursor connected to the Supabase MCP server with the service_role key: an attacker's support ticket held instructions, and when the developer asked the agent to show the latest ticket, it read a private table of integration tokens and wrote them back into the ticket for the attacker to read. *(A demonstration, not a reported breach. Supabase has since added read-only and project-scoped modes.)* [General Analysis](https://www.generalanalysis.com/blog/supabase-mcp-blog)

<a id="15-live-db-differs"></a>
## 15. The live database isn't what your files say

**Severity:** high · **Where:** Supabase, Firebase · **Detection:** only visible on the live app

**What it looks like:** RLS switched off or a rule loosened in the dashboard to fix a bug, never written back to a migration.

**Why it leaks:** Every file-based check, including this one, reads your files. Your users' data lives in the live database.

**How to check:** npx greenlitlab <your-app> --mine checks which tables a stranger can read on the live app, using only the public key your app already ships. It counts rows; it never reads data.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> Compare my live database's security settings with my migrations: for every table, tell me whether Row Level Security is on and which policies exist in the live project, and list anything that differs from the files. Then write migrations that make the files match the safe version. Change nothing in the live database yourself.

**On the record:**
- **2026-11-04, Crissy Field scan of 159,041 Lovable projects.** 24,664 projects returned database records on page load to a visitor with no login, which is what the live database does, whatever the code says. [Techzine](https://www.techzine.eu/news/security/145550/thousands-of-lovable-apps-are-leaking-personal-data/)

<a id="16-hardcoded-auth-secret"></a>
## 16. The secret that signs logins is written into the code

**Severity:** high · **Where:** Bolt, Replit, Cursor, Claude Code, any custom backend · **Detection:** found by `launch-blockers check` (Found when JWT_SECRET, SESSION_SECRET, SECRET_KEY and similar are set to a fixed value, or fall back to one when the environment variable is missing.)

**What it looks like:** const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey", or JWT_SECRET: supersecretjwt in docker-compose.yml.

**Why it leaks:** Whoever knows the secret that signs login tokens can make a valid token for any user, including an admin. A value in the code is known to everyone who has ever seen the code, and AI models reuse the same few values.

**How to check:** launch-blockers check.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> Find every secret that signs logins, sessions or cookies in my project (JWT_SECRET, SESSION_SECRET, SECRET_KEY, NEXTAUTH_SECRET and similar). Don't show me the values. Make each one come only from an environment variable, make the app refuse to start if it is missing (no fallback value), and tell me how to generate a long random one. Then remind me that changing it signs everyone out.

**On the record:**
- **2025-11-05, Invicti: the same secrets across 20,656 AI-generated apps.** Invicti generated 20,656 web apps with leading AI models and found the string supersecretkey in 1,182 of them. In one, JWT_SECRET was set to supersecretjwt; with it, a researcher changed a token's role from customer to admin and reached the admin functions. *(Apps generated for the study, not live apps. It also found seeded logins such as admin@example.com with the password password.)* [Invicti](https://www.invicti.com/blog/security-labs/security-issues-in-vibe-coded-web-apps-analyzed)

<a id="17-rls-user-metadata"></a>
## 17. A database rule trusts what users can change about themselves

**Severity:** high · **Where:** Supabase, Lovable, Bolt, v0 · **Detection:** found by `launch-blockers check`

**What it looks like:** create policy ... using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin').

**Why it leaks:** Supabase's user_metadata is written by the user (supabase.auth.updateUser). A rule that checks it for a role can be passed by anyone who sets that role on their own account.

**How to check:** launch-blockers check; Supabase's Security Advisor (Database → Advisors) flags it as an error.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> Find every Row Level Security policy in my database that reads user_metadata or raw_user_meta_data. Rewrite each one, as a new migration, to use app_metadata (which only the server can set) or a roles table that users can't write. Show me the SQL and how roles get assigned.

**On the record:**
- **Rule:** [Supabase Security Advisor: lint 0015, RLS references user metadata](https://supabase.com/docs/guides/database/database-linter?lint=0015_rls_references_user_metadata)

<a id="18-definer-skips-rls"></a>
## 18. A view or database function that skips Row Level Security

**Severity:** high · **Where:** Supabase, Lovable, Bolt, v0 · **Detection:** found by `launch-blockers check` (Found in migrations: views without security_invoker (critical when they read auth.users), SECURITY DEFINER functions in the public schema that anon can still call (high when they run SQL built from text), and materialized views in the public schema.)

**What it looks like:** create view public.leaderboard as select ... (no security_invoker), or create function public.exec_sql(q text) ... security definer ... execute q.

**Why it leaks:** Views run with their creator's rights unless told otherwise, and a SECURITY DEFINER function runs with its owner's. Both skip the rules on the tables they read. In the public schema, the app's public key can reach them. Agents often add one to make a permissions error go away.

**How to check:** launch-blockers check; Supabase's Security Advisor (Database → Advisors) flags these.

**Fix prompt** (paste into Lovable, Bolt, Cursor, Claude Code or your builder):

> List every view and SECURITY DEFINER function in my database's public schema. For each view, write a migration that sets security_invoker = on (or moves it out of public if it reads auth.users). For each function, revoke execute from public and anon unless it must be called without signing in, set search_path = '', and make it check auth.uid() itself. Remove any function that runs SQL passed in by the caller. Show me the SQL.

**On the record:**
- **Rule:** [Supabase Security Advisor: lint 0010, security definer view](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)
- **Rule:** [Supabase Security Advisor: lint 0028, security definer function callable without signing in](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)

---
Found a pattern with a public source that isn't here? Open an issue with the link. Patterns are added only with a source anyone can read.
