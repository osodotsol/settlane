// A faithful in-memory stand-in for one browser's navigator.locks (exclusive mode only): a held name is granted to one
// requester at a time; `ifAvailable` gets `null` at once when the name is held; other requests queue in order. The lock is
// released when the callback's promise settles. Shared by several registries, it plays several tabs of one browser.
export function fakeLocks() {
  const held = new Set<string>();
  const queue = new Map<string, (() => void)[]>();
  const run = (name: string, cb: (lock: unknown) => Promise<void>) => {
    held.add(name);
    return Promise.resolve(cb({ name })).finally(() => {
      held.delete(name);
      const next = queue.get(name)?.shift();
      if (next) next();
    });
  };
  const manager = {
    request(name: string, options: { ifAvailable?: boolean }, cb: (lock: unknown) => Promise<void>): Promise<unknown> {
      if (!held.has(name)) return run(name, cb);
      if (options.ifAvailable) return Promise.resolve(cb(null));
      return new Promise((resolve, reject) => {
        const list = queue.get(name) ?? [];
        list.push(() => void run(name, cb).then(resolve, reject));
        queue.set(name, list);
      });
    },
    query: async () => ({ held: [...held].map((name) => ({ name })) }),
  };
  return { held, locks: () => manager };
}
