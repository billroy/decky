import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.{test,spec}.ts", ".oracle/**/*.{test,spec}.ts"],
    exclude: ["node_modules", "tests/pi/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/plugin.ts"],
    },
  },
});
