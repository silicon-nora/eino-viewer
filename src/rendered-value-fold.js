// Package-private layout measurement. This never changes a recorded value; the
// reader owns the disclosure and decides how to present an overflowing body.
export function createRenderedValueFoldObserver(root) {
  const view = root?.ownerDocument?.defaultView || root?.defaultView;
  const noop = () => {};
  if (!view?.ResizeObserver || !view.requestAnimationFrame || !view.cancelAnimationFrame || !view.getComputedStyle) {
    return { observe: () => noop, dispose: noop };
  }

  const candidates = new Map();
  let frame;
  let disposed = false;
  function remove(value, candidate) {
    if (candidates.get(value) !== candidate) return;
    candidates.delete(value);
    observer.unobserve(value);
    if (!candidates.size && frame !== undefined) {
      view.cancelAnimationFrame(frame);
      frame = undefined;
    }
  }
  function measure() {
    frame = undefined;
    if (disposed) return;
    const overflowing = [];
    for (const [value, candidate] of candidates) {
      if (!value.isConnected) {
        // A reader is built before it is mounted. The first connection must
        // remain observable, but an already removed panel must not be retained.
        if (candidate.connected) remove(value, candidate);
        continue;
      }
      candidate.connected = true;
      const bounds = value.getBoundingClientRect();
      if (!(bounds.width > 0 && bounds.height > 0)) continue;
      const style = view.getComputedStyle(value);
      const lineHeight = Number.parseFloat(style.lineHeight);
      const paddingTop = Number.parseFloat(style.paddingTop);
      const paddingBottom = Number.parseFloat(style.paddingBottom);
      if (!Number.isFinite(lineHeight) || lineHeight <= 0 || !Number.isFinite(paddingTop) || paddingTop < 0
        || !Number.isFinite(paddingBottom) || paddingBottom < 0 || !Number.isFinite(value.scrollHeight)) continue;
      if (value.scrollHeight - paddingTop - paddingBottom > 6 * lineHeight + 1) overflowing.push([value, candidate]);
    }
    // Complete all layout reads before a callback can insert a disclosure or
    // change the dimensions of the next candidate.
    for (const [value, candidate] of overflowing) {
      if (disposed) break;
      if (candidates.get(value) !== candidate) continue;
      remove(value, candidate);
      candidate.onOverflow(value);
    }
  }
  function schedule() {
    if (!disposed && candidates.size && frame === undefined) frame = view.requestAnimationFrame(measure);
  }
  const observer = new view.ResizeObserver(schedule);
  return {
    observe(value, onOverflow) {
      if (disposed || !value || typeof value.getBoundingClientRect !== "function" || typeof onOverflow !== "function") return noop;
      const previous = candidates.get(value);
      if (previous) remove(value, previous);
      const candidate = { onOverflow, connected: value.isConnected === true };
      candidates.set(value, candidate);
      observer.observe(value);
      schedule();
      return () => remove(value, candidate);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      frame = undefined;
      observer.disconnect();
      candidates.clear();
    },
  };
}
