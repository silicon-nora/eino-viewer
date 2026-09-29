import {
  EinoDAGProtocolError,
  validateEinoDAGEnvelope,
} from "./protocol-core.js";

export const COMPONENT_IO_KIND = "component.io";
export const COMPONENT_IO_KIND_VERSION = 1;

const PAYLOAD_FIELDS = new Set([
  "direction",
  "streaming",
  "component",
  "name",
  "type",
  "format",
  "address",
  "nodePath",
  "body",
]);
const ADDRESS_FIELDS = new Set(["type", "id", "subId"]);

function own(object, key) {
  const descriptor =
    object && typeof object === "object"
      ? Object.getOwnPropertyDescriptor(object, key)
      : undefined;
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function hasOwn(object, key) {
  const descriptor =
    object && typeof object === "object"
      ? Object.getOwnPropertyDescriptor(object, key)
      : undefined;
  return Boolean(descriptor && "value" in descriptor);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diagnostic(code, path, message) {
  return Object.freeze({ severity: "error", code, path, message });
}

function propertyPath(path, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function validateFields(value, path, allowed, diagnostics) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      diagnostics.push(
        diagnostic(
          "component_io.unknown_field",
          propertyPath(path, key),
          `Unknown component.io field "${key}".`,
        ),
      );
    }
  }
}

function requireString(value, path, diagnostics) {
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(
      diagnostic("component_io.invalid_string", path, "Expected a non-empty string."),
    );
  }
}

function validateStringArray(value, path, diagnostics) {
  if (!Array.isArray(value) || value.length === 0) {
    diagnostics.push(
      diagnostic(
        "component_io.invalid_node_path",
        path,
        "Expected a non-empty array of strings.",
      ),
    );
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    const entry = own(value, String(index));
    if (typeof entry !== "string" || entry.length === 0) {
      diagnostics.push(
        diagnostic(
          "component_io.invalid_node_path",
          `${path}[${index}]`,
          "Expected a non-empty string.",
        ),
      );
    }
  }
}

function validateAddress(value, diagnostics) {
  if (!Array.isArray(value)) {
    diagnostics.push(
      diagnostic(
        "component_io.invalid_address",
        "root.payload.address",
        "Expected an address array.",
      ),
    );
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    const segment = own(value, String(index));
    const path = `root.payload.address[${index}]`;
    if (!isObject(segment)) {
      diagnostics.push(
        diagnostic(
          "component_io.invalid_address_segment",
          path,
          "Expected an address segment object.",
        ),
      );
      continue;
    }
    validateFields(segment, path, ADDRESS_FIELDS, diagnostics);
    requireString(own(segment, "type"), `${path}.type`, diagnostics);
    requireString(own(segment, "id"), `${path}.id`, diagnostics);
    if (hasOwn(segment, "subId")) {
      requireString(own(segment, "subId"), `${path}.subId`, diagnostics);
    }
  }
}

/** Validate the stable projection of an official or custom component callback body. */
export function validateComponentIOEnvelope(input) {
  const common = validateEinoDAGEnvelope(input);
  const diagnostics = [...common.diagnostics];
  if (!isObject(input)) {
    return { valid: false, diagnostics: Object.freeze(diagnostics) };
  }
  if (own(input, "kind") !== COMPONENT_IO_KIND) {
    diagnostics.push(
      diagnostic(
        "component_io.invalid_kind",
        "root.kind",
        `Expected kind to be "${COMPONENT_IO_KIND}".`,
      ),
    );
  }
  if (own(input, "kindVersion") !== COMPONENT_IO_KIND_VERSION) {
    diagnostics.push(
      diagnostic(
        "component_io.unsupported_kind_version",
        "root.kindVersion",
        `Supported component.io kind version is ${COMPONENT_IO_KIND_VERSION}.`,
      ),
    );
  }
  const payload = own(input, "payload");
  if (!isObject(payload)) {
    diagnostics.push(
      diagnostic(
        "component_io.invalid_payload",
        "root.payload",
        "Expected a component.io payload object.",
      ),
    );
    return { valid: false, diagnostics: Object.freeze(diagnostics) };
  }
  validateFields(payload, "root.payload", PAYLOAD_FIELDS, diagnostics);
  const direction = own(payload, "direction");
  if (direction !== "input" && direction !== "output") {
    diagnostics.push(
      diagnostic(
        "component_io.invalid_direction",
        "root.payload.direction",
        "Expected direction to be input or output.",
      ),
    );
  }
  const streaming = own(payload, "streaming");
  if (typeof streaming !== "boolean") {
    diagnostics.push(
      diagnostic(
        "component_io.invalid_streaming",
        "root.payload.streaming",
        "Expected streaming to be a boolean.",
      ),
    );
  }
  requireString(own(payload, "component"), "root.payload.component", diagnostics);
  requireString(own(payload, "format"), "root.payload.format", diagnostics);
  for (const field of ["name", "type"]) {
    if (hasOwn(payload, field)) {
      requireString(own(payload, field), `root.payload.${field}`, diagnostics);
    }
  }
  validateAddress(own(payload, "address"), diagnostics);
  if (hasOwn(payload, "nodePath")) {
    validateStringArray(own(payload, "nodePath"), "root.payload.nodePath", diagnostics);
  }
  if (streaming === true && hasOwn(payload, "body")) {
    diagnostics.push(
      diagnostic(
        "component_io.live_stream_body",
        "root.payload.body",
        "A live stream observation must not contain a body.",
      ),
    );
  }
  const capture = own(own(input, "metadata"), "capture");
  const omitted = own(capture, "status") === "omitted";
  if (omitted) {
    const reason = own(capture, "reason");
    const validReason = reason === "size_limit" || reason === "unsupported_value"
      || reason === "stream_not_consumed" && streaming === true;
    if (!validReason) diagnostics.push(diagnostic(
      "component_io.invalid_omission", "root.metadata.capture.reason",
      "An omitted body requires a supported omission reason; stream_not_consumed requires streaming=true.",
    ));
    if (hasOwn(payload, "body")) diagnostics.push(diagnostic(
      "component_io.omitted_body_present", "root.payload.body",
      "An omitted body must be absent, not empty or null.",
    ));
  }
  if (streaming === false && !hasOwn(payload, "body") && !omitted) {
    diagnostics.push(
      diagnostic(
        "component_io.missing_body",
        "root.payload.body",
        "A non-streaming component observation requires a body or explicit omission metadata.",
      ),
    );
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
  };
}

export function parseComponentIOEnvelope(input) {
  const result = validateComponentIOEnvelope(input);
  if (!result.valid) throw new EinoDAGProtocolError(result.diagnostics);
  return input;
}
