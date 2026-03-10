import { rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export function setup(): void {
  const testHome = resolve(process.cwd(), ".decky-test");
  rmSync(testHome, { recursive: true, force: true });
  mkdirSync(testHome, { recursive: true });
}
