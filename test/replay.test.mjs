import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { check } from "../src/check.mjs";

test("findings the simulator plays link to a replay of that exact leak", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lb-replay-"));
  fs.mkdirSync(path.join(d, "supabase/migrations"), { recursive: true });
  fs.writeFileSync(path.join(d, "supabase/migrations/001.sql"), "create table profiles (id uuid primary key, email text);\n");
  fs.writeFileSync(path.join(d, "package.json"), '{"name":"x"}');
  const r = await check(d);
  const f = r.blocking.find((x) => x.id.startsWith("scan:no-rls"));
  assert.ok(f, "no-rls finding");
  assert.equal(f.replay, "https://greenlit.priberry.com/blockers/simulator/#v=1&p=no-rls");
  // Every switch in the simulator is a pattern id it knows.
  const sim = fs.readFileSync(new URL("../simulator/sim.js", import.meta.url), "utf8");
  const ids = [...sim.matchAll(/^\s+id: "([\w-]+)", promise:/gm)].map((m) => m[1]);
  const src = fs.readFileSync(new URL("../src/check.mjs", import.meta.url), "utf8");
  for (const id of ids) assert.ok(src.includes(`"${id}"`), `check.mjs SIMULATED is missing ${id}`);
  assert.equal(ids.length, 12);
});
