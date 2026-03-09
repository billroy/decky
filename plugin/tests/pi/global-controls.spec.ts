import { test, expect } from "./fixtures/pi-fixture";

test.describe("PI global controls", () => {
  test("scope placement keeps target app in Selected Slot and target badge in Global", async ({ piHarness }) => {
    const { page } = piHarness;

    const globalSection = page.locator(".section").filter({
      has: page.locator("h3").filter({ hasText: "Global Behavior" }),
    });
    const selectedSection = page.locator(".section").filter({
      has: page.locator("h3").filter({ hasText: "Selected Slot Settings" }),
    });

    await expect(globalSection.locator('select[data-field="targetApp"]')).toHaveCount(0);
    await expect(globalSection.locator("#show-target-badge")).toHaveCount(1);
    await expect(selectedSection.locator('select[data-field="targetApp"]')).toHaveCount(1);
    await expect(selectedSection).not.toContainText("Configure the selected slot");
    await expect(selectedSection.locator("#pi-diag")).toHaveCount(0);
  });

  test("diagnostics are compact and collapsed by default", async ({ piHarness }) => {
    const { page } = piHarness;

    await expect(page.locator("#conn-status")).toContainText("Connected to bridge");
    await expect(page.locator("#conn-dot.connected")).toHaveCount(1);
    await expect(page.locator("#pi-build")).toContainText("PI build:");
    await expect(page.locator("#debug-log")).not.toBeVisible();
  });

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

  test("non-badge applies do not overwrite showTargetBadge", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption('#macro-list select[data-field="targetApp"][data-index="0"]', "codex");
    await page.click("#btn-save");

    const update = await piHarness.waitForUpdateConfig();
    expect(update.showTargetBadge).toBeUndefined();
    await piHarness.ackWithSnapshot(update);
    await expect(page.locator("#show-target-badge")).toBeChecked();
  });

  test("diag text is shown in diagnostics section", async ({ piHarness }) => {
    const { page } = piHarness;

    const diagnosticsSection = page.locator(".section").filter({
      has: page.locator("h3").filter({ hasText: "Diagnostics" }),
    });

    await expect(diagnosticsSection.locator("#pi-diag")).toContainText("[diag build=");
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

  test("random theme re-apply emits a new seed each apply", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption("#theme", "random");
    await page.check('input[name="theme-apply-mode"][value="keep"]');
    await page.click("#btn-theme-apply-confirm");
    const first = await piHarness.waitForUpdateConfig();
    expect(first.theme).toBe("random");
    expect(typeof first.themeSeed).toBe("number");
    await piHarness.ackWithSnapshot(first);

    await page.selectOption("#theme", "random");
    await page.check('input[name="theme-apply-mode"][value="keep"]');
    await page.click("#btn-theme-apply-confirm");
    const second = await piHarness.waitForUpdateConfig();
    expect(second.theme).toBe("random");
    expect(typeof second.themeSeed).toBe("number");
    expect(second.themeSeed).not.toBe(first.themeSeed);
  });

  test("rainbow theme re-apply emits a new seed each apply", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption("#theme", "rainbow");
    await page.check('input[name="theme-apply-mode"][value="keep"]');
    await page.click("#btn-theme-apply-confirm");
    const first = await piHarness.waitForUpdateConfig();
    expect(first.theme).toBe("rainbow");
    expect(typeof first.themeSeed).toBe("number");
    await piHarness.ackWithSnapshot(first);

    await page.selectOption("#theme", "rainbow");
    await page.check('input[name="theme-apply-mode"][value="keep"]');
    await page.click("#btn-theme-apply-confirm");
    const second = await piHarness.waitForUpdateConfig();
    expect(second.theme).toBe("rainbow");
    expect(typeof second.themeSeed).toBe("number");
    expect(second.themeSeed).not.toBe(first.themeSeed);
  });
});
