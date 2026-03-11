import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { portableRenameSync } from "../fs-compat.js";

const TEST_DIR = process.env.DECKY_HOME || join(process.cwd(), ".decky-test");

afterEach(() => {
  for (const f of ["fs-compat-src.tmp", "fs-compat-dst.tmp"]) {
    try { unlinkSync(join(TEST_DIR, f)); } catch { /* ignore */ }
  }
});

describe("portableRenameSync", () => {
  it("renames a file to a new destination", () => {
    const src = join(TEST_DIR, "fs-compat-src.tmp");
    const dst = join(TEST_DIR, "fs-compat-dst.tmp");
    writeFileSync(src, "hello", "utf-8");
    portableRenameSync(src, dst);
    expect(readFileSync(dst, "utf-8")).toBe("hello");
    expect(existsSync(src)).toBe(false);
  });

  it("replaces an existing destination file", () => {
    const src = join(TEST_DIR, "fs-compat-src.tmp");
    const dst = join(TEST_DIR, "fs-compat-dst.tmp");
    writeFileSync(dst, "old", "utf-8");
    writeFileSync(src, "new", "utf-8");
    portableRenameSync(src, dst);
    expect(readFileSync(dst, "utf-8")).toBe("new");
    expect(existsSync(src)).toBe(false);
  });

  it("throws when source does not exist", () => {
    const src = join(TEST_DIR, "fs-compat-src.tmp");
    const dst = join(TEST_DIR, "fs-compat-dst.tmp");
    expect(() => portableRenameSync(src, dst)).toThrow();
  });
});
