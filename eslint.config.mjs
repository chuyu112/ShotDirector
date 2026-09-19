import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // pi 依赖边界（参考 Proma 的 SDKMessage 隔离层）：@earendil-works/* 只允许
  // 出现在 runner/manjing-pi-harness.mjs；其他模块一律消费 harness 导出的
  // 领域类型，保证 pi 升级时上层零改动。
  {
    files: ["**/*.{ts,tsx,mjs,js}"],
    ignores: ["runner/manjing-pi-harness.mjs"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@earendil-works/*", "@earendil-works/*/*"],
          message: "pi 依赖只允许出现在 runner/manjing-pi-harness.mjs（漫镜唯一的 pi 边界）；其他模块请使用 harness / agent-role-contract 导出的领域类型。",
        }],
      }],
    },
  },
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
