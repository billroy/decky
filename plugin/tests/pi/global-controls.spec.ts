import { test, expect } from "./fixtures/pi-fixture";

test.describe("PI global controls", () => {
  test("theme apply keep mode sends theme + mode and updates selection", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption("#theme", "dracula");
    await expect(page.locator("#theme-apply-panel")).toBeVisible();

    await page.check('input[name="theme-apply-mode"][value="keep"]');
    await page.click("#btn-theme-apply-confirm");

    const update = await piHarness.waitForUpdateConfig();
    expect(update.theme).toBe("dracula");
    expect(update.themeApplyMode).toBe("keep");

    await piHarness.ackWithSnapshot(update);
    await expect(page.locator("#theme")).toHaveValue("dracula");
  });

  test("target badge checkbox toggles and persists", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.uncheck("#show-target-badge");
    await page.click("#btn-save");

    const update = await piHarness.waitForUpdateConfig();
    expect(update.showTargetBadge).toBe(false);

    const snapshot = await piHarness.ackWithSnapshot(update);
    expect(snapshot.showTargetBadge).toBe(false);
    await expect(page.locator("#show-target-badge")).not.toBeChecked();
  });

  test("theme cancel reverts selection and does not dispatch update", async ({ piHarness }) => {
    const { page, server } = piHarness;

    await page.selectOption("#theme", "nord");
    await expect(page.locator("#theme-apply-panel")).toBeVisible();
    await page.click("#btn-theme-apply-cancel");

    await expect(page.locator("#theme")).toHaveValue("dark");
    const sent = server.getMessages().filter((m) => m.event === "sendToPlugin" && m.payload?.type === "updateConfig");
    expect(sent.length).toBe(0);
  });
});
