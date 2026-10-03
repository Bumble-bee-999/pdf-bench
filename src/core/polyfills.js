/**
 * pdf.js 6 uses the (very new) Map.getOrInsert proposal. Chromium versions
 * older than 2025 do not have it, and Electron lags a few months behind
 * Chrome, so we fill it in rather than pinning an older pdf.js.
 */
for (const Ctor of [Map, WeakMap]) {
  const proto = Ctor.prototype;
  if (!proto.getOrInsert) {
    Object.defineProperty(proto, 'getOrInsert', {
      value: function getOrInsert(key, value) {
        if (!this.has(key)) this.set(key, value);
        return this.get(key);
      },
      writable: true, configurable: true,
    });
  }
  if (!proto.getOrInsertComputed) {
    Object.defineProperty(proto, 'getOrInsertComputed', {
      value: function getOrInsertComputed(key, callback) {
        if (!this.has(key)) this.set(key, callback(key));
        return this.get(key);
      },
      writable: true, configurable: true,
    });
  }
}

if (!Promise.withResolvers) {
  Promise.withResolvers = function withResolvers() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}
