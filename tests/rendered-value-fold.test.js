import assert from "node:assert/strict";
import { createRenderedValueFoldObserver } from "../src/rendered-value-fold.js";

function environment() {
  const frames = new Map(), observers = [], reads = [];
  let sequence = 0;
  const view = {
    requestAnimationFrame(callback) { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame(id) { frames.delete(id); },
    getComputedStyle(value) { reads.push(value.id); return value.style; },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.values = new Set(); observers.push(this); }
      observe(value) { this.values.add(value); }
      unobserve(value) { this.values.delete(value); }
      disconnect() { this.disconnected = true; this.values.clear(); }
    },
  };
  return { root: { ownerDocument: { defaultView: view } }, view, frames, observers, reads,
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); },
    resize() { observers.forEach((observer) => observer.callback([])); },
  };
}
function value(id, extra = {}) {
  return { id, isConnected: true, textContent: "short text may wrap on a narrow screen", scrollHeight: 120,
    style: { lineHeight: "20px", paddingTop: "0px", paddingBottom: "0px" },
    bounds: { width: 200, height: 120 }, getBoundingClientRect() { return this.bounds; }, ...extra };
}

{
  const env = environment(), helper = createRenderedValueFoldObserver(env.root), called = [];
  const first = value("first", { scrollHeight: 144, style: { lineHeight: "20px", paddingTop: "10px", paddingBottom: "12px" } });
  const edge = value("edge", { scrollHeight: 143, style: { lineHeight: "20px", paddingTop: "10px", paddingBottom: "12px" } });
  helper.observe(first, (node) => { assert.deepEqual(env.reads, ["first", "edge"]); called.push(node); });
  helper.observe(edge, (node) => called.push(node));
  env.resize(); env.resize();
  assert.equal(env.frames.size, 1, "multiple registrations and resize notifications share one frame");
  env.flush();
  assert.deepEqual(called, [first], "padding is removed and the one-pixel tolerance is strict");
  assert.equal(env.observers[0].values.has(first), false, "overflow stops observation before the callback");
  assert.equal(env.observers[0].values.has(edge), true);
  edge.scrollHeight = 144;
  env.resize(); env.flush();
  assert.deepEqual(called, [first, edge]);
  env.resize(); env.flush();
  assert.equal(called.length, 2, "a candidate callback is never replayed");
  helper.dispose();
}
console.log("OK: rendered six-line overflow uses padding-aware geometry, batched reads, and one callback per candidate");

{
  const env = environment(), helper = createRenderedValueFoldObserver(env.root), calls = [];
  const detached = value("detached", { isConnected: false, scrollHeight: 200 });
  helper.observe(detached, () => calls.push("detached"));
  env.flush();
  assert.equal(env.observers[0].values.has(detached), true, "a detached build waits for its first mount");
  assert.deepEqual(env.reads, [], "a detached value is not measured");
  detached.isConnected = true;
  detached.bounds = { width: 0, height: 0 };
  env.resize(); env.flush();
  assert.deepEqual(calls, [], "hidden bodies do not trigger folding");
  detached.bounds = { width: 80, height: 200 };
  env.resize(); env.flush();
  assert.deepEqual(calls, ["detached"], "hidden-to-visible layout is measured when dimensions become available");
  const short = value("short");
  helper.observe(short, () => calls.push("short"));
  env.flush();
  short.isConnected = false;
  env.resize(); env.flush();
  assert.equal(env.observers[0].values.has(short), false, "a removed, previously connected body is released");
  short.isConnected = true; short.scrollHeight = 200;
  env.resize(); env.flush();
  assert.deepEqual(calls, ["detached"]);
  helper.dispose();
}
console.log("OK: first mount, hidden-to-visible, width changes, and detached panels retain correct lifecycle boundaries");

for (const [label, patch] of [
  ["normal line height", { lineHeight: "normal" }], ["zero line height", { lineHeight: "0px" }],
  ["negative line height", { lineHeight: "-1px" }], ["non-finite line height", { lineHeight: "Infinity" }],
  ["missing padding", { paddingTop: undefined }], ["negative padding", { paddingBottom: "-1px" }],
]) {
  const env = environment(), helper = createRenderedValueFoldObserver(env.root);
  const target = value(label, { scrollHeight: 1000 }); target.style = { ...target.style, ...patch };
  let count = 0; helper.observe(target, () => { count += 1; }); env.flush();
  assert.equal(count, 0, `${label}: unavailable measurement cannot establish six rendered lines`);
  target.style = { lineHeight: "20px", paddingTop: "0px", paddingBottom: "0px" };
  env.resize(); env.flush(); assert.equal(count, 1, "later valid geometry remains observable");
  helper.dispose();
}
for (const scrollHeight of [NaN, Infinity, -Infinity]) {
  const env = environment(), helper = createRenderedValueFoldObserver(env.root);
  helper.observe(value("invalid", { scrollHeight }), () => assert.fail("invalid scroll height"));
  env.flush(); helper.dispose();
}

{
  const env = environment(), helper = createRenderedValueFoldObserver(env.root), target = value("cancelled", { scrollHeight: 200 });
  const cancel = helper.observe(target, () => assert.fail("cancelled candidate"));
  cancel(); cancel();
  assert.equal(env.observers[0].values.size, 0);
  assert.equal(env.frames.size, 0, "cancelling the last candidate cancels its queued frame");
  let replacementCalls = 0;
  const oldCancel = helper.observe(target, () => assert.fail("replaced callback"));
  helper.observe(target, () => { replacementCalls += 1; });
  oldCancel();
  env.flush();
  assert.equal(replacementCalls, 1, "an older cancellation cannot remove a replacement registration");
  const after = value("dispose", { scrollHeight: 200 });
  helper.observe(after, () => assert.fail("disposed candidate"));
  const staleFrame = [...env.frames.values()][0];
  helper.dispose(); helper.dispose();
  assert.equal(env.frames.size, 0);
  assert.equal(env.observers[0].disconnected, true);
  staleFrame(); env.resize(); env.flush();
  helper.observe(after, () => assert.fail("disposed observer"))();
  assert.equal(env.observers[0].values.size, 0);
}
{
  const env = environment(), helper = createRenderedValueFoldObserver(env.root), calls = [];
  helper.observe(value("first", { scrollHeight: 200 }), () => { calls.push("first"); helper.dispose(); });
  helper.observe(value("second", { scrollHeight: 200 }), () => calls.push("second"));
  env.flush();
  assert.deepEqual(calls, ["first"], "disposing during a write invalidates remaining callbacks");
}
for (const root of [undefined, {}, { ownerDocument: {} }, { ownerDocument: { defaultView: {} } }]) {
  const helper = createRenderedValueFoldObserver(root);
  helper.observe(value("unsupported", { scrollHeight: 200 }), () => assert.fail("no layout runtime"))();
  helper.dispose();
}
console.log("OK: unavailable geometry, replacement, cancellation, disposal, and non-browser environments are safe");
