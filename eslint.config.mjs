import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: here });

const config = [
  {
    ignores: [
      ".next/**",
      ".test-build/**",
      ".worker-build/**",
      ".security-tools/**",
      "mcp-server/dist/**",
      "mcp-server/node_modules/**",
      "node_modules/**",
      "next-env.d.ts",
      // The VS Code extension's copy of harness/ (scripts/bundle.mjs) and its test profile.
      "vscode/server/**",
      "vscode/.vscode-test/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // CommonJS: VS Code loads extensions with require().
    files: ["**/*.cjs", "vscode/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

export default config;
