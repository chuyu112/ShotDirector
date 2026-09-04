import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { migratedWritingModelSelection } from "../server/writing-model-selection.mjs";

const dataRoot = resolve(process.argv[2] || process.env.MANJING_DATA_ROOT || "/data");
const apply = process.argv.includes("--apply");
const matches = [];

function visit(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      visit(path);
      continue;
    }
    if (name !== "writing-model-selection.json") continue;
    const saved = JSON.parse(readFileSync(path, "utf8"));
    const result = migratedWritingModelSelection(saved);
    if (!result.migrated) continue;
    matches.push(path);
    if (!apply) continue;
    const stagingPath = `${path}.next`;
    writeFileSync(stagingPath, `${JSON.stringify(result.selection, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(stagingPath, path);
  }
}

visit(dataRoot);
console.log(JSON.stringify({ dataRoot, apply, migrated: matches.length, files: matches }));
