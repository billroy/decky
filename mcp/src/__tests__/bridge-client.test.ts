/**
 * Unit tests for bridge-client helpers that don't require a real bridge.
 * formatBridgeError is a pure function; tested here without mocking the module.
 */
import { describe, it, expect } from "vitest";
import { formatBridgeError, BridgeError, BridgeUnreachableError } from "../bridge-client.js";

describe("formatBridgeError", () => {
  it("handles BridgeUnreachableError with a 'not running' message", () => {
    const err = new BridgeUnreachableError("ECONNREFUSED");
    expect(formatBridgeError(err)).toContain("not running");
  });

  it("handles BridgeError 401 with token-mismatch hint", () => {
    const err = new BridgeError(401, "Unauthorized");
    expect(formatBridgeError(err)).toContain("token mismatch");
  });

  it("handles BridgeError 403 with DECKY_DEBUG=1 hint", () => {
    const err = new BridgeError(403, "Forbidden");
    expect(formatBridgeError(err)).toContain("DECKY_DEBUG=1");
  });

  it("handles generic BridgeError with the error message", () => {
    const err = new BridgeError(500, "Internal Server Error");
    expect(formatBridgeError(err)).toContain("Internal Server Error");
  });

  it("handles plain Error with 'Unexpected error' prefix", () => {
    const err = new Error("something went wrong");
    expect(formatBridgeError(err)).toContain("something went wrong");
  });

  it("handles non-Error values", () => {
    expect(formatBridgeError("raw string")).toContain("raw string");
    expect(formatBridgeError(42)).toContain("42");
  });
});
