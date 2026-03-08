import { test, expect } from "./fixtures/pi-fixture";

async function clickColor(page: import("@playwright/test").Page, root: string, rowLabel: string, title: string) {
  const row = page.locator(`${root} .color-row`).filter({ hasText: rowLabel }).first();
  await row.locator(`.swatch[title="${title}"]`).click();
}

test.describe("PI color controls", () => {
  test("page default bg color writes colors.bg", async ({ piHarness }) => {
    const { page } = piHarness;

    await clickColor(page, "#default-colors", "Bg", "Green");
    const update = await piHarness.waitForUpdateConfig();
    expect((update.colors as Record<string, unknown>).bg).toBe("#22c55e");

    await piHarness.ackWithSnapshot(update);
    await expect(page.locator("#status")).toContainText("Applied");
  });

  test("per-macro icon color writes macro override", async ({ piHarness }) => {
    const { page } = piHarness;

    if (await page.locator(".macro-colors-panel").count() === 0) {
      await page.click('[data-colorindex="0"]');
    }
    await clickColor(page, ".macro-colors-panel", "Icon", "Purple");

    const update = await piHarness.waitForUpdateConfig();
    const macro0 = (update.macros as Array<Record<string, unknown>>)[0];
    const colors = macro0.colors as Record<string, unknown>;
    expect(colors.icon).toBe("#8b5cf6");

    await piHarness.ackWithSnapshot(update);
  });

  test("reset page defaults clears colors", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.click("#btn-reset-default-colors");
    const update = await piHarness.waitForUpdateConfig();
    const colors = update.colors as Record<string, unknown>;
    expect(colors.bg).toBe("");
    expect(colors.text).toBe("");
    expect(colors.icon).toBe("");

    await piHarness.ackWithSnapshot(update);
  });

  test("reset all overrides clears page and macro colors", async ({ piHarness }) => {
    const { page } = piHarness;

    await page.click("#btn-reset-all-colors");
    const update = await piHarness.waitForUpdateConfig();

    const colors = update.colors as Record<string, unknown>;
    expect(colors.bg).toBe("");
    const macros = update.macros as Array<Record<string, unknown>>;
    const anyMacroColor = macros.some((m) => !!m.colors);
    expect(anyMacroColor).toBe(false);

    await piHarness.ackWithSnapshot(update);
  });
});
