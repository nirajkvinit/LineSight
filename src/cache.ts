/**
 * Bounded least-recently-used cache backed by a plain Map.
 *
 * JS Maps iterate in insertion order, so the *first* key is always the oldest
 * and the *last* key is the most recently used.  get() promotes an entry by
 * deleting and re-inserting it; has() is a non-promoting peek.
 *
 * Drop-in replacement for the unbounded Maps the extension used previously —
 * only .get/.set/.delete/.has/.clear and .size are needed.
 */
export class LRUCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = Math.max(1, Math.floor(maxSize));
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      return undefined;
    }
    // Move to MRU position by re-inserting
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    // If key already exists, delete first so re-insert moves to end
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict oldest (first) entry
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
      }
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  has(key: K): boolean {
    // Peek only — no recency update
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
