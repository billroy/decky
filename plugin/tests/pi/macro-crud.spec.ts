import { test, expect } from "./fixtures/pi-fixture";

test.describe("PI macro CRUD and scope", () => {
  test("add macro dispatches expanded macro list", async ({ piHarness }) => {
    const { page, config } = piHarness;

    await page.click("#btn-add");
    await page.click("#btn-save");

    const update = await piHarness.waitForUpdateConfig();
    const macros = update.macros as Array<Record<string, unknown>>;
    expect(macros.length).toBe(config.macros.length + 1);

    await piHarness.ackWithSnapshot(update);
    await expect(page.locator("#macro-count")).toContainText(String(macros.length));
  });

  test("remove macro dispatches reduced list", async ({ piHarness }) => {
    const { page, config } = piHarness;

    await page.click('#macro-list [data-remove="0"]');
    await page.click("#btn-save");

    const update = await piHarness.waitForUpdateConfig();
    const macros = update.macros as Array<Record<string, unknown>>;
    expect(macros.length).toBe(config.macros.length - 1);

    await piHarness.ackWithSnapshot(update);
    await expect(page.locator("#macro-count")).toContainText(String(macros.length));
  });

  test("scope toggle switches between selected and all macros", async ({ piHarness }) => {
    const { page } = piHarness;

    await expect(page.locator("#macro-list .macro-item")).toHaveCount(1);
    await page.click("#btn-scope");
    await expect(page.locator("#macro-list .macro-item")).toHaveCount(3);
    await page.click("#btn-scope");
    await expect(page.locator("#macro-list .macro-item")).toHaveCount(1);
  });
});
