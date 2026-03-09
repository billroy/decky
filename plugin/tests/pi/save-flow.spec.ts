import { test, expect } from "./fixtures/pi-fixture";

test.describe("PI save flow", () => {
  test("enables Apply on target app change and sends correlated updateConfig", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption('#macro-list select[data-field="targetApp"][data-index="0"]', "codex");
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

  test("target app change with badge enabled does not resend badge field", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.check("#show-target-badge");
    await page.selectOption('#macro-list select[data-field="targetApp"][data-index="0"]', "codex");
    await expect(page.locator("#btn-save")).toBeEnabled();

    await page.click("#btn-save");
    const update = await piHarness.waitForUpdateConfig();
    const macros = update.macros as Array<Record<string, unknown>>;
    expect(update.showTargetBadge).toBeUndefined();
    expect(macros[0].targetApp).toBe("codex");

    await piHarness.ackWithSnapshot(update);
    await expect(page.locator("#show-target-badge")).toBeChecked();
    await expect(page.locator('#macro-list select[data-field="targetApp"][data-index="0"]')).toHaveValue("codex");
  });

  test("legacy Claude utility toggles are not present in unified PI", async ({ piHarness }) => {
    const { page } = piHarness;
    await expect(page.locator("#enable-approve-once")).toHaveCount(0);
    await expect(page.locator("#enable-dictation")).toHaveCount(0);
  });

  test("Apply now does not reseed random theme", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption("#theme", "random");
    await page.check('input[name="theme-apply-mode"][value="keep"]');
    await page.click("#btn-theme-apply-confirm");
    const first = await piHarness.waitForUpdateConfig();
    await piHarness.ackWithSnapshot(first);

    await page.fill("#timeout", "35");
    await page.click("#btn-save");
    const second = await piHarness.waitForUpdateConfig();
    expect(second.theme).toBe("random");
    expect(second.themeSeed).toBe(first.themeSeed);
  });

  test("Apply now does not reseed rainbow theme", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption("#theme", "rainbow");
    await page.check('input[name="theme-apply-mode"][value="keep"]');
    await page.click("#btn-theme-apply-confirm");
    const first = await piHarness.waitForUpdateConfig();
    await piHarness.ackWithSnapshot(first);

    await page.fill("#timeout", "40");
    await page.click("#btn-save");
    const second = await piHarness.waitForUpdateConfig();
    expect(second.theme).toBe("rainbow");
    expect(second.themeSeed).toBe(first.themeSeed);
  });

  test("icon edit Apply now keeps random theme seed stable", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption("#theme", "random");
    await page.check('input[name="theme-apply-mode"][value="keep"]');
    await page.click("#btn-theme-apply-confirm");
    const first = await piHarness.waitForUpdateConfig();
    await piHarness.ackWithSnapshot(first);

    await page.selectOption('#macro-list select[data-field="icon"][data-index="0"]', "terminal");
    await page.click("#btn-save");
    const second = await piHarness.waitForUpdateConfig();
    const macros = second.macros as Array<Record<string, unknown>>;
    expect(macros[0].icon).toBe("terminal");
    expect(second.theme).toBe("random");
    expect(second.themeSeed).toBe(first.themeSeed);
  });

  test("icon edit Apply now keeps rainbow theme seed stable", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption("#theme", "rainbow");
    await page.check('input[name="theme-apply-mode"][value="keep"]');
    await page.click("#btn-theme-apply-confirm");
    const first = await piHarness.waitForUpdateConfig();
    await piHarness.ackWithSnapshot(first);

    await page.selectOption('#macro-list select[data-field="icon"][data-index="0"]', "terminal");
    await page.click("#btn-save");
    const second = await piHarness.waitForUpdateConfig();
    const macros = second.macros as Array<Record<string, unknown>>;
    expect(macros[0].icon).toBe("terminal");
    expect(second.theme).toBe("rainbow");
    expect(second.themeSeed).toBe(first.themeSeed);
  });
});
