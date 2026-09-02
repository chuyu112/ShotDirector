import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const distRoot = resolve(process.argv[2] || "dist");
const clientRoot = resolve(distRoot, "client");
const localBridgeAddress = "127.0.0.1:4317";
let javascriptFiles = 0;
let hasSameOriginApi = false;
let hasAuthRoute = false;

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await inspect(path);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    javascriptFiles += 1;
    const source = await readFile(path, "utf8");
    if (source.includes(localBridgeAddress)) {
      throw new Error(`Server client bundle contains the local Bridge address: ${path}`);
    }
    hasSameOriginApi ||= /["'`]\/api["'`]/.test(source);
    hasAuthRoute ||= source.includes("/auth/me");
  }
}

await inspect(clientRoot);

if (javascriptFiles === 0) throw new Error(`No client JavaScript found under ${clientRoot}`);
if (!hasSameOriginApi || !hasAuthRoute) {
  throw new Error("Server client bundle is missing the same-origin /api authentication route");
}

process.stdout.write(`Verified server browser bundle (${javascriptFiles} JavaScript files): /api\n`);
