/**
 * Rate limit store — tracks token usage over a rolling 5-hour window.
 *
 * Usage entries are accumulated from Stop hook payloads (usage.input_tokens,
 * usage.output_tokens) or posted manually via POST /rate-limit.
 *
 * The store prunes entries older than 5 hours on each write, so getSummary()
 * always reflects the current rolling window.
 */

const WINDOW_MS = 5 * 60 * 60 * 1000; // 5 hours in milliseconds

interface UsageEntry {
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RateLimitSummary {
  totalTokens5h: number;
  percentUsed: number | null;
  resetAt: number | null;
}

export class RateLimitStore {
  private entries: UsageEntry[] = [];
  private limitTokens5h: number | null = null;

  /** Add a usage entry and prune entries older than the 5-hour window. */
  addUsage(inputTokens: number, outputTokens: number, now = Date.now()): void {
    const entry: UsageEntry = {
      timestamp: now,
      inputTokens: Math.max(0, Math.floor(inputTokens)),
      outputTokens: Math.max(0, Math.floor(outputTokens)),
    };
    this.entries.push(entry);
    this.prune(now);
  }

  /** Set the known 5-hour token limit (from config or POST body). */
  setLimit(limitTokens5h: number | null): void {
    this.limitTokens5h = limitTokens5h !== null ? Math.max(1, Math.floor(limitTokens5h)) : null;
  }

  /** Get the rolling 5-hour summary. */
  getSummary(now = Date.now()): RateLimitSummary {
    this.prune(now);
    const totalTokens5h = this.entries.reduce(
      (sum, e) => sum + e.inputTokens + e.outputTokens,
      0,
    );
    const percentUsed =
      this.limitTokens5h !== null && this.limitTokens5h > 0
        ? Math.min(100, (totalTokens5h / this.limitTokens5h) * 100)
        : null;
    // resetAt: timestamp when the oldest entry will age out of the window
    const resetAt = this.entries.length > 0 ? this.entries[0].timestamp + WINDOW_MS : null;
    return { totalTokens5h, percentUsed, resetAt };
  }

  /** Remove entries older than 5 hours from the front. */
  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    let i = 0;
    while (i < this.entries.length && this.entries[i].timestamp <= cutoff) {
      i++;
    }
    if (i > 0) this.entries.splice(0, i);
  }

  /** Number of entries in the window (for testing). */
  get entryCount(): number {
    return this.entries.length;
  }

  /** Clear all entries (for testing). */
  clear(): void {
    this.entries = [];
  }
}
