/**
 * Promise-based concurrency limiter.
 *
 * Wraps async work in `run()`.  Up to `maxConcurrent` tasks execute in
 * parallel; extras are held in a FIFO queue and started as earlier tasks
 * finish.  Errors in one task do not block the queue.
 *
 * Used by the decoration provider to cap simultaneous file reads so the
 * extension host isn't overwhelmed during large workspace scans.
 */
export class ConcurrencyLimiter {
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(maxConcurrent: number, maxQueued = 500) {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
    this.maxQueued = Math.max(1, Math.floor(maxQueued));
  }

  get activeCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = () => {
        this.running++;
        let result: Promise<T>;
        try {
          result = fn();
        } catch (err) {
          this.running--;
          this.dequeue();
          reject(err);
          return;
        }
        result.then(
          (value) => {
            this.running--;
            this.dequeue();
            resolve(value);
          },
          (err) => {
            this.running--;
            this.dequeue();
            reject(err);
          },
        );
      };

      if (this.running < this.maxConcurrent) {
        execute();
      } else if (this.queue.length < this.maxQueued) {
        this.queue.push(execute);
      } else {
        reject(new Error('ConcurrencyLimiter: queue full'));
      }
    });
  }

  private dequeue(): void {
    if (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
}
