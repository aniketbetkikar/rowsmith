import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Import boundaries (see CLAUDE.md and engine-spec.md section 2).
// Flat config replaces a rule per matching block instead of merging,
// so the core block repeats the engine-wide restrictions.

const engineWide = [
  {
    group: ["@/*", "**/src/**"],
    message: "The engine must not import from the Next.js app.",
  },
  {
    group: ["server-only"],
    message: "The engine runs in plain Node; 'server-only' throws there.",
  },
];

const coreOnly = [
  {
    group: [
      "@engine/db",
      "@engine/db/*",
      "@engine/queue",
      "@engine/queue/*",
      "@engine/processors",
      "@engine/processors/*",
      "@engine/eval",
      "@engine/eval/*",
      "@engine/index",
      "../db/*",
      "../queue/*",
      "../processors/*",
      "../eval/*",
      "../index",
    ],
    message:
      "engine/core may import only contracts, config, llm and utils.",
  },
  {
    group: ["mongodb", "bullmq", "ioredis"],
    message: "engine/core is pure logic: no DB or queue.",
  },
];

const appOnly = [
  {
    group: [
      "@engine/*",
      "!@engine/contracts",
      "!@engine/contracts/*",
      "!@engine/db",
      "!@engine/db/*",
      // gitignore semantics: re-include the folder, re-exclude its files,
      // then allow the two shared modules.
      "!@engine/core",
      "@engine/core/*",
      "!@engine/core/suggest",
      "!@engine/core/csv",
    ],
    message:
      "The app may import only @engine/contracts, @engine/db, @engine/core/suggest and @engine/core/csv.",
  },
  {
    group: ["**/engine/**"],
    message: "Import the engine through the @engine/* alias.",
  },
  {
    group: ["@google/genai", "@google/genai/*", "@langchain/*"],
    message:
      "The app makes no LLM calls except /api/suggest via @engine/core/suggest.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["engine/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: engineWide }],
    },
  },
  {
    files: ["engine/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...engineWide, ...coreOnly] },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: appOnly }],
    },
  },
  // Named exports only, except where Next.js requires a default export.
  {
    files: ["engine/**/*.ts", "src/**/*.{ts,tsx}"],
    ignores: [
      "src/app/**/{page,layout,loading,error,not-found,template,default,global-error}.tsx",
    ],
    rules: {
      "import/no-default-export": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
