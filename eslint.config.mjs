import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local data archives and reference attachments (snapshotted copies,
    // not shipped source): exports/ holds per-release package snapshots,
    // attachments/ holds third-party source references.
    "exports/**",
    "attachments/**",
  ]),
]);

export default eslintConfig;
