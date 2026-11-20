// The guard runs the check through this file, in its own process with a time limit: node run-check.mjs <folder>
// It always prints one line of JSON (the result) and exits 0, so an exit code can never be mistaken for an answer.
import { check } from "./check.mjs";

let r;
try {
  r = check(process.argv[2] || ".");
} catch (e) {
  r = { status: "NOT CHECKED", reason: String(e?.message || e).split("\n")[0].slice(0, 200), blocking: [], other: [], ignored: [], notChecked: [] };
}
process.stdout.write(JSON.stringify(r));
