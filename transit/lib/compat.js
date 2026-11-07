export const browser = new Proxy({}, {
  get(_, prop) {
    const target = globalThis.browser ?? globalThis.chrome;
    return target?.[prop];
  },
});
