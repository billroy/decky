/**
 * Pomodoro Timer Registry — manages independent per-widget countdown timers.
 *
 * Each Pomodoro widget slot gets its own timer, keyed by slot index.
 * Timers run entirely in the plugin process — no bridge involvement.
 */

export interface PomodoroState {
  remainingSeconds: number; // 0 = idle
  isRunning: boolean;
  isFlashing: boolean;
}

export const IDLE_STATE: PomodoroState = Object.freeze({
  remainingSeconds: 0,
  isRunning: false,
  isFlashing: false,
});

export const ADD_SECONDS = 10 * 60; // 10 minutes per press
export const FLASH_FRAMES = 6;
export const FLASH_INTERVAL_MS = 300;

export type PomodoroRenderCallback = (timerId: string, state: PomodoroState) => void;

class TimerInstance {
  remainingSeconds = 0;
  intervalHandle: ReturnType<typeof setInterval> | null = null;
  flashHandle: ReturnType<typeof setInterval> | null = null;
  flashFramesLeft = 0;
  isFlashing = false;

  get isRunning(): boolean {
    return this.intervalHandle !== null;
  }

  getState(): PomodoroState {
    return {
      remainingSeconds: this.remainingSeconds,
      isRunning: this.isRunning,
      isFlashing: this.isFlashing,
    };
  }

  addTime(seconds: number, onTick: () => void): void {
    // Cancel any active flash
    this.stopFlash();

    this.remainingSeconds += seconds;

    if (!this.intervalHandle) {
      this.intervalHandle = setInterval(() => this.tick(onTick), 1000);
    }
    onTick();
  }

  tick(onComplete: () => void): void {
    this.remainingSeconds = Math.max(0, this.remainingSeconds - 1);
    if (this.remainingSeconds <= 0) {
      this.stopInterval();
    }
    onComplete();
  }

  stopInterval(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  startFlash(onFrame: () => void, onDone: () => void): void {
    this.isFlashing = true;
    this.flashFramesLeft = FLASH_FRAMES;
    onFrame(); // first frame immediately
    this.flashFramesLeft--;

    this.flashHandle = setInterval(() => {
      this.flashFramesLeft--;
      if (this.flashFramesLeft <= 0) {
        this.stopFlash();
        onDone();
      } else {
        onFrame();
      }
    }, FLASH_INTERVAL_MS);
  }

  stopFlash(): void {
    if (this.flashHandle) {
      clearInterval(this.flashHandle);
      this.flashHandle = null;
    }
    this.isFlashing = false;
    this.flashFramesLeft = 0;
  }

  dispose(): void {
    this.stopInterval();
    this.stopFlash();
    this.remainingSeconds = 0;
  }
}

export class PomodoroTimerRegistry {
  private timers = new Map<string, TimerInstance>();
  private listeners = new Set<PomodoroRenderCallback>();

  addTime(timerId: string, seconds: number): void {
    let timer = this.timers.get(timerId);
    if (!timer) {
      timer = new TimerInstance();
      this.timers.set(timerId, timer);
    }
    timer.addTime(seconds, () => this.notifyAll(timerId));

    // If timer just completed (reached 0), start flash
    // (handled in the tick callback below, not here)
  }

  getState(timerId: string): PomodoroState {
    return this.timers.get(timerId)?.getState() ?? { ...IDLE_STATE };
  }

  removeTimer(timerId: string): void {
    const timer = this.timers.get(timerId);
    if (timer) {
      timer.dispose();
      this.timers.delete(timerId);
    }
  }

  subscribe(cb: PomodoroRenderCallback): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Visible for testing. */
  _getTimerCount(): number {
    return this.timers.size;
  }

  private notifyAll(timerId: string): void {
    const state = this.getState(timerId);

    // If timer just hit 0 and isn't flashing, trigger flash
    if (state.remainingSeconds === 0 && !state.isRunning && !state.isFlashing) {
      const timer = this.timers.get(timerId);
      if (timer) {
        timer.startFlash(
          () => this.notifyListeners(timerId),
          () => this.notifyListeners(timerId),
        );
        return;
      }
    }

    this.notifyListeners(timerId);
  }

  private notifyListeners(timerId: string): void {
    const state = this.getState(timerId);
    for (const cb of this.listeners) {
      cb(timerId, state);
    }
  }
}

export const pomodoroRegistry = new PomodoroTimerRegistry();
