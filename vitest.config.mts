import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["engine/**/*.test.ts", "src/**/*.test.ts"],
  },
});
