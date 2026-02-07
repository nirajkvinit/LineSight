import * as assert from 'assert';
import { ConcurrencyLimiter } from '../concurrency';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ConcurrencyLimiter', () => {
  it('runs tasks immediately when under limit', async () => {
    const limiter = new ConcurrencyLimiter(3);
    const result = await limiter.run(() => Promise.resolve(42));
    assert.strictEqual(result, 42);
  });

  it('limits concurrent tasks', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let maxConcurrent = 0;
    let current = 0;

    const task = async () => {
      current++;
      if (current > maxConcurrent) {
        maxConcurrent = current;
      }
      await delay(50);
      current--;
    };

    await Promise.all([
      limiter.run(task),
      limiter.run(task),
      limiter.run(task),
      limiter.run(task),
    ]);

    assert.strictEqual(maxConcurrent, 2);
    assert.strictEqual(limiter.activeCount, 0);
    assert.strictEqual(limiter.pendingCount, 0);
  });

  it('drains the queue in order', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const order: number[] = [];

    const makeTask = (n: number) => async () => {
      order.push(n);
      await delay(10);
    };

    await Promise.all([
      limiter.run(makeTask(1)),
      limiter.run(makeTask(2)),
      limiter.run(makeTask(3)),
    ]);

    assert.deepStrictEqual(order, [1, 2, 3]);
  });

  it('propagates errors without blocking the queue', async () => {
    const limiter = new ConcurrencyLimiter(1);

    const failingTask = () => Promise.reject(new Error('boom'));
    const okTask = () => Promise.resolve('ok');

    const results = await Promise.allSettled([
      limiter.run(failingTask),
      limiter.run(okTask),
    ]);

    assert.strictEqual(results[0].status, 'rejected');
    assert.strictEqual((results[1] as PromiseFulfilledResult<string>).value, 'ok');
    assert.strictEqual(limiter.activeCount, 0);
    assert.strictEqual(limiter.pendingCount, 0);
  });

  it('handles synchronously throwing tasks without deadlocking', async () => {
    const limiter = new ConcurrencyLimiter(1);

    const syncThrow = (): Promise<string> => { throw new Error('sync boom'); };
    const okTask = () => Promise.resolve('ok');

    const results = await Promise.allSettled([
      limiter.run(syncThrow),
      limiter.run(okTask),
    ]);

    assert.strictEqual(results[0].status, 'rejected');
    assert.strictEqual((results[1] as PromiseFulfilledResult<string>).value, 'ok');
    assert.strictEqual(limiter.activeCount, 0);
    assert.strictEqual(limiter.pendingCount, 0);
  });

  it('reports activeCount and pendingCount', async () => {
    const limiter = new ConcurrencyLimiter(1);

    let resolveFirst!: () => void;
    const firstTask = () => new Promise<void>((r) => { resolveFirst = r; });

    const p1 = limiter.run(firstTask);
    const p2 = limiter.run(() => Promise.resolve());

    assert.strictEqual(limiter.activeCount, 1);
    assert.strictEqual(limiter.pendingCount, 1);

    resolveFirst();
    await p1;
    await p2;

    assert.strictEqual(limiter.activeCount, 0);
    assert.strictEqual(limiter.pendingCount, 0);
  });
});
