import { test, expect } from "./fixtures/pi-fixture";

test.describe("PI save flow", () => {
  test("enables Apply on target app change and sends correlated updateConfig", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption("#selected-target-app", "codex");
    await expect(page.locator("#btn-save")).toBeEnabled();

    await page.click("#btn-save");
    const update = await piHarness.waitForUpdateConfig();

    expect(update.type).toBe("updateConfig");
    expect(typeof update.requestId).toBe("string");
    const macros = update.macros as Array<Record<string, unknown>>;
    expect(macros[0].targetApp).toBe("codex");

    await piHarness.ackWithSnapshot(update);
    await expect(page.locator("#btn-save")).toBeDisabled();
  });

  test("shows explicit bridge error and keeps Apply enabled", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.fill('#macro-list input[data-field="label"][data-index="0"]', "Yes!");
    await page.click("#btn-save");

    const update = await piHarness.waitForUpdateConfig();
    piHarness.sendUpdateError(update, "bad payload");

    await expect(page.locator("#status")).toContainText("Apply failed: bad payload");
    await expect(page.locator("#btn-save")).toBeEnabled();
  });

  test("applies timeout update and reflects snapshot", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.fill("#timeout", "45");
    await expect(page.locator("#btn-save")).toBeEnabled();

    await page.click("#btn-save");
    const update = await piHarness.waitForUpdateConfig();
    expect(update.approvalTimeout).toBe(45);

    const snapshot = await piHarness.ackWithSnapshot(update);
    expect(snapshot.approvalTimeout).toBe(45);
    await expect(page.locator("#timeout")).toHaveValue("45");
  });
});
