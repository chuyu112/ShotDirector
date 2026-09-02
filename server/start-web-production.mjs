import { resolve } from "node:path";
import { startProdServer } from "vinext/server/prod-server";

const host = String(process.env.MANJING_WEB_HOST || "127.0.0.1").trim();
const port = Number(process.env.MANJING_WEB_PORT || 3300);
const appRoot = resolve(process.env.MANJING_APP_ROOT || process.cwd());

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("MANJING_WEB_PORT must be a valid TCP port");
}

await startProdServer({
  host,
  port,
  outDir: resolve(appRoot, "dist"),
});
