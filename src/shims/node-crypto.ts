// P2's Player imports randomUUID from node:crypto. The sandboxed renderer has no
// Node modules, so Vite maps that import to Web Crypto. Remove once P2 uses
// globalThis.crypto.randomUUID directly.
export const randomUUID = (): string => crypto.randomUUID();
