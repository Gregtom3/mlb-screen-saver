// /persist — storage adapter. IndexedDB in browser, in-memory in tests.
// One save = one league. Phase 0 ships a stub interface only.

export interface SaveAdapter {
  read<T>(key: string): Promise<T | null>;
  write<T>(key: string, value: T): Promise<void>;
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
}

export const inMemoryAdapter = (): SaveAdapter => {
  const store = new Map<string, unknown>();
  return {
    async read<T>(key: string): Promise<T | null> {
      return (store.get(key) as T | undefined) ?? null;
    },
    async write<T>(key: string, value: T): Promise<void> {
      store.set(key, value);
    },
    async list(prefix: string): Promise<string[]> {
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
    async remove(key: string): Promise<void> {
      store.delete(key);
    },
  };
};
