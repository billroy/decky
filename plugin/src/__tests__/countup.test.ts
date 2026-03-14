import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CountUpTimerRegistry,
  IDLE_STATE,
} from "../countup.js";

describe("CountUpTimerRegistry", () => {
  let registry: CountUpTimerRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new CountUpTimerRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getState", () => {
    it("returns idle state for unknown timer", () => {
      const state = registry.getState("unknown");
      expect(state).toEqual(IDLE_STATE);
    });
  });

  describe("toggle", () => {
    it("starts timer from idle", () => {
      registry.toggle("0");
      const state = registry.getState("0");
      expect(state.elapsedSeconds).toBe(0);
      expect(state.isRunning).toBe(true);
    });

    it("pauses a running timer", () => {
      registry.toggle("0"); // start
      vi.advanceTimersByTime(5_000);
      registry.toggle("0"); // pause
      const state = registry.getState("0");
      expect(state.elapsedSeconds).toBe(5);
      expect(state.isRunning).toBe(false);
    });

    it("resumes a paused timer", () => {
      registry.toggle("0"); // start
      vi.advanceTimersByTime(3_000);
      registry.toggle("0"); // pause
      registry.toggle("0"); // resume
      const state = registry.getState("0");
      expect(state.elapsedSeconds).toBe(3);
      expect(state.isRunning).toBe(true);

      vi.advanceTimersByTime(2_000);
      expect(registry.getState("0").elapsedSeconds).toBe(5);
    });

    it("notifies subscribers on toggle", () => {
      const cb = vi.fn();
      registry.subscribe(cb);
      registry.toggle("0");
      expect(cb).toHaveBeenCalledWith("0", expect.objectContaining({
        elapsedSeconds: 0,
        isRunning: true,
      }));
    });
  });

  describe("independent timers", () => {
    it("two timers run independently", () => {
      registry.toggle("0"); // start
      registry.toggle("3"); // start

      vi.advanceTimersByTime(5_000);

      expect(registry.getState("0").elapsedSeconds).toBe(5);
      expect(registry.getState("3").elapsedSeconds).toBe(5);

      registry.toggle("0"); // pause timer 0

      vi.advanceTimersByTime(3_000);

      expect(registry.getState("0").elapsedSeconds).toBe(5); // paused
      expect(registry.getState("3").elapsedSeconds).toBe(8); // still running
    });

    it("resetting one timer does not affect another", () => {
      registry.toggle("0");
      registry.toggle("1");
      vi.advanceTimersByTime(5_000);

      registry.reset("0");

      expect(registry.getState("0").elapsedSeconds).toBe(0);
      expect(registry.getState("0").isRunning).toBe(false);
      expect(registry.getState("1").elapsedSeconds).toBe(5);
      expect(registry.getState("1").isRunning).toBe(true);
    });
  });

  describe("tick count-up", () => {
    it("increments each second", () => {
      registry.toggle("0");

      vi.advanceTimersByTime(1_000);
      expect(registry.getState("0").elapsedSeconds).toBe(1);

      vi.advanceTimersByTime(1_000);
      expect(registry.getState("0").elapsedSeconds).toBe(2);
    });

    it("does not tick when paused", () => {
      registry.toggle("0"); // start
      vi.advanceTimersByTime(3_000);
      registry.toggle("0"); // pause

      vi.advanceTimersByTime(5_000);
      expect(registry.getState("0").elapsedSeconds).toBe(3); // unchanged
    });

    it("notifies on each tick", () => {
      const cb = vi.fn();
      registry.subscribe(cb);
      registry.toggle("0");
      cb.mockClear();

      vi.advanceTimersByTime(3_000);
      expect(cb).toHaveBeenCalledTimes(3);
    });
  });

  describe("reset", () => {
    it("stops timer and resets to 0", () => {
      registry.toggle("0");
      vi.advanceTimersByTime(10_000);

      registry.reset("0");
      const state = registry.getState("0");
      expect(state.elapsedSeconds).toBe(0);
      expect(state.isRunning).toBe(false);
    });

    it("notifies subscribers on reset", () => {
      registry.toggle("0");
      vi.advanceTimersByTime(5_000);

      const cb = vi.fn();
      registry.subscribe(cb);
      registry.reset("0");

      expect(cb).toHaveBeenCalledWith("0", expect.objectContaining({
        elapsedSeconds: 0,
        isRunning: false,
      }));
    });

    it("is safe to call on idle timer", () => {
      expect(() => registry.reset("nope")).not.toThrow();
    });
  });

  describe("removeTimer", () => {
    it("clears interval and removes timer", () => {
      registry.toggle("0");
      expect(registry._getTimerCount()).toBe(1);

      registry.removeTimer("0");
      expect(registry._getTimerCount()).toBe(0);
      expect(registry.getState("0")).toEqual(IDLE_STATE);
    });

    it("is safe to call for nonexistent timer", () => {
      expect(() => registry.removeTimer("nope")).not.toThrow();
    });
  });

  describe("subscribe/unsubscribe", () => {
    it("returns unsubscribe function", () => {
      const cb = vi.fn();
      const unsub = registry.subscribe(cb);

      registry.toggle("0");
      expect(cb).toHaveBeenCalledTimes(1);

      unsub();
      cb.mockClear();

      vi.advanceTimersByTime(1_000);
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
