// Copies the website (and the leak simulator) into Greenlit's site, where it's served at greenlit.priberry.com/blockers/.
// Every path in site/ is relative, so the folder works wherever it's placed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.resolve(process.argv[2] || path.join(ROOT, "..", "greenlitlab", "site", "blockers"));
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, "site"), dest, { recursive: true });
// The leak simulator is served at /blockers/simulator/; it carries its own fonts and styles.
fs.cpSync(path.join(ROOT, "simulator"), path.join(dest, "simulator"), { recursive: true });
console.log(`copied site/ and simulator/ to ${dest}`);
