import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import {
  writeGateFile,
  clearGateFile,
  gateFileExists,
  GATE_FILE_PATH,
  DECKY_DIR_PATH,
} from "../approval-gate.js";

// Ensure ~/.decky/ exists for tests
mkdirSync(DECKY_DIR_PATH, { recursive: true });

afterEach(() => {
  clearGateFile();
});

describe("approval-gate", () => {
  it("writes 'approve' to the gate file", () => {
    writeGateFile("approve");
    expect(existsSync(GATE_FILE_PATH)).toBe(true);
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("approve");
  });

  it("writes 'deny' to the gate file", () => {
    writeGateFile("deny");
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("deny");
  });

  it("writes 'cancel' to the gate file", () => {
    writeGateFile("cancel");
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("cancel");
  });

  it("overwrites an existing gate file", () => {
    writeGateFile("deny");
    writeGateFile("approve");
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("approve");
  });

  it("clearGateFile removes the file", () => {
    writeGateFile("approve");
    expect(gateFileExists()).toBe(true);
    clearGateFile();
    expect(gateFileExists()).toBe(false);
  });

  it("clearGateFile is idempotent (no error if file missing)", () => {
    clearGateFile();
    expect(() => clearGateFile()).not.toThrow();
  });

  it("gateFileExists returns false when no file", () => {
    expect(gateFileExists()).toBe(false);
  });

  it("gateFileExists returns true after write", () => {
    writeGateFile("approve");
    expect(gateFileExists()).toBe(true);
  });

  it("writes nonce-prefixed format when nonce is provided", () => {
    writeGateFile("approve", "abc123");
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("abc123:approve");
  });

  it("writes nonce-prefixed deny", () => {
    writeGateFile("deny", "nonce-42");
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("nonce-42:deny");
  });

  it("writes plain result when nonce is undefined", () => {
    writeGateFile("cancel");
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("cancel");
  });

  it("writes plain result when nonce is empty string", () => {
    writeGateFile("approve", "");
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("approve");
  });
});
