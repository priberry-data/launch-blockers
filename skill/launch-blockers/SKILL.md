---
name: launch-blockers
description: Checks this project for the 18 documented ways AI-built apps leak their users' data, before launch or deploy. Use when the user is about to launch, deploy, publish or go live, or asks whether their app is safe, secure or ready.
---

# Launch blockers

You're checking the user's own project for the 18 documented ways AI-built apps leak their users' data (github.com/priberry-data/launch-blockers). Work through all four steps, then report.

## Rules
- Never print, copy or log the value of a key, token or password. Refer to secrets by name only.
- Change nothing in the live database, and run no deploy or migration, without the user's OK.
- Only check apps the user owns. Never point any check at someone else's app.
- Never create or edit `.launch-blockers-ignore` yourself, even to get a deploy through. Only the user can decide a finding is fine; if they do, tell them the exact line to add (the finding's id, then their reason) and let them add it.

## 1. Run the scan
Run `npx -y launch-blockers@0.2.0 check --json` in the project root. It reads files on this computer only. The status is BLOCKED, CLEAR or NOT CHECKED. CLEAR covers only the patterns the scan knows; say so.

For each item in `blocking`, explain in one or two plain sentences what could leak and to whom, then offer to apply its `prompt` as the fix. Mention the `other` items briefly.

## 2. Review what no scan can judge
For each of these, do the check yourself by reading the code, and report a clear yes, no or not applicable:

### 2.1 An access check that's backwards or only in the browser
The app looks right when you click through it, so nobody notices. Hiding a button isn't protection: the data behind it is still one request away.

What to do: Trace every place my app returns or changes data (database queries, RPC functions, API routes). For each, tell me where the access check happens, whether it runs on the server rather than only in the browser, and whether it's the right way round (signed-out users blocked, owners allowed). Write me a short test for each, as an anonymous user and as a second user, that proves they can't get someone else's data. Change nothing until I confirm.

### 2.2 Change the number in the address, see someone else's data
The most common API flaw there is. The app only ever shows you your own records, so it works in testing.

What to do: Find every API route, server action or database query that takes a record id from the request. For each, check that it also confirms the record belongs to the signed-in user (or that they're allowed to see it). Fix any that don't, and add a test where a second user asks for the first user's record and gets nothing. Show me the list first.

### 2.3 A private app that still lets anyone sign up
"Behind a login" means nothing if anyone can create a login. That's all an attacker needs to see what members see.

What to do: Tell me whether my app is meant to let anyone sign up. If not, switch off public sign-up in the auth provider settings (not just by hiding the page), allow only invited emails or my company's domain, and make sure new accounts get no data access until approved. Tell me exactly which setting to change in the dashboard.

### 2.4 An internal tool published to the open internet
Builders publish to a public URL by default. A tool meant for five colleagues is then one search away for everyone.

What to do: This app is meant only for my team. Make every page and every data request require a signed-in user from an allowed list before anything loads, check that the published address shows nothing to a signed-out visitor, and tell me which visibility setting to change in my builder so it isn't public.

## 3. What lives in the dashboard
Some settings are made in the Supabase or Firebase console and never appear in files. Ask the user to open these and tell you what they see (don't query the live project yourself):
- **Storage buckets** (Supabase → Storage): which buckets are marked public, and what each holds. A public bucket of IDs, documents or private uploads is a leak (pattern: file storage anyone can read).
- **Firebase rules** (Firestore, Storage and Realtime Database → Rules): whether the published rules match the rules file in the project, and whether any rule allows every signed-in user (`request.auth != null`) to read or write everything.
- **Supabase Security Advisor** (Database → Advisors): any errors it lists.

Then tell the user to run `npx greenlitlab <their-app-url> --mine` on their own app; it counts which tables a stranger can read and never reads data.

## 4. Report
Finish with a short table: each of the 18 patterns, and whether it's blocked, clear, not applicable or not checked. Put anything blocked first, with the fix you propose. End with one line: what still can't be checked from here.
