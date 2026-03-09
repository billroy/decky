import { test, expect } from "./fixtures/pi-fixture";
import { cloneConfig, DEFAULT_TEST_CONFIG } from "./fixtures/defaults";

function findMacro(update: Record<string, unknown>, index: number): Record<string, unknown> {
  const macros = update.macros as Array<Record<string, unknown>>;
  return macros[index];
}

async function clickColor(page: import("@playwright/test").Page, root: string, rowLabel: string, title: string) {
  const row = page.locator(`${root} .color-row`).filter({ hasText: rowLabel }).first();
  await row.locator(`.swatch[title="${title}"]`).click();
}

test.describe("PI macro editing", () => {
  test("uses Prompt wording and includes font-size control", async ({ piHarness }) => {
    const { page } = piHarness;

    await expect(page.locator('#macro-list label:has-text("Prompt")')).toHaveCount(1);
    await expect(page.locator('#macro-list label:has-text("Text to send")')).toHaveCount(0);
    await expect(page.locator('#macro-list label:has-text("Font size")')).toHaveCount(1);
    await expect(page.locator('#macro-list .helper:has-text("Stream Deck title text is not used")')).toHaveCount(0);
  });

  test("label, text, and icon edits are persisted", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.fill('#macro-list input[data-field="label"][data-index="0"]', "Affirm");
    await page.fill('#macro-list textarea[data-field="text"][data-index="0"]', "/affirm");
    await page.selectOption('#macro-list select[data-field="icon"][data-index="0"]', "star");

    await page.click("#btn-save");
    const update = await piHarness.waitForUpdateConfig();
    const macro0 = findMacro(update, 0);
    expect(macro0.label).toBe("Affirm");
    expect(macro0.text).toBe("/affirm");
    expect(macro0.icon).toBe("star");

    await piHarness.ackWithSnapshot(update);
    await expect(page.locator('#macro-list input[data-field="label"][data-index="0"]')).toHaveValue("Affirm");
  });

  test("font size edits are persisted", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.fill('#macro-list input[data-field="fontSize"][data-index="0"]', "34");
    await page.click("#btn-save");

    const update = await piHarness.waitForUpdateConfig();
    const macro0 = findMacro(update, 0);
    expect(macro0.fontSize).toBe(34);

    await piHarness.ackWithSnapshot(update);
    await expect(page.locator('#macro-list input[data-field="fontSize"][data-index="0"]')).toHaveValue("34");
  });

  test("selected-slot target app dropdown updates only selected macro", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption('#macro-list select[data-field="targetApp"][data-index="0"]', "cursor");
    await page.click("#btn-save");

    const update = await piHarness.waitForUpdateConfig();
    const macro0 = findMacro(update, 0);
    const macro1 = findMacro(update, 1);
    expect(macro0.targetApp).toBe("cursor");
    expect(macro1.targetApp).toBeUndefined();
    expect(update.showTargetBadge).toBeUndefined();

    await piHarness.ackWithSnapshot(update);
    await expect(page.locator('#macro-list select[data-field="targetApp"][data-index="0"]')).toHaveValue("cursor");
  });

  test("per-macro target app in list persists", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.click('[data-colorindex="0"]'); // expand colors once to ensure list is interactive
    await page.selectOption('#macro-list select[data-field="targetApp"][data-index="0"]', "chatgpt");
    await page.click("#btn-save");

    const update = await piHarness.waitForUpdateConfig();
    const macro0 = findMacro(update, 0);
    expect(macro0.targetApp).toBe("chatgpt");
    expect(update.showTargetBadge).toBeUndefined();

    await piHarness.ackWithSnapshot(update);
    await expect(page.locator('#macro-list select[data-field="targetApp"][data-index="0"]')).toHaveValue("chatgpt");
  });

  test("macro can be switched to bridge-status widget with interval refresh", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption('#macro-list select[data-widget-type="0"]', "widget");
    await page.selectOption('#macro-list select[data-widget-refresh="0"]', "interval");
    await page.fill('#macro-list input[data-widget-interval="0"]', "7");
    await page.click("#btn-save");

    const update = await piHarness.waitForUpdateConfig();
    const macro0 = findMacro(update, 0);
    expect(macro0.type).toBe("widget");
    expect(macro0.widget).toEqual({
      kind: "bridge-status",
      refreshMode: "interval",
      intervalMinutes: 7,
    });

    await piHarness.ackWithSnapshot(update);
    await expect(page.locator('#macro-list select[data-widget-type="0"]')).toHaveValue("widget");
    await expect(page.locator('#macro-list select[data-widget-refresh="0"]')).toHaveValue("interval");
    await expect(page.locator('#macro-list input[data-widget-interval="0"]')).toHaveValue("7");
  });

  test("switching widget back to command clears widget payload", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption('#macro-list select[data-widget-type="0"]', "widget");
    await page.click("#btn-save");
    const widgetUpdate = await piHarness.waitForUpdateConfig();
    await piHarness.ackWithSnapshot(widgetUpdate);

    await page.selectOption('#macro-list select[data-widget-type="0"]', "macro");
    await page.fill('#macro-list textarea[data-field="text"][data-index="0"]', "run this");
    await page.click("#btn-save");
    const update = await piHarness.waitForUpdateConfig();
    const macro0 = findMacro(update, 0);
    expect(macro0.type).toBeUndefined();
    expect(macro0.widget).toBeUndefined();
    expect(macro0.text).toBe("run this");
  });

  test("submit checkbox persists false for slash-style macros", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.uncheck('#macro-list input[data-field="submit"][data-index="0"]');
    await page.fill('#macro-list textarea[data-field="text"][data-index="0"]', "/help");
    await page.click("#btn-save");

    const update = await piHarness.waitForUpdateConfig();
    const macro0 = findMacro(update, 0);
    expect(macro0.submit).toBe(false);
    expect(macro0.text).toBe("/help");
  });
});

test.describe("PI unconfigured slot promotion", () => {
  test.use({
    piInitialConfig: (() => {
      const cfg = cloneConfig(DEFAULT_TEST_CONFIG);
      cfg.selectedMacroIndex = 5;
      return cfg;
    })(),
  });

  test("targets clicked unconfigured slot and promotes it on Apply", async ({ piHarness }) => {
    const { page } = piHarness;

    await expect(page.locator("#macro-count")).toContainText("slot 6 of 6");
    await expect(page.locator('#macro-list input[data-field="label"][data-index="5"]')).toHaveValue("");

    await page.fill('#macro-list input[data-field="label"][data-index="5"]', "T6");
    await page.fill('#macro-list textarea[data-field="text"][data-index="5"]', "slot six");
    await page.click("#btn-save");

    const update = await piHarness.waitForUpdateConfig();
    const macros = update.macros as Array<Record<string, unknown>>;
    expect(macros).toHaveLength(6);
    expect(macros[2].label).toBe("Build");
    expect(macros[3].label).toBe("");
    expect(macros[4].label).toBe("");
    expect(macros[5].label).toBe("T6");
    expect(macros[5].text).toBe("slot six");
  });

  test("per-slot colors apply on unconfigured slot before label/icon promotion", async ({ piHarness }) => {
    const { page } = piHarness;

    await expect(page.locator("#macro-count")).toContainText("slot 6 of 6");
    if (await page.locator(".macro-colors-panel").count() === 0) {
      await page.click('[data-colorindex="5"]');
    }
    await clickColor(page, ".macro-colors-panel", "Bg", "Green");

    const update = await piHarness.waitForUpdateConfig();
    const macros = update.macros as Array<Record<string, unknown>>;
    expect(macros).toHaveLength(6);
    expect(macros[5].label).toBe("");
    expect(macros[5].text).toBe("");
    expect((macros[5].colors as Record<string, unknown>).bg).toBe("#22c55e");
  });

  test("canonicalizes stale placeholder metadata on color-only updates", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption('#macro-list select[data-field="targetApp"][data-index="5"]', "codex");
    if (await page.locator(".macro-colors-panel").count() === 0) {
      await page.click('[data-colorindex="5"]');
    }
    await clickColor(page, ".macro-colors-panel", "Bg", "Green");

    const update = await piHarness.waitForUpdateConfig();
    const macros = update.macros as Array<Record<string, unknown>>;
    expect(macros).toHaveLength(6);
    expect(macros[5].label).toBe("");
    expect(macros[5].text).toBe("");
    expect(macros[5].targetApp).toBeUndefined();
    expect(macros[5].submit).toBeUndefined();
    expect((macros[5].colors as Record<string, unknown>).bg).toBe("#22c55e");
  });
});
