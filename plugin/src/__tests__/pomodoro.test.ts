import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PomodoroTimerRegistry,
  IDLE_STATE,
  ADD_SECONDS,
  FLASH_FRAMES,
  FLASH_INTERVAL_MS,
} from "../pomodoro.js";

describe("PomodoroTimerRegistry", () => {
  let registry: PomodoroTimerRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new PomodoroTimerRegistry();
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

  describe("addTime", () => {
    it("creates a timer and starts running", () => {
      registry.addTime("0", ADD_SECONDS);
      const state = registry.getState("0");
      expect(state.remainingSeconds).toBe(ADD_SECONDS);
      expect(state.isRunning).toBe(true);
      expect(state.isFlashing).toBe(false);
    });

    it("accumulates time when pressed multiple times", () => {
      registry.addTime("0", ADD_SECONDS);
      registry.addTime("0", ADD_SECONDS);
      expect(registry.getState("0").remainingSeconds).toBe(ADD_SECONDS * 2);
    });

    it("notifies subscribers on add", () => {
      const cb = vi.fn();
      registry.subscribe(cb);
      registry.addTime("0", ADD_SECONDS);
      expect(cb).toHaveBeenCalledWith("0", expect.objectContaining({
        remainingSeconds: ADD_SECONDS,
        isRunning: true,
      }));
    });
  });

  describe("independent timers", () => {
    it("two timers run independently", () => {
      registry.addTime("0", ADD_SECONDS);
      registry.addTime("3", 120); // 2 minutes

      expect(registry.getState("0").remainingSeconds).toBe(ADD_SECONDS);
      expect(registry.getState("3").remainingSeconds).toBe(120);

      // Tick 10 seconds
      vi.advanceTimersByTime(10_000);

      expect(registry.getState("0").remainingSeconds).toBe(ADD_SECONDS - 10);
      expect(registry.getState("3").remainingSeconds).toBe(110);
    });

    it("one timer completing does not affect another", () => {
      registry.addTime("0", ADD_SECONDS);
      registry.addTime("1", 3); // 3 seconds

      vi.advanceTimersByTime(3_000);

      // Timer "1" should be at 0 (and flashing)
      const state1 = registry.getState("1");
      expect(state1.remainingSeconds).toBe(0);
      expect(state1.isRunning).toBe(false);

      // Timer "0" should still be running
      const state0 = registry.getState("0");
      expect(state0.remainingSeconds).toBe(ADD_SECONDS - 3);
      expect(state0.isRunning).toBe(true);
    });
  });

  describe("tick countdown", () => {
    it("decrements each second", () => {
      registry.addTime("0", ADD_SECONDS);

      vi.advanceTimersByTime(1_000);
      expect(registry.getState("0").remainingSeconds).toBe(ADD_SECONDS - 1);

      vi.advanceTimersByTime(1_000);
      expect(registry.getState("0").remainingSeconds).toBe(ADD_SECONDS - 2);
    });

    it("stops at 0", () => {
      registry.addTime("0", 3);

      vi.advanceTimersByTime(3_000);
      const state = registry.getState("0");
      expect(state.remainingSeconds).toBe(0);
      expect(state.isRunning).toBe(false);
    });

    it("notifies on each tick", () => {
      const cb = vi.fn();
      registry.subscribe(cb);
      registry.addTime("0", 60);
      cb.mockClear();

      vi.advanceTimersByTime(3_000);
      expect(cb).toHaveBeenCalledTimes(3);
    });
  });

  describe("flash on completion", () => {
    it("starts flashing when timer reaches 0", () => {
      registry.addTime("0", 2);
      vi.advanceTimersByTime(2_000);

      const state = registry.getState("0");
      expect(state.remainingSeconds).toBe(0);
      expect(state.isFlashing).toBe(true);
    });

    it("flash completes after all frames", () => {
      registry.addTime("0", 1);
      vi.advanceTimersByTime(1_000); // timer hits 0, flash starts

      // Advance through all flash frames
      vi.advanceTimersByTime(FLASH_FRAMES * FLASH_INTERVAL_MS);

      const state = registry.getState("0");
      expect(state.isFlashing).toBe(false);
      expect(state.remainingSeconds).toBe(0);
    });

    it("notifies during flash frames", () => {
      const cb = vi.fn();
      registry.subscribe(cb);
      registry.addTime("0", 1);
      cb.mockClear();

      vi.advanceTimersByTime(1_000); // tick to 0 + flash start
      const callsAfterZero = cb.mock.calls.length;
      expect(callsAfterZero).toBeGreaterThanOrEqual(1);

      // Flash frames
      vi.advanceTimersByTime(FLASH_FRAMES * FLASH_INTERVAL_MS);
      expect(cb.mock.calls.length).toBeGreaterThan(callsAfterZero);
    });
  });

  describe("addTime during flash cancels flash", () => {
    it("cancels flash and starts new timer", () => {
      registry.addTime("0", 1);
      vi.advanceTimersByTime(1_000); // flash starts

      expect(registry.getState("0").isFlashing).toBe(true);

      // Press button during flash
      registry.addTime("0", ADD_SECONDS);

      const state = registry.getState("0");
      expect(state.isFlashing).toBe(false);
      expect(state.isRunning).toBe(true);
      expect(state.remainingSeconds).toBe(ADD_SECONDS);
    });
  });

  describe("removeTimer", () => {
    it("clears interval and removes timer", () => {
      registry.addTime("0", ADD_SECONDS);
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

      registry.addTime("0", ADD_SECONDS);
      expect(cb).toHaveBeenCalledTimes(1);

      unsub();
      cb.mockClear();

      vi.advanceTimersByTime(1_000);
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
