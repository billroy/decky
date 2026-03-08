import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Page } from "@playwright/test";
import { cloneConfig, DEFAULT_TEST_CONFIG, applyUpdateToConfig, type ConfigSnapshot } from "./defaults";
import { MockStreamDeckServer } from "./mock-server";

interface PiHarness {
  server: MockStreamDeckServer;
  page: Page;
  config: ConfigSnapshot;
  sendSnapshot: (snapshot?: ConfigSnapshot) => void;
  waitForUpdateConfig: () => Promise<Record<string, unknown>>;
  markMessageCursor: () => number;
  waitForUpdateConfigAfter: (cursor: number) => Promise<Record<string, unknown>>;
  ackWithSnapshot: (updatePayload: Record<string, unknown>) => Promise<ConfigSnapshot>;
  sendUpdateError: (updatePayload: Record<string, unknown>, error?: string) => void;
}

interface PiFixtures {
  piHarness: PiHarness;
  piInitialConfig: ConfigSnapshot;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const test = base.extend<PiFixtures>({
  piInitialConfig: [cloneConfig(DEFAULT_TEST_CONFIG), { option: true }],
  piHarness: async ({ page, piInitialConfig }, use) => {
    const server = await MockStreamDeckServer.start();
    const config = cloneConfig(piInitialConfig);

    const piPath = path.resolve(
      __dirname,
      "../../../com.decky.controller.sdPlugin/ui/property-inspector-v2.html",
    );

    await page.goto(`file://${piPath}`);

    await page.evaluate(
      ({ port }) => {
        const actionInfo = JSON.stringify({ action: "com.decky.controller.slot" });
        (window as unknown as { connectElgatoStreamDeckSocket: Function }).connectElgatoStreamDeckSocket(
          port,
          "test-context",
          "registerPropertyInspector",
          "{}",
          actionInfo,
        );
      },
      { port: server.port },
    );

    await server.waitForPayloadType("piReady");

    const sendSnapshot = (snapshot?: ConfigSnapshot) => {
      server.sendToPI(snapshot ?? config);
    };

    sendSnapshot();

    await expect(page.locator("#conn-status")).toContainText("Connected to bridge");

    let updateCursor = server.getMessages().length;

    const waitForUpdateConfig = async (): Promise<Record<string, unknown>> => {
      const next = await server.waitForPayloadTypeAfter("updateConfig", updateCursor);
      updateCursor = next.index + 1;
      return next.payload;
    };

    const markMessageCursor = (): number => server.getMessages().length;

    const waitForUpdateConfigAfter = async (cursor: number): Promise<Record<string, unknown>> => {
      const next = await server.waitForPayloadTypeAfter("updateConfig", cursor);
      updateCursor = Math.max(updateCursor, next.index + 1);
      return next.payload;
    };

    const ackWithSnapshot = async (updatePayload: Record<string, unknown>): Promise<ConfigSnapshot> => {
      const requestId = typeof updatePayload.requestId === "string" ? updatePayload.requestId : "";
      if (requestId) {
        server.sendToPI({
          type: "updateConfigAck",
          requestId,
          timestamp: Date.now(),
        });
      }
      const merged = applyUpdateToConfig(config, updatePayload);
      Object.assign(config, merged);
      server.sendToPI(config);
      await expect(page.locator("#status")).toContainText("Applied");
      return cloneConfig(config);
    };

    const sendUpdateError = (updatePayload: Record<string, unknown>, error = "validation failed") => {
      server.sendToPI({
        type: "updateConfigError",
        requestId: typeof updatePayload.requestId === "string" ? updatePayload.requestId : "",
        error,
      });
    };

    await use({
      server,
      page,
      config,
      sendSnapshot,
      waitForUpdateConfig,
      markMessageCursor,
      waitForUpdateConfigAfter,
      ackWithSnapshot,
      sendUpdateError,
    });

    await server.stop();
  },
});

export { expect };
