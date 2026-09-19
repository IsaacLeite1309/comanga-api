interface RateLimitStore<T> {
    get(key: string): T | undefined;
    set(key: string, value: T): void;
    delete(key: string): void;
    clear(): void;
}

export = RateLimitStore;
