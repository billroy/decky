import { test, expect } from "./fixtures/pi-fixture";

test.describe("PI/plugin compatibility", () => {
  test("shows rebuild warning when plugin protocol is missing", async ({ piHarness }) => {
    const stale = { ...piHarness.config } as Record<string, unknown>;
    delete stale.piProtocolVersion;
    piHarness.sendSnapshot(stale as typeof piHarness.config);

    await expect(piHarness.page.locator("#compat-warning")).toContainText("Plugin rebuild required");
  });

  test("hides rebuild warning when protocol matches", async ({ piHarness }) => {
    piHarness.sendSnapshot({
      ...piHarness.config,
      piProtocolVersion: 2,
    });

    await expect(piHarness.page.locator("#compat-warning")).toBeHidden();
  });
});
