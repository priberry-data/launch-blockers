// Reads a shell command the way a shell would and answers: does it deploy, and from which folder?
// Built to fail closed. Quoted text is data (a commit message, an echo), but anything that runs as code — $(…),
// backticks, bash -c '…', eval, heredocs fed to a shell, npm scripts, shell scripts — is read as code too.
// When the command can't be read (unbalanced quotes, a pipe into a shell), the answer is "maybe", never "no".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const MAX_DEPTH = 6;
const SEPARATOR_WORDS = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "!", "{", "}", "coproc"]);
const SKIP_WHOLE = new Set(["for", "case", "select", "function"]);
// Words that mean "show me", never "do it".
const HELP = new Set(["--help", "-h", "help", "--version", "--dry-run", "--dryrun"]);

// ---------------------------------------------------------------- tokenizer
// Returns { cmds: [{ words:[{t, raw}], stdin }], subs: [string], unreadable: bool }.
// A word's `t` is its text after quote removal; `raw` is what was typed. `subs` collects every piece of text the
// shell would run as a command of its own: $(…), backticks (also inside double quotes), process substitution.
export function tokenize(src) {
  const cmds = [];
  const subs = [];
  let unreadable = false;
  let words = [];
  let cur = null; // { t, raw }
  let stdin = null; // "pipe" | { text } (heredoc or here-string)
  let pendingHeredocs = []; // [{ delim, strip, cmd }]
  let nextStdinPipe = false;
  let i = 0;
  const n = src.length;
  const startWord = () => (cur ??= { t: "", raw: "" });
  const endWord = () => {
    if (cur) words.push(cur);
    cur = null;
  };
  const endCmd = (pipeNext = false) => {
    endWord();
    const cmd = { words, stdin: nextStdinPipe ? "pipe" : stdin };
    if (words.length || cmd.stdin) cmds.push(cmd);
    for (const h of pendingHeredocs) if (!h.cmd) h.cmd = cmd;
    words = [];
    stdin = null;
    nextStdinPipe = pipeNext;
    return cmd;
  };
  // Reads $( … ) starting at the "(", honouring nesting and quotes. Returns [inner, indexAfter].
  const readParens = (start) => {
    let depth = 0;
    let j = start;
    for (; j < n; j++) {
      const c = src[j];
      if (c === "<" && src[j + 1] === "<" && src[j + 2] !== "<") {
        // A heredoc inside $( … ): its body is text up to the delimiter line, apostrophes and all.
        const m = src.slice(j + 2).match(/^-?\s*(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>()]+))/);
        if (m) {
          const delim = m[1] ?? m[2] ?? m[3];
          const lineEnd = src.indexOf("\n", j);
          if (lineEnd > 0) {
            const re = new RegExp(`\\n[\\t]*${delim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\n|\\)|$)`, "g");
            re.lastIndex = lineEnd;
            const hit = re.exec(src);
            if (hit) {
              j = hit.index + hit[0].length - 1;
              continue;
            }
          }
        }
      }
      if (c === "\\") j++;
      else if (c === "'") {
        const k = src.indexOf("'", j + 1);
        if (k < 0) return [null, n];
        j = k;
      } else if (c === '"') {
        let k = j + 1;
        while (k < n && src[k] !== '"') k += src[k] === "\\" ? 2 : 1;
        if (k >= n) return [null, n];
        j = k;
      } else if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) return [src.slice(start + 1, j), j + 1];
      }
    }
    return [null, n];
  };
  const readBacktick = (start) => {
    let j = start + 1;
    let inner = "";
    while (j < n && src[j] !== "`") {
      if (src[j] === "\\" && j + 1 < n) {
        inner += src[j + 1];
        j += 2;
      } else inner += src[j++];
    }
    if (j >= n) return [null, n];
    return [inner, j + 1];
  };
  const readHeredocBodies = () => {
    // Called right after a newline: each pending heredoc's body runs until its delimiter line.
    for (const h of pendingHeredocs) {
      const lines = [];
      while (i < n) {
        let e = src.indexOf("\n", i);
        if (e < 0) e = n;
        const line = src.slice(i, e);
        i = e + 1;
        if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delim) break;
        lines.push(line);
      }
      const body = lines.join("\n");
      if (h.cmd) h.cmd.stdin = { text: body, quoted: h.quoted };
      if (!h.quoted) for (const m of body.matchAll(/\$\(([^()]*(?:\([^()]*\)[^()]*)*)\)|`([^`]*)`/g)) subs.push(m[1] ?? m[2]);
    }
    pendingHeredocs = [];
  };

  while (i < n) {
    const c = src[i];
    if (c === "\\") {
      if (src[i + 1] === "\n") i += 2; // line continuation
      else {
        startWord();
        cur.t += src[i + 1] ?? "";
        cur.raw += src.slice(i, i + 2);
        i += 2;
      }
      continue;
    }
    if (c === "'") {
      const k = src.indexOf("'", i + 1);
      if (k < 0) {
        unreadable = true;
        break;
      }
      startWord();
      cur.t += src.slice(i + 1, k);
      cur.raw += src.slice(i, k + 1);
      cur.q = true;
      i = k + 1;
      continue;
    }
    if (c === "$" && src[i + 1] === "'") {
      // $'…' ANSI-C quoting: backslash escapes inside.
      let k = i + 2;
      let t = "";
      while (k < n && src[k] !== "'") {
        if (src[k] === "\\" && k + 1 < n) {
          const e = src[k + 1];
          t += { n: "\n", t: "\t", "'": "'", "\\": "\\", '"': '"' }[e] ?? e;
          k += 2;
        } else t += src[k++];
      }
      if (k >= n) {
        unreadable = true;
        break;
      }
      startWord();
      cur.t += t;
      cur.raw += src.slice(i, k + 1);
      cur.q = true;
      i = k + 1;
      continue;
    }
    if (c === '"') {
      let k = i + 1;
      let t = "";
      startWord();
      while (k < n && src[k] !== '"') {
        if (src[k] === "\\" && k + 1 < n) {
          const e = src[k + 1];
          if ("$`\"\\\n".includes(e)) t += e === "\n" ? "" : e;
          else t += "\\" + e;
          k += 2;
        } else if (src[k] === "$" && src[k + 1] === "(" && src[k + 2] !== "(") {
          const [inner, after] = readParens(k + 1);
          if (inner == null) {
            unreadable = true;
            k = n;
            break;
          }
          subs.push(inner);
          t += src.slice(k, after);
          k = after;
        } else if (src[k] === "`") {
          const [inner, after] = readBacktick(k);
          if (inner == null) {
            unreadable = true;
            k = n;
            break;
          }
          subs.push(inner);
          t += "`" + inner + "`";
          k = after;
        } else t += src[k++];
      }
      if (k >= n) {
        unreadable = true;
        break;
      }
      cur.t += t;
      cur.raw += src.slice(i, k + 1);
      cur.q = true;
      i = k + 1;
      continue;
    }
    if (c === "$" && src[i + 1] === "(") {
      if (src[i + 2] === "(") {
        // $(( arithmetic )): text, never a command.
        const k = src.indexOf("))", i + 3);
        startWord();
        const e = k < 0 ? n : k + 2;
        cur.t += src.slice(i, e);
        cur.raw += src.slice(i, e);
        i = e;
        continue;
      }
      const [inner, after] = readParens(i + 1);
      if (inner == null) {
        unreadable = true;
        break;
      }
      subs.push(inner);
      startWord();
      cur.t += src.slice(i, after);
      cur.raw += src.slice(i, after);
      cur.sub = inner;
      i = after;
      continue;
    }
    if ((c === "<" || c === ">") && src[i + 1] === "(") {
      // Process substitution <( … ): runs as a command.
      const [inner, after] = readParens(i + 1);
      if (inner == null) {
        unreadable = true;
        break;
      }
      subs.push(inner);
      endWord();
      i = after;
      continue;
    }
    if (c === "`") {
      const [inner, after] = readBacktick(i);
      if (inner == null) {
        unreadable = true;
        break;
      }
      subs.push(inner);
      startWord();
      cur.t += "`" + inner + "`";
      cur.raw += src.slice(i, after);
      cur.sub = inner;
      i = after;
      continue;
    }
    if (c === "#" && !cur) {
      // A comment runs to the end of the line.
      const k = src.indexOf("\n", i);
      i = k < 0 ? n : k;
      continue;
    }
    if (c === " " || c === "\t") {
      endWord();
      i++;
      continue;
    }
    if (c === "\n") {
      endCmd();
      i++;
      if (pendingHeredocs.length) readHeredocBodies();
      continue;
    }
    if (c === "<" && src.startsWith("<<<", i)) {
      // Here-string: the next word is the command's stdin.
      endWord();
      i += 3;
      while (src[i] === " " || src[i] === "\t") i++;
      const before = words;
      words = [];
      cur = null;
      const save = cmds.length;
      // read one word using the main loop's rules by tokenizing the rest and taking the first word
      const rest = tokenize(src.slice(i));
      const w = rest.cmds[0]?.words[0];
      words = before;
      if (!w) {
        unreadable = true;
        break;
      }
      stdin = { text: w.t };
      i += w.raw.length;
      void save;
      continue;
    }
    if (c === "<" && src[i + 1] === "<") {
      endWord();
      let k = i + 2;
      const strip = src[k] === "-";
      if (strip) k++;
      while (src[k] === " " || src[k] === "\t") k++;
      const m = src.slice(k).match(/^(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>()]+))/);
      if (!m) {
        unreadable = true;
        break;
      }
      pendingHeredocs.push({ delim: m[1] ?? m[2] ?? m[3], strip, quoted: m[1] != null || m[2] != null, cmd: null });
      i = k + m[0].length;
      continue;
    }
    if (c === ">" || c === "<" || (c === "&" && src[i + 1] === ">")) {
      // A redirection: the operator and its target are not arguments. A bare fd number before it goes too.
      if (cur && /^\d+$/.test(cur.raw)) cur = null;
      else endWord();
      let k = i + 1;
      if (c === "&") k++;
      if (src[k] === ">" || src[k] === "|") k++;
      if (src[k] === "&") {
        k++;
        while (/[\d-]/.test(src[k] ?? "")) k++;
        i = k;
        continue;
      }
      while (src[k] === " " || src[k] === "\t") k++;
      // skip the target word
      const rest = tokenize(src.slice(k));
      const w = rest.cmds[0]?.words[0];
      i = k + (w ? w.raw.length : 0);
      continue;
    }
    if (c === "|") {
      const or = src[i + 1] === "|"; // || is "or", not a pipe
      endCmd(!or);
      i += or || src[i + 1] === "&" ? 2 : 1;
      continue;
    }
    if (c === "&") {
      endCmd();
      i += src[i + 1] === "&" ? 2 : 1;
      continue;
    }
    if (c === ";" || c === "(" || c === ")") {
      endCmd();
      i++;
      continue;
    }
    startWord();
    cur.t += c;
    cur.raw += c;
    i++;
  }
  endCmd();
  return { cmds, subs, unreadable };
}

// ---------------------------------------------------------------- what runs
const PKG_BIN = { "netlify-cli": "netlify", "@netlify/cli": "netlify", "firebase-tools": "firebase", "@railway/cli": "railway", "@cloudflare/wrangler": "wrangler", "vercel-cli": "vercel", now: "vercel", "@aws-amplify/cli": "amplify", "eas-cli": "eas", "@expo/eas-cli": "eas", "@supabase/cli": "supabase", "supabase-cli": "supabase", "gh-pages": "gh-pages", "surge": "surge", "convex": "convex", "sst": "sst", "serverless": "serverless", "aws-cdk": "cdk", "@render/cli": "render", "appwrite-cli": "appwrite", "deployctl": "deployctl" };
const DEPLOY_BINS = new Set(["vercel", "netlify", "ntl", "supabase", "firebase", "wrangler", "fly", "flyctl", "railway", "gcloud", "aws", "amplify", "eas", "docker", "heroku", "render", "gh-pages", "surge", "convex", "sst", "serverless", "sls", "cdk", "pulumi", "kamal", "appwrite", "deployctl", "zeabur", "git", "expo"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "ash", "mksh"]);

const normBin = (w) => {
  let b = w.split("/").pop();
  if (!b.startsWith("@")) b = b.replace(/@[^@]*$/, "");
  else b = b.replace(/^(@[^@]+)@.*$/, "$1");
  return PKG_BIN[b] ?? b;
};

// Flags of wrapper programs that take a value, so the value isn't mistaken for the program.
const WRAPPER_VALUE_FLAGS = {
  sudo: ["-u", "-g", "-C", "-D", "-h", "-p", "-U", "-r", "-t", "-T", "--user", "--group"],
  doas: ["-u", "-C"],
  env: ["-u", "-C", "-S", "--unset", "--chdir"],
  nice: ["-n", "--adjustment"],
  ionice: ["-c", "-n", "-p"],
  timeout: ["-s", "-k", "--signal", "--kill-after"],
  exec: ["-a"],
  time: ["-f", "-o", "--format", "--output"],
  stdbuf: ["-i", "-o", "-e"],
  xargs: ["-I", "-n", "-P", "-L", "-d", "-s", "-E", "-a", "--max-args", "--max-procs", "--delimiter", "--arg-file", "-i"],
  watch: ["-n", "-d", "--interval"],
  npx: ["-p", "--package", "-c", "--call"],
  bunx: ["-p", "--package"],
  caffeinate: ["-t", "-w"],
  ssh: ["-p", "-i", "-l", "-o", "-F", "-J", "-b", "-c", "-D", "-E", "-e", "-I", "-L", "-m", "-O", "-Q", "-R", "-S", "-W", "-w", "-B"],
};
const WRAPPERS = new Set(["sudo", "doas", "env", "nice", "ionice", "nohup", "timeout", "exec", "time", "stdbuf", "xargs", "watch", "command", "builtin", "caffeinate", "chronic", "unbuffer", "npx", "bunx", "pnpx", "dotenv", "cross-env", "env-cmd", "op", "doppler", "infisical"]);

// Strip wrappers and package runners until the real program is first. Returns { prog, args } or a special.
function unwrap(words) {
  let w = words.slice();
  for (let guard = 0; guard < 20 && w.length; guard++) {
    const first = w[0];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
      w.shift();
      continue;
    }
    const b = normBin(first);
    if (b === "command" || b === "builtin") {
      if (w[1] === "-v" || w[1] === "-V") return { prog: null, args: [] }; // a lookup, not a run
      w = w.slice(1).filter((x, i) => !(i === 0 && x === "-p"));
      continue;
    }
    if (b === "ssh") {
      // ssh [opts] host command… : the command runs remotely, but it is still a deploy if it deploys.
      let k = 1;
      while (k < w.length && w[k].startsWith("-")) k += WRAPPER_VALUE_FLAGS.ssh.includes(w[k]) ? 2 : 1;
      return { remote: w.slice(k + 1).join(" ") };
    }
    if (b === "op" || b === "doppler" || b === "infisical" || b === "dotenv" || b === "env-cmd") {
      // secret injectors: `op run -- cmd`, `doppler run -- cmd`, `dotenv -e .env -- cmd`
      const dd = w.indexOf("--");
      if (dd >= 0) {
        w = w.slice(dd + 1);
        continue;
      }
      if (b === "dotenv" || b === "env-cmd") {
        let k = 1;
        while (k < w.length && w[k].startsWith("-")) k += ["-e", "-f", "-c", "-v"].includes(w[k]) ? 2 : 1;
        w = w.slice(k);
        continue;
      }
      return { prog: b, args: w.slice(1) };
    }
    if (b === "cross-env") {
      w = w.slice(1);
      continue;
    }
    if (WRAPPERS.has(b)) {
      const vf = WRAPPER_VALUE_FLAGS[b] || [];
      let k = 1;
      let pkg = null;
      while (k < w.length && w[k].startsWith("-") && w[k] !== "--") {
        const f = w[k].split("=")[0];
        if ((b === "npx" || b === "bunx") && (f === "-p" || f === "--package")) pkg = w[k].includes("=") ? w[k].split("=")[1] : w[k + 1];
        if (b === "npx" && (f === "-c" || f === "--call")) return { inline: w[k + 1] ?? "" };
        k += vf.includes(w[k]) ? 2 : 1;
      }
      if (w[k] === "--") k++;
      if (b === "timeout" && k < w.length && /^[\d.]+[smhd]?$/.test(w[k])) k++;
      if (b === "nice" && /^-\d+$/.test(w[1] ?? "")) k = Math.max(k, 2);
      void pkg;
      w = w.slice(k);
      continue;
    }
    // package-manager runners
    if ((b === "pnpm" || b === "yarn") && w[1] === "dlx") {
      w = w.slice(2).filter((x) => x !== "--");
      while (w[0]?.startsWith("-")) w.shift();
      continue;
    }
    if (b === "pnpm" && w[1] === "exec") {
      w = w.slice(2);
      continue;
    }
    if (b === "npm" && (w[1] === "exec" || w[1] === "x")) {
      let k = 2;
      while (k < w.length && w[k].startsWith("-") && w[k] !== "--") k += ["--package", "-p", "-c", "--call", "-w", "--workspace"].includes(w[k]) ? 2 : 1;
      if (w[k] === "--") k++;
      w = w.slice(k);
      continue;
    }
    if (b === "bun" && w[1] === "x") {
      w = w.slice(2);
      continue;
    }
    if ((b === "pnpm" || b === "yarn") && w[1] && DEPLOY_BINS.has(normBin(w[1])) && normBin(w[1]) !== "git") {
      w = w.slice(1);
      continue;
    }
    if (b === "node" || b === "bun" || b === "deno" || b === "tsx") {
      // node path/to/vercel/dist/index.js --prod, node $(which vercel) --prod
      const script = w.slice(1).find((x) => !x.startsWith("-"));
      if (script) {
        const hit = [...DEPLOY_BINS].find((d) => d !== "git" && d !== "docker" && new RegExp(`(^|[/\\s\`(])${d}([/\\s\`)]|$|\\.|-cli)`).test(script));
        if (hit) return { prog: hit, args: w.slice(w.indexOf(script) + 1) };
      }
      return { prog: b, args: w.slice(1) };
    }
    return { prog: b, args: w.slice(1) };
  }
  return { prog: null, args: [] };
}

// The first word that isn't a flag, skipping the values of flags that take one.
function positionals(args, valueFlags = []) {
  const out = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "--") {
      out.push(...args.slice(k + 1).filter((x) => !x.startsWith("-")));
      break;
    }
    if (a.startsWith("-")) {
      if (!a.includes("=") && valueFlags.includes(a)) k++;
      continue;
    }
    out.push(a);
  }
  return out;
}
const flagValue = (args, names) => {
  for (let k = 0; k < args.length; k++) {
    for (const nm of names) {
      if (args[k] === nm) return args[k + 1];
      if (args[k].startsWith(nm + "=")) return args[k].slice(nm.length + 1);
    }
  }
  return undefined;
};

const VERCEL_SAFE = new Set(["env", "login", "logout", "whoami", "link", "unlink", "pull", "build", "dev", "ls", "list", "inspect", "logs", "domains", "dns", "certs", "secrets", "teams", "switch", "projects", "project", "init", "help", "git", "integration", "integrations", "bisect", "telemetry", "open", "target", "targets", "blob", "cache", "mcp", "httpstat", "curl", "microfrontends", "guidance", "install", "i", "remove", "rm", "upgrade", "api", "webhooks", "flags", "edge-config", "login", "completion"]);
const VERCEL_VALUE = ["--cwd", "--scope", "-S", "--token", "-t", "-A", "--local-config", "--global-config", "-Q", "--team", "-T", "-e", "--env", "-b", "--build-env", "-m", "--meta", "--regions", "--archive", "--target"];
const DEPLOY_BRANCHES = /^(main|master|production|prod|release|live|gh-pages|deploy)$/;
const GIT_DEPLOY_FILES = ["vercel.json", ".vercel/project.json", "netlify.toml", ".netlify/state.json", "render.yaml", "railway.json", "railway.toml", "amplify.yml", "app.json", "Procfile", "fly.toml", ".github/workflows"];

// Is this one program run a deploy? Returns null (no), or { kind, target, ask } where target is a folder or null.
function deployOf(prog, args, cwd) {
  if (!prog) return null;
  if (args.some((a) => HELP.has(a))) return null;
  const pos = (vf) => positionals(args, vf);
  switch (prog) {
    case "vercel": {
      const p = pos(VERCEL_VALUE);
      const sub = p[0];
      if (sub && VERCEL_SAFE.has(sub)) return null;
      let target = flagValue(args, ["--cwd"]);
      if (sub && !["deploy", "promote", "redeploy", "rollback", "alias"].includes(sub)) target ??= sub; // vercel ./web
      else if (sub === "deploy" && p[1]) target ??= p[1];
      return { kind: "vercel", target };
    }
    case "netlify":
    case "ntl": {
      const p = pos(["--cwd", "--filter", "--auth", "--site", "-s", "--dir", "-d", "--functions", "-f", "--alias", "--message", "-m", "--context"]);
      return p[0] === "deploy" || p[0] === "functions:deploy" ? { kind: "netlify", target: flagValue(args, ["--cwd"]) } : null;
    }
    case "supabase": {
      const p = pos(["--workdir", "--profile", "--project-ref", "--db-url", "--output", "-o", "--password", "-p", "--schema", "-s", "--include-roles"]);
      const linked = args.some((a) => a === "--linked" || a.startsWith("--db-url"));
      const target = flagValue(args, ["--workdir"]);
      if (p[0] === "db" && p[1] === "push") return { kind: "supabase db push", target };
      if (p[0] === "db" && p[1] === "reset" && linked) return { kind: "supabase db reset", target };
      if (p[0] === "migration" && p[1] === "up" && linked) return { kind: "supabase migration up", target };
      if (p[0] === "functions" && p[1] === "deploy") return { kind: "supabase functions deploy", target };
      if (p[0] === "config" && p[1] === "push") return { kind: "supabase config push", target };
      if (p[0] === "storage" && ["cp", "mv"].includes(p[1]) && p.slice(2).some((x) => x.startsWith("ss:"))) return { kind: "supabase storage upload", target };
      return null;
    }
    case "firebase": {
      const p = pos(["--project", "-P", "--config", "-c", "--token", "--account", "--only", "--except", "-m", "--message"]);
      return p[0] === "deploy" || /:deploy$/.test(p[0] ?? "") ? { kind: "firebase deploy", target: null } : null;
    }
    case "wrangler": {
      const p = pos(["-c", "--config", "-e", "--env", "--cwd", "--name", "--compatibility-date", "--project-name", "--branch", "--commit-message", "--commit-hash", "--message", "--tag", "--version-id"]);
      const remote = args.includes("--remote");
      if (["deploy", "publish"].includes(p[0])) return { kind: "wrangler deploy", target: flagValue(args, ["--cwd"]) };
      if (p[0] === "pages" && ["deploy", "publish"].includes(p[1])) return { kind: "wrangler pages deploy", target: null };
      if (p[0] === "versions" && p[1] === "deploy") return { kind: "wrangler versions deploy", target: null };
      if (p[0] === "d1" && remote && (p[1] === "execute" || (p[1] === "migrations" && p[2] === "apply"))) return { kind: "wrangler d1 (remote)", target: null };
      return null;
    }
    case "fly":
    case "flyctl": {
      const p = pos(["-a", "--app", "-c", "--config", "--image", "-i", "--region", "-r", "--strategy"]);
      return ["deploy", "launch"].includes(p[0]) ? { kind: "fly deploy", target: p[1] } : null;
    }
    case "railway": {
      const p = pos(["-s", "--service", "-e", "--environment", "-p", "--project"]);
      return ["up", "deploy", "redeploy"].includes(p[0]) ? { kind: "railway up", target: p[1] } : null;
    }
    case "gcloud": {
      const p = pos(["--project", "--region", "--source", "--image", "--config", "--account"]);
      return p.slice(0, 3).includes("deploy") || (p[0] === "builds" && p[1] === "submit") ? { kind: "gcloud deploy", target: flagValue(args, ["--source"]) } : null;
    }
    case "aws": {
      const p = pos(["--app-id", "--branch-name", "--region", "--profile", "--stack-name", "--function-name", "--template-file", "--output"]);
      return p.slice(0, 2).some((x) => /^(start-deployment|deploy|update-function-code|create-deployment)$/.test(x)) ? { kind: "aws deploy", target: null } : null;
    }
    case "amplify":
      return ["publish", "push"].includes(pos([])[0]) ? { kind: "amplify publish", target: null } : null;
    case "eas": {
      const p = pos(["--branch", "--platform", "-p", "--profile", "-e", "--message", "-m", "--channel"]);
      if (p[0] === "update" || p[0] === "submit" || (p[0] === "build" && args.includes("--auto-submit"))) return { kind: `eas ${p[0]}`, target: null };
      return null;
    }
    case "expo":
      return pos([])[0] === "publish" ? { kind: "expo publish", target: null } : null;
    case "docker": {
      const p = pos(["--config", "-c", "--context", "-H", "--host"]);
      return p[0] === "push" || (p[0] === "image" && p[1] === "push") ? { kind: "docker push", target: null } : null;
    }
    case "heroku": {
      const p = pos(["-a", "--app", "-r", "--remote"]);
      return /release|deploy|rollback/.test(p[0] ?? "") ? { kind: "heroku release", target: null } : null;
    }
    case "render":
      return pos([]).slice(0, 2).some((x) => /^deploy/.test(x)) ? { kind: "render deploy", target: null } : null;
    case "gh-pages":
    case "surge":
      return { kind: prog, target: null };
    case "convex":
    case "sst":
    case "serverless":
    case "sls":
    case "cdk":
    case "kamal":
    case "deployctl":
    case "zeabur":
      return pos(["--stage", "--profile", "--region", "-c", "--config", "--project"])[0] === "deploy" ? { kind: `${prog} deploy`, target: null } : null;
    case "appwrite":
      return ["deploy", "push"].includes(pos([])[0]) ? { kind: "appwrite deploy", target: null } : null;
    case "pulumi":
      return pos(["-s", "--stack", "-C", "--cwd"])[0] === "up" ? { kind: "pulumi up", target: flagValue(args, ["-C", "--cwd"]) } : null;
    case "gh": {
      const p = pos(["-R", "--repo", "-r", "--ref", "-f", "-F", "--field", "--raw-field"]);
      return p[0] === "workflow" && p[1] === "run" && /deploy|release|prod|publish/i.test(p[2] ?? "") ? { kind: "gh workflow run", target: null } : null;
    }
    case "git": {
      const p = pos(["-C", "-c", "--git-dir", "--work-tree", "-o", "--push-option", "--repo", "--receive-pack", "--exec"]);
      const C = flagValue(args, ["-C"]);
      const at = C ? path.resolve(cwd, expand(C)) : cwd;
      if (p[0] !== "push") return null;
      if (args.includes("--dry-run") || args.includes("-n") || args.includes("--tags") && p.length <= 2) return null;
      const remote = p[1];
      const refs = p.slice(2);
      if (remote && /^(heroku|dokku|production|prod|deploy|live)$/.test(remote)) return { kind: `git push ${remote}`, target: C ?? null };
      let branches = refs.map((r) => r.replace(/^\+/, "").split(":").pop().replace(/^refs\/heads\//, ""));
      if (!branches.length) {
        try {
          branches = [execFileSync("git", ["-C", at, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim()];
        } catch {
          branches = ["main"]; // can't tell: assume the branch that deploys
        }
      }
      if (!branches.some((b) => DEPLOY_BRANCHES.test(b) || b === "HEAD")) return null;
      // A push only deploys when a host deploys from git. With its config file in the project we're sure;
      // without one it might still (Vercel and Netlify often deploy from git with no file), so we ask instead of refusing.
      const sure = GIT_DEPLOY_FILES.some((f) => fs.existsSync(path.join(at, f)));
      return { kind: `git push to ${branches.join(", ")}`, target: C ?? null, soft: !sure };
    }
    default:
      return null;
  }
}

const expand = (p) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);
const SCRIPT_NAME = /(^|[\/:._-])(deploy|release|ship|publish|prod|production|go-live|launch)([\/:._-]|$)/i;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- the walk
// Returns { deploys: [{ kind, dir, soft }], maybe: [reason] }.
export function classify(command, cwd = process.cwd()) {
  const deploys = [];
  const maybe = [];
  walk(command, path.resolve(cwd), 0, deploys, maybe);
  return { deploys, maybe };
}

function walk(src, cwd, depth, deploys, maybe) {
  if (depth > MAX_DEPTH) {
    maybe.push("the command nests too deeply to read");
    return cwd;
  }
  const { cmds, subs, unreadable } = tokenize(src);
  if (unreadable && /\b(vercel|netlify|ntl|supabase|firebase|wrangler|fly|flyctl|railway|deploy|push|publish|release)\b/.test(src)) maybe.push("the command's quoting can't be read with certainty");
  for (const s of subs) walk(s, cwd, depth + 1, deploys, maybe);
  let here = cwd;
  let prev = null;
  for (const c of cmds) {
    const before = prev;
    prev = c;
    let words = c.words.map((w) => w.t);
    while (words.length && SEPARATOR_WORDS.has(words[0])) words.shift();
    if (!words.length) {
      if (c.stdin && c.stdin !== "pipe") continue;
      continue;
    }
    if (SKIP_WHOLE.has(words[0])) continue;
    if (/^(fi|done|esac)$/.test(words[0])) continue;
    const u = unwrap(words);
    if (u.remote != null) {
      walk(u.remote, here, depth + 1, deploys, maybe);
      continue;
    }
    if (u.inline != null) {
      walk(u.inline, here, depth + 1, deploys, maybe);
      continue;
    }
    const { prog, args } = u;
    if (!prog) continue;
    // cd changes where everything after it runs.
    if (prog === "cd" || prog === "pushd") {
      const d = args.find((a) => !a.startsWith("-"));
      if (d && !d.includes("$") && !d.includes("`")) here = path.resolve(here, expand(d));
      else if (!d) here = os.homedir();
      continue;
    }
    if (SHELLS.has(prog)) {
      // bash -c '…', bash -lc '…', bash -e -c '…'
      let script = null;
      let sawC = false;
      let file = null;
      for (let k = 0; k < args.length; k++) {
        const a = args[k];
        if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(a)) sawC = true;
        else if (a === "-o" || a === "+o" || a === "--rcfile" || a === "--init-file") k++;
        else if (!a.startsWith("-") && !a.startsWith("+")) {
          if (sawC) script = a;
          else file = a;
          break;
        }
      }
      if (script != null) walk(script, here, depth + 1, deploys, maybe);
      else if (file) runScriptFile(file, here, depth, deploys, maybe);
      else if (c.stdin && c.stdin !== "pipe") walk(c.stdin.text, here, depth + 1, deploys, maybe);
      else if (c.stdin === "pipe" && before && ["echo", "printf"].includes(normBin(before.words[0]?.t ?? ""))) walk(before.words.slice(1).filter((w) => !/^-[neE]+$/.test(w.t)).map((w) => w.t.replace(/\\n/g, "\n")).join(" "), here, depth + 1, deploys, maybe);
      else if (c.stdin === "pipe") maybe.push("a command is piped into a shell, so what it runs can't be read");
      continue;
    }
    if (prog === "eval") {
      walk(c.words.slice(c.words.findIndex((w) => w.t === "eval") + 1).map((w) => w.t).join(" "), here, depth + 1, deploys, maybe);
      continue;
    }
    if (prog === "source" || prog === ".") {
      if (args[0]) runScriptFile(args[0], here, depth, deploys, maybe);
      continue;
    }
    if (prog === "xargs") continue; // unwrap() already moved past xargs
    // Shell scripts run by path: read them.
    const progWord = words.find((w) => normBin(w) === prog) ?? words[0];
    if ((progWord.includes("/") || /\.(sh|bash|zsh)$/.test(prog)) && !DEPLOY_BINS.has(prog) && !["node", "bun", "deno", "python", "python3"].includes(prog)) {
      runScriptFile(progWord, here, depth, deploys, maybe);
      continue;
    }
    // Package-manager scripts: read what the script really runs.
    if (["npm", "pnpm", "yarn", "bun"].includes(prog)) {
      runPackageScript(prog, args, here, depth, deploys, maybe);
      continue;
    }
    if (["make", "just", "task", "mage", "rake"].includes(prog)) {
      const p = positionals(args, ["-C", "-f", "--file", "-d", "--directory", "-j"]);
      if (p.some((t) => SCRIPT_NAME.test(t))) deploys.push({ kind: `${prog} ${p.find((t) => SCRIPT_NAME.test(t))}`, dir: here });
      continue;
    }
    const d = deployOf(prog, args, here);
    if (d) deploys.push({ kind: d.kind, dir: d.target ? path.resolve(here, expand(d.target)) : here, soft: Boolean(d.soft) });
  }
  return here;
}

function runScriptFile(file, cwd, depth, deploys, maybe) {
  const full = path.resolve(cwd, expand(file));
  let text = null;
  try {
    if (fs.statSync(full).size < 512 * 1024) text = fs.readFileSync(full, "utf8");
  } catch {}
  if (text != null && !text.includes("\0")) walk(text, path.dirname(full) === cwd ? cwd : cwd, depth + 1, deploys, maybe);
  else if (SCRIPT_NAME.test(path.basename(file))) deploys.push({ kind: `script ${path.basename(file)}`, dir: cwd });
}

const PM_VALUE = ["--prefix", "-C", "--dir", "--cwd", "--filter", "-F", "-w", "--workspace", "--loglevel", "--reporter"];
const PM_BUILTINS = {
  npm: new Set(["install", "i", "ci", "add", "uninstall", "remove", "rm", "update", "up", "test", "t", "start", "stop", "restart", "init", "create", "publish", "pack", "link", "ls", "list", "outdated", "audit", "config", "view", "info", "version", "whoami", "login", "logout", "cache", "exec", "x", "doctor", "fund", "prune", "dedupe", "rebuild", "help", "search", "explain", "why", "pkg", "query", "sbom", "set", "get", "token", "owner", "team", "access", "deprecate", "dist-tag", "unpublish", "star", "stars", "docs", "repo", "bugs", "edit", "explore", "hook", "org", "ping", "prefix", "profile", "root", "shrinkwrap", "completion", "diff", "find-dupes", "install-test", "it", "cit", "clean-install"]),
  pnpm: new Set(["install", "i", "add", "remove", "rm", "update", "up", "test", "t", "start", "init", "create", "publish", "pack", "link", "ls", "list", "outdated", "audit", "config", "view", "info", "why", "exec", "dlx", "store", "deploy", "fetch", "import", "patch", "patch-commit", "prune", "rebuild", "root", "setup", "env", "licenses", "doctor", "help", "approve-builds", "self-update", "unlink", "recursive", "-r"]),
  yarn: new Set(["install", "add", "remove", "upgrade", "up", "test", "start", "init", "create", "publish", "pack", "link", "list", "outdated", "audit", "config", "info", "why", "dlx", "exec", "workspaces", "workspace", "cache", "set", "plugin", "dedupe", "explain", "npm", "patch", "rebuild", "unplug", "version", "constraints", "help", "bin", "node", "global", "import", "licenses", "owner", "team", "unlink", "check", "autoclean", "generate-lock-entry"]),
  bun: new Set(["install", "i", "add", "remove", "rm", "update", "test", "init", "create", "publish", "pm", "link", "unlink", "outdated", "audit", "x", "build", "upgrade", "repl", "exec", "patch", "info", "why", "help"]),
};

function runPackageScript(pm, args, cwd, depth, deploys, maybe) {
  const p = positionals(args, PM_VALUE);
  let dir = cwd;
  const prefix = flagValue(args, ["--prefix", "-C", "--dir", "--cwd"]);
  if (prefix) dir = path.resolve(cwd, expand(prefix));
  const filtered = flagValue(args, ["--filter", "-F", "-w", "--workspace"]) != null;
  let name;
  if (p[0] === "run" || p[0] === "run-script" || p[0] === "rum" || p[0] === "urn") name = p[1];
  else if (p[0] && !PM_BUILTINS[pm]?.has(p[0])) name = pm === "npm" ? undefined : p[0]; // yarn deploy, pnpm build, bun deploy
  else if (pm === "npm" && (p[0] === "start" || p[0] === "test" || p[0] === "stop" || p[0] === "restart")) name = p[0];
  else if (pm === "npm" && p[0] === "publish") return; // publishing a package isn't deploying an app
  if (!name) return;
  const dd = args.indexOf("--");
  if (dd >= 0 && args.slice(dd + 1).some((a) => HELP.has(a))) return;
  const pkg = filtered ? undefined : readJson(path.join(dir, "package.json"));
  if (pkg === undefined) {
    // No package.json we can read (a workspace filter, a missing folder): judge by the script's name.
    if (SCRIPT_NAME.test(name)) deploys.push({ kind: `${pm} run ${name}`, dir });
    return;
  }
  const scripts = pkg.scripts || {};
  for (const s of [`pre${name}`, name, `post${name}`]) if (typeof scripts[s] === "string") walk(scripts[s], dir, depth + 1, deploys, maybe);
}
