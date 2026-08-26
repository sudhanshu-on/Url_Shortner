const BASE62_CHARSET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Base62 encoder for numeric IDs
 */
export function encodeBase62(num: number): string {
    if (num === 0) return BASE62_CHARSET[0];
    let result = "";
    while (num > 0) {
        result = BASE62_CHARSET[num % 62] + result;
        num = Math.floor(num / 62);
    }
    return result;
}

/**
 * Generate a pseudo-random Base62 string of specific length
 */
export function generateRandomBase62(length: number = 7): string {
    let result = "";
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * 62);
        result += BASE62_CHARSET[randomIndex];
    }
    return result;
}

/**
 * In-Memory LRU Cache implementation for hot URL lookups
 */
export class LRUCache<K, V> {
    private capacity: number;
    private cache: Map<K, V>;

    constructor(capacity: number = 5000) {
        this.capacity = capacity;
        this.cache = new Map<K, V>();
    }

    get(key: K): V | null {
        if (!this.cache.has(key)) return null;
        const value = this.cache.get(key)!;
        // Refresh position (mark as recently used)
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    set(key: K, value: V): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.capacity) {
            // Delete least recently used item
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
        this.cache.set(key, value);
    }

    delete(key: K): void {
        this.cache.delete(key);
    }

    size(): number {
        return this.cache.size;
    }
}
