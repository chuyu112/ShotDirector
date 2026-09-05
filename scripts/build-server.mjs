import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const apiBase = String(process.env.NEXT_PUBLIC_MANJING_API_BASE || "/api").trim();
const siteUrl = String(process.env.NEXT_PUBLIC_MANJING_SITE_URL || "https://kakayiduo.cloud").trim();

if (apiBase !== "/api") {
  throw new Error("Server builds must use the same-origin /api gateway");
}

const site = new URL(siteUrl);
if (site.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(site.hostname)) {
  throw new Error("Server builds require a public HTTPS site URL");
}

const build = spawnSync(npmCommand, ["run", "build"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    NEXT_PUBLIC_MANJING_API_BASE: apiBase,
    NEXT_PUBLIC_MANJING_SITE_URL: site.origin,
  },
  stdio: "inherit",
});

if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const verify = spawnSync(process.execPath, [fileURLToPath(new URL("./verify-server-bundle.mjs", import.meta.url))], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (verify.error) throw verify.error;
process.exit(verify.status ?? 1);
