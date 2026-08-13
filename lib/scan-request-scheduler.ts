export interface ScanRequestSchedulerOptions {
  intervalMs: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface ScheduledRequestOptions {
  /** Used only by the explicitly selected rate-limit module. */
  rapidSeries?: boolean;
}

const defaultSleep = (milliseconds: number) => new Promise<void>(resolve => {
  setTimeout(resolve, milliseconds);
});

/**
 * A FIFO, one-slot scheduler shared by every target-origin request in a scan.
 * It serialises callers even when a check uses Promise.all internally.
 */
export class ScanRequestScheduler {
  private tail: Promise<void> = Promise.resolve();
  private lastStartedAt: number | null = null;
  private active = 0;
  private maximumActive = 0;

  constructor(private readonly options: ScanRequestSchedulerOptions) {}

  async run<T>(operation: () => Promise<T>, request: ScheduledRequestOptions = {}): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;

    try {
      const now = this.options.now ?? Date.now;
      const sleep = this.options.sleep ?? defaultSleep;
      if (!request.rapidSeries && this.lastStartedAt !== null) {
        const remaining = this.options.intervalMs - (now() - this.lastStartedAt);
        if (remaining > 0) await sleep(remaining);
      }
      this.lastStartedAt = now();
      this.active += 1;
      this.maximumActive = Math.max(this.maximumActive, this.active);
      try {
        return await operation();
      } finally {
        this.active -= 1;
      }
    } finally {
      release();
    }
  }

  get maxActiveRequests(): number {
    return this.maximumActive;
  }
}

export async function waitForRetry(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await defaultSleep(milliseconds);
}
