// Minimal synchronous DOM for ownership and native reader contracts. Browser suites check layout.
class ElementDouble {
  constructor(tag, ownerDocument) {
    this.tagName = tag;
    this.ownerDocument = ownerDocument;
    this.nodeType = 1;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.value = "";
    this.checked = false;
    this._text = "";
    this.className = "";
    const properties = new Map();
    this.style = { setProperty: (name, value) => properties.set(name, String(value)), getPropertyValue: (name) => properties.get(name) || "" };
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => { const enabled = force ?? !this.classList.contains(name); this.classList[enabled ? "add" : "remove"](name); return enabled; },
    };
  }
  get parentElement() { return this.parent; }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0]; }
  get textContent() { return this._text + this.children.map((item) => item.textContent).join(""); }
  set textContent(value) { this._text = String(value); this.children = []; }
  append(...children) {
    for (const child of children) { child.remove(); child.parent = this; this.children.push(child); }
  }
  replaceChildren(...children) { this.children.forEach((child) => { child.parent = undefined; }); this.children = []; this._text = ""; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = undefined; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
  }
  getAttribute(name) {
    if (name.startsWith("data-")) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())];
    return this.attributes[name];
  }
  removeAttribute(name) { delete this.attributes[name]; }
  focus() { this.ownerDocument.activeElement = this; }
  contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
  matches(selector) {
    return selector.split(",").some((part) => {
      const trimmed = part.trim();
      if (/^[a-z-]+$/i.test(trimmed)) return this.tagName.toLowerCase() === trimmed.toLowerCase();
      if (/^\.[\w-]+$/.test(trimmed)) return this.classList.contains(trimmed.slice(1));
      const attribute = trimmed.match(/^\[([a-z-]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
      if (!attribute) return false;
      const value = this.getAttribute(attribute[1]);
      return value !== undefined && (attribute[2] === undefined || value === attribute[2]);
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}
const dom = {
  createElement(tag) { return new ElementDouble(tag, dom); },
  createTextNode(text) { const node = new ElementDouble("#text", dom); node.textContent = text; return node; },
};

dom.createElementNS = (_namespace, tag) => dom.createElement(tag);
export { ElementDouble, dom };
