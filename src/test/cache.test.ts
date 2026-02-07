import * as assert from 'assert';
import { LRUCache } from '../cache';

describe('LRUCache', () => {
  it('stores and retrieves values', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    assert.strictEqual(cache.get('a'), 1);
    assert.strictEqual(cache.get('b'), 2);
    assert.strictEqual(cache.size, 2);
  });

  it('returns undefined for missing keys', () => {
    const cache = new LRUCache<string, number>(3);
    assert.strictEqual(cache.get('missing'), undefined);
  });

  it('evicts oldest entry when at capacity', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // should evict 'a'
    assert.strictEqual(cache.get('a'), undefined);
    assert.strictEqual(cache.get('b'), 2);
    assert.strictEqual(cache.get('d'), 4);
    assert.strictEqual(cache.size, 3);
  });

  it('get() promotes entry to MRU position', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // promote 'a' — now 'b' is oldest
    cache.set('d', 4); // should evict 'b'
    assert.strictEqual(cache.get('a'), 1);
    assert.strictEqual(cache.get('b'), undefined);
    assert.strictEqual(cache.get('c'), 3);
    assert.strictEqual(cache.get('d'), 4);
  });

  it('has() does not promote entry (peek)', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    assert.strictEqual(cache.has('a'), true); // peek — does NOT promote 'a'
    cache.set('d', 4); // should evict 'a' (still oldest)
    assert.strictEqual(cache.has('a'), false);
    assert.strictEqual(cache.get('a'), undefined);
  });

  it('set() overwrites existing key without growing', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('a', 10); // overwrite — should not evict, size stays 3
    assert.strictEqual(cache.get('a'), 10);
    assert.strictEqual(cache.size, 3);
  });

  it('overwrite moves entry to MRU position', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('a', 10); // 'a' moves to MRU — 'b' is now oldest
    cache.set('d', 4); // should evict 'b'
    assert.strictEqual(cache.get('b'), undefined);
    assert.strictEqual(cache.get('a'), 10);
    assert.strictEqual(cache.size, 3);
  });

  it('delete() removes entry and reduces size', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    assert.strictEqual(cache.delete('a'), true);
    assert.strictEqual(cache.get('a'), undefined);
    assert.strictEqual(cache.size, 1);
    assert.strictEqual(cache.delete('missing'), false);
  });

  it('clear() empties the cache', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    assert.strictEqual(cache.size, 0);
    assert.strictEqual(cache.get('a'), undefined);
  });

  it('handles maxSize of 1', () => {
    const cache = new LRUCache<string, number>(1);
    cache.set('a', 1);
    assert.strictEqual(cache.get('a'), 1);
    cache.set('b', 2); // evicts 'a'
    assert.strictEqual(cache.get('a'), undefined);
    assert.strictEqual(cache.get('b'), 2);
    assert.strictEqual(cache.size, 1);
  });

  it('enforces minimum maxSize of 1', () => {
    const cache = new LRUCache<string, number>(0);
    cache.set('a', 1);
    assert.strictEqual(cache.size, 1);
    assert.strictEqual(cache.get('a'), 1);
  });
});
