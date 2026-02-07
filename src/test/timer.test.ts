import * as assert from 'assert';
import { scheduleTimeout, clearTrackedTimer, wait } from '../timer';

describe('scheduleTimeout', () => {
  it('calls the callback after the delay', (done) => {
    const start = Date.now();
    scheduleTimeout(() => {
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 40, `expected at least 40ms, got ${elapsed}ms`);
      done();
    }, 50);
  });

  it('clamps negative delay to 0', (done) => {
    scheduleTimeout(() => {
      done();
    }, -100);
  });
});

describe('clearTrackedTimer', () => {
  it('prevents callback from firing', (done) => {
    let called = false;
    const timer = scheduleTimeout(() => {
      called = true;
    }, 50);
    clearTrackedTimer(timer);
    setTimeout(() => {
      assert.strictEqual(called, false);
      done();
    }, 100);
  });

  it('handles undefined gracefully', () => {
    clearTrackedTimer(undefined); // should not throw
  });
});

describe('wait', () => {
  it('resolves after the specified delay', async () => {
    const start = Date.now();
    await wait(50);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `expected at least 40ms, got ${elapsed}ms`);
  });
});
