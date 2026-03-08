import { test, expect } from "./fixtures/pi-fixture";

function findMacro(update: Record<string, unknown>, index: number): Record<string, unknown> {
  const macros = update.macros as Array<Record<string, unknown>>;
  return macros[index];
}

test.describe("PI macro editing", () => {
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

  test("selected target app dropdown updates only selected macro", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.selectOption("#selected-target-app", "cursor");
    await page.click("#btn-save");

    const update = await piHarness.waitForUpdateConfig();
    const macro0 = findMacro(update, 0);
    const macro1 = findMacro(update, 1);
    expect(macro0.targetApp).toBe("cursor");
    expect(macro1.targetApp).toBeUndefined();
    expect(update.showTargetBadge).toBeUndefined();

    await piHarness.ackWithSnapshot(update);
    await expect(page.locator("#selected-target-app")).toHaveValue("cursor");
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
});
