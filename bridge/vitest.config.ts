import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    globalSetup: ["./src/__tests__/global-setup.ts"],
    setupFiles: ["./src/__tests__/setup-env.ts"],
    pool: "forks",
    maxWorkers: 1,
  },
});
