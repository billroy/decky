import { describe, it, expect } from "vitest";
import {
  resolveColor,
  resolveIcon,
  validateTheme,
  validateSlotType,
  validateTargetApp,
  slotSupportsIcon,
} from "../vocabularies.js";

describe("resolveColor", () => {
  it("passes through hex values unchanged", () => {
    expect(resolveColor("#ff0000")).toBe("#ff0000");
    expect(resolveColor("#abc")).toBe("#abc");
  });

  it("resolves named colors to hex", () => {
    expect(resolveColor("green")).toMatch(/^#/);
    expect(resolveColor("red")).toMatch(/^#/);
    expect(resolveColor("white")).toMatch(/^#/);
  });

  it("is case-insensitive for named colors", () => {
    expect(resolveColor("Green")).toBe(resolveColor("green"));
    expect(resolveColor("RED")).toBe(resolveColor("red"));
  });

  it("passes through unknown values unchanged", () => {
    expect(resolveColor("chartreuse")).toBe("chartreuse");
  });
});

describe("resolveIcon", () => {
  it("passes through emoji directly", () => {
    expect(resolveIcon("🚀")).toBe("🚀");
  });

  it("resolves named icons to emoji", () => {
    const rocket = resolveIcon("rocket");
    expect(rocket.length).toBeGreaterThan(0);
  });

  it("is case-insensitive", () => {
    expect(resolveIcon("Rocket")).toBe(resolveIcon("rocket"));
  });

  it("passes through unknown names unchanged", () => {
    expect(resolveIcon("unknownicon")).toBe("unknownicon");
  });
});

describe("validateTheme", () => {
  it("returns undefined for valid themes", () => {
    expect(validateTheme("light")).toBeUndefined();
    expect(validateTheme("dark")).toBeUndefined();
    expect(validateTheme("dracula")).toBeUndefined();
  });

  it("returns error string for invalid theme", () => {
    const err = validateTheme("notatheme");
    expect(err).toBeTypeOf("string");
    expect(err).toContain("notatheme");
  });
});

describe("validateSlotType", () => {
  it("returns undefined for valid slot types", () => {
    expect(validateSlotType("macro")).toBeUndefined();
    expect(validateSlotType("widget")).toBeUndefined();
  });

  it("returns error string for invalid type", () => {
    const err = validateSlotType("badtype");
    expect(err).toBeTypeOf("string");
  });
});

describe("validateTargetApp", () => {
  it("returns undefined for valid apps", () => {
    expect(validateTargetApp("claude")).toBeUndefined();
    expect(validateTargetApp("cursor")).toBeUndefined();
  });

  it("returns error string for invalid app", () => {
    const err = validateTargetApp("notanapp");
    expect(err).toBeTypeOf("string");
  });
});

describe("slotSupportsIcon", () => {
  it("returns true for macro type", () => {
    expect(slotSupportsIcon("macro")).toBe(true);
  });

  it("returns false for widget type", () => {
    expect(slotSupportsIcon("widget")).toBe(false);
  });
});
