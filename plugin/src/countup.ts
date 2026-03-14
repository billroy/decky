/**
 * Count-Up Timer Registry — manages independent per-widget count-up timers.
 *
 * Each count-up widget slot gets its own timer, keyed by slot index.
 * Timers run entirely in the plugin process — no bridge involvement.
 *
 * Behavior:
 * - Click to start counting up from 00:00 at 1 Hz
 * - Click again to pause
 * - Long press to reset to 00:00 (idle)
 * - Background stays at theme default regardless of state
 */

export interface CountUpState {
  elapsedSeconds: number; // 0 = initial
  isRunning: boolean;
}

export const IDLE_STATE: CountUpState = Object.freeze({
  elapsedSeconds: 0,
  isRunning: false,
});

export type CountUpRenderCallback = (timerId: string, state: CountUpState) => void;

class TimerInstance {
  elapsedSeconds = 0;
  intervalHandle: ReturnType<typeof setInterval> | null = null;

  get isRunning(): boolean {
    return this.intervalHandle !== null;
  }

  getState(): CountUpState {
    return {
      elapsedSeconds: this.elapsedSeconds,
      isRunning: this.isRunning,
    };
  }

  start(onTick: () => void): void {
    if (this.intervalHandle) return; // already running
    this.intervalHandle = setInterval(() => this.tick(onTick), 1000);
    onTick(); // immediate update to show "running" state
  }

  pause(onUpdate: () => void): void {
    this.stopInterval();
    onUpdate();
  }

  toggle(onUpdate: () => void): void {
    if (this.isRunning) {
      this.pause(onUpdate);
    } else {
      this.start(onUpdate);
    }
  }

  reset(onUpdate: () => void): void {
    this.stopInterval();
    this.elapsedSeconds = 0;
    onUpdate();
  }

  private tick(onTick: () => void): void {
    this.elapsedSeconds++;
    onTick();
  }

  private stopInterval(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  dispose(): void {
    this.stopInterval();
    this.elapsedSeconds = 0;
  }
}

export class CountUpTimerRegistry {
  private timers = new Map<string, TimerInstance>();
  private listeners = new Set<CountUpRenderCallback>();

  toggle(timerId: string): void {
    let timer = this.timers.get(timerId);
    if (!timer) {
      timer = new TimerInstance();
      this.timers.set(timerId, timer);
    }
    timer.toggle(() => this.notifyListeners(timerId));
  }

  reset(timerId: string): void {
    const timer = this.timers.get(timerId);
    if (timer) {
      timer.reset(() => this.notifyListeners(timerId));
    }
    // If no timer exists, already at idle — nothing to do
  }

  getState(timerId: string): CountUpState {
    return this.timers.get(timerId)?.getState() ?? { ...IDLE_STATE };
  }

  removeTimer(timerId: string): void {
    const timer = this.timers.get(timerId);
    if (timer) {
      timer.dispose();
      this.timers.delete(timerId);
    }
  }

  subscribe(cb: CountUpRenderCallback): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Visible for testing. */
  _getTimerCount(): number {
    return this.timers.size;
  }

  private notifyListeners(timerId: string): void {
    const state = this.getState(timerId);
    for (const cb of this.listeners) {
      cb(timerId, state);
    }
  }
}

export const countUpRegistry = new CountUpTimerRegistry();
