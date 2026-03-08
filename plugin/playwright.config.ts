import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/pi",
  timeout: 10_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    headless: true,
  },
});
