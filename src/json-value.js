function issue(code, path, message) {
  return { code, path, message };
}

// Shared with the text-import boundary. Limits describe accepted input, not
// rendering thresholds, and stay private to the package's implementation.
export const JSON_INPUT_LIMITS = Object.freeze({
  maxDepth: 128,
  maxValues: 1000000,
  maxBytes: 64 * 1024 * 1024,
  maxDiagnostics: 20,
});

function propertyPath(path, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null || prototype === Object.prototype) return true;
  // Object.prototype from another realm is valid too. Looking at descriptors
  // avoids executing a user-defined constructor/name getter during validation.
  if (Object.getPrototypeOf(prototype) !== null) return false;
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  if (!constructor || !("value" in constructor) || typeof constructor.value !== "function") return false;
  return Function.prototype.toString.call(constructor.value) === Function.prototype.toString.call(Object)
    && Object.getOwnPropertyDescriptor(constructor.value, "prototype")?.value === prototype;
}

/** Internal, descriptor-safe and bounded validation for public JSON data. */
export function findJSONValueIssues(root, rootPath = "root") {
  const errors = [];
  const active = new Set();
  const stack = [{ action: "visit", value: root, path: rootPath, depth: 0 }];
  let values = 0;
  let bytes = 0;
  let stopped = false;
  const addIssue = (code, path, message) => {
    if (errors.length < JSON_INPUT_LIMITS.maxDiagnostics) errors.push(issue(code, path, message));
    if (errors.length >= JSON_INPUT_LIMITS.maxDiagnostics) stopped = true;
  };
  const addBytes = (count, path) => {
    bytes += count;
    if (bytes > JSON_INPUT_LIMITS.maxBytes) {
      addIssue("max_bytes_exceeded", path, `JSON data exceeds the ${JSON_INPUT_LIMITS.maxBytes}-byte limit.`);
      stopped = true;
    }
  };
  const addStringBytes = (value, path) => {
    addBytes(2, path);
    for (let index = 0; index < value.length && !stopped; index += 1) {
      const code = value.charCodeAt(index);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) addBytes(2, path);
      else if (code < 32) addBytes(6, path);
      else if (code < 128) addBytes(1, path);
      else if (code < 2048) addBytes(2, path);
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { addBytes(4, path); index += 1; }
        else addBytes(6, path);
      } else if (code >= 0xdc00 && code <= 0xdfff) addBytes(6, path);
      else addBytes(3, path);
    }
  };

  while (stack.length && !stopped) {
    const frame = stack.pop();
    const { value, path, depth } = frame;
    if (frame.action === "children") {
      if (frame.index === frame.keys.length) { active.delete(value); continue; }
      const key = frame.keys[frame.index++];
      stack.push(frame);
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        const childPath = typeof key !== "string" ? path : frame.array ? `${path}[${key}]` : propertyPath(path, key);
        if (typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor)) {
          addIssue("non_json_property", typeof key === "string" ? childPath : path, "JSON objects can contain only enumerable data properties.");
          continue;
        }
        if (!frame.array) { addStringBytes(key, childPath); addBytes(1, childPath); }
        stack.push({ action: "visit", value: descriptor.value, path: childPath, depth: depth + 1 });
      } catch {
        addIssue("non_json_object", path, "JSON data must allow safe property inspection.");
      }
      continue;
    }
    values += 1;
    if (values > JSON_INPUT_LIMITS.maxValues) {
      addIssue("max_values_exceeded", path, `JSON data exceeds the ${JSON_INPUT_LIMITS.maxValues}-value limit.`);
      break;
    }
    if (depth > JSON_INPUT_LIMITS.maxDepth) {
      addIssue("max_depth_exceeded", path, `JSON data exceeds the maximum depth of ${JSON_INPUT_LIMITS.maxDepth}.`);
      continue;
    }
    if (value === null) { addBytes(4, path); continue; }
    const type = typeof value;
    if (type === "string") { addStringBytes(value, path); continue; }
    if (type === "boolean") { addBytes(value ? 4 : 5, path); continue; }
    if (type === "number") {
      if (!Number.isFinite(value)) {
        addIssue("non_json_number", path, "JSON numbers must be finite; NaN and Infinity are not supported.");
      } else if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        addIssue("unsafe_integer", path, "JSON integers must stay within JavaScript's exact integer range.");
      } else addBytes(String(value).length, path);
      continue;
    }
    if (type !== "object") {
      addIssue("non_json_value", path, `Values of type ${type} are not part of the JSON data model.`);
      continue;
    }
    if (active.has(value)) {
      addIssue("recursive_reference", path, "Values must be JSON-safe and cannot contain object cycles.");
      continue;
    }
    try {
      const array = Array.isArray(value);
      if (!array && !isPlainObject(value)) {
        addIssue("non_json_object", path, "Expected a plain JSON object rather than a class instance.");
        continue;
      }
      const length = array ? Object.getOwnPropertyDescriptor(value, "length").value : 0;
      if (array && length > JSON_INPUT_LIMITS.maxValues - values) {
        addIssue("max_values_exceeded", path, `JSON data exceeds the ${JSON_INPUT_LIMITS.maxValues}-value limit.`);
        break;
      }
      const keys = Reflect.ownKeys(value).filter((key) => !array || key !== "length");
      if (keys.length > JSON_INPUT_LIMITS.maxValues - values) {
        addIssue("max_values_exceeded", path, `JSON data exceeds the ${JSON_INPUT_LIMITS.maxValues}-value limit.`);
        break;
      }
      if (array) {
        let elements = 0;
        for (const key of keys) {
          const index = typeof key === "string" ? Number(key) : NaN;
          if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
            addIssue("non_json_property", typeof key === "string" ? propertyPath(path, key) : path, "JSON arrays can contain only enumerable data elements.");
          } else elements += 1;
          if (stopped) break;
        }
        if (elements < length) {
          for (let index = 0; index < length && !stopped; index += 1) {
            if (!Object.hasOwn(value, index)) addIssue("sparse_array", `${path}[${index}]`, "JSON arrays cannot contain empty slots.");
          }
        }
      }
      addBytes(2 + Math.max(0, keys.length - 1), path);
      active.add(value);
      // One cursor frame per ancestor keeps very wide objects from allocating
      // a second full collection of traversal frames. Shared values are visited
      // again because JSON serialization repeats them and must fit the budget.
      stack.push({ action: "children", value, path, depth, array, keys, index: 0 });
    } catch {
      addIssue("non_json_object", path, "JSON data must allow safe property inspection.");
    }
  }
  return errors;
}

export function assertJSONSafeValue(value, path) {
  const errors = findJSONValueIssues(value, path);
  if (errors.length) {
    const summary = errors
      .slice(0, 3)
      .map((entry) => `${entry.path}: ${entry.message}`)
      .join("; ");
    const suffix = errors.length > 3 ? `; and ${errors.length - 3} more` : "";
    throw new TypeError(`Expected JSON-safe data: ${summary}${suffix}`);
  }
  return value;
}
