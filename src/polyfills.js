// Polyfills for older iPhones / Android WebViews (the sync library uses newer JS APIs).
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}
if (!Array.prototype.toSorted) {
  Object.defineProperty(Array.prototype, 'toSorted', { value(fn) { return this.slice().sort(fn); }, writable: true, configurable: true });
}
if (!Array.prototype.toReversed) {
  Object.defineProperty(Array.prototype, 'toReversed', { value() { return this.slice().reverse(); }, writable: true, configurable: true });
}
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', { value(i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i]; }, writable: true, configurable: true });
}
if (!Object.hasOwn) Object.hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
if (typeof queueMicrotask !== 'function') window.queueMicrotask = fn => Promise.resolve().then(fn);
