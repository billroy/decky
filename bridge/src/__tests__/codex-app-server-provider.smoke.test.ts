import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { CodexAppServerProvider } from "../codex-app-server-provider.js";

function hasCodexBinary(): boolean {
  try {
    const result = spawnSync("codex", ["--version"], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

describe("codex app-server provider (smoke)", () => {
  const runIfCodex = hasCodexBinary() ? it : it.skip;

  runIfCodex("starts and stops codex app-server stdio transport", async () => {
    const errors: string[] = [];
    const provider = new CodexAppServerProvider({
      onHookEvent: () => undefined,
      onError: (error) => errors.push(String(error)),
    });

    const started = await provider.start();
    expect(started).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 250));
    provider.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(errors).toEqual([]);
  });
});

