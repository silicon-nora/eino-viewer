import { findJSONValueIssues } from "./json-value.js";
import { validateWorkflowSnapshot } from "eino-workflow-dag";

export const EINO_DAG_PROTOCOL = "eino-dag";
export const EINO_DAG_PROTOCOL_VERSION = 1;
export const WORKFLOW_SNAPSHOT_KIND = "workflow.snapshot";
export const WORKFLOW_SNAPSHOT_KIND_VERSION = 1;
export const COMPOSE_GRAPH_KIND = "compose.graph";
export const COMPOSE_GRAPH_KIND_VERSION = 1;
export const CALLBACK_EVENT_KIND = "callback.event";
export const CALLBACK_EVENT_KIND_VERSION = 1;
export const AGENT_EVENT_KIND = "agent.event";
export const AGENT_EVENT_KIND_VERSION = 1;
export const SCHEMA_MESSAGE_KIND = "schema.message";
export const SCHEMA_MESSAGE_KIND_VERSION = 1;
export const SCHEMA_AGENTIC_MESSAGE_KIND = "schema.agentic_message";
export const SCHEMA_AGENTIC_MESSAGE_KIND_VERSION = 1;
export const SCHEMA_TOOL_KIND = "schema.tool";
export const SCHEMA_TOOL_KIND_VERSION = 1;
export const SCHEMA_DOCUMENT_KIND = "schema.document";
export const SCHEMA_DOCUMENT_KIND_VERSION = 1;

const ENVELOPE_FIELDS = new Set([
  "protocol",
  "protocolVersion",
  "kind",
  "kindVersion",
  "payload",
  "source",
  "correlation",
  "observedAtMs",
  "metadata",
]);
function own(object, key) {
  const descriptor =
    object && typeof object === "object"
      ? Object.getOwnPropertyDescriptor(object, key)
      : undefined;
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function hasOwnDataProperty(object, key) {
  const descriptor =
    object && typeof object === "object"
      ? Object.getOwnPropertyDescriptor(object, key)
      : undefined;
  return Boolean(descriptor && "value" in descriptor);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function propertyPath(path, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function diagnostic(code, path, message, details = {}) {
  return Object.freeze({ severity: "error", code, path, message, ...details });
}

function validateKnownFields(value, path, allowed, diagnostics) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      diagnostics.push(
        diagnostic(
          "envelope.unknown_field",
          propertyPath(path, key),
          `Unknown envelope field "${key}".`,
        ),
      );
    }
  }
}

function validateOptionalString(object, field, path, diagnostics) {
  const value = own(object, field);
  if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
    diagnostics.push(
      diagnostic(
        "envelope.invalid_string",
        `${path}.${field}`,
        `Expected ${field} to be a non-empty string.`,
      ),
    );
  }
}

function validateStringRecord(object, path, diagnostics) {
  for (const field of Object.keys(object)) {
    validateOptionalString(object, field, path, diagnostics);
  }
}

function freezeDiagnostics(diagnostics) {
  return Object.freeze(diagnostics.slice());
}

function failed(diagnostics) {
  return Object.freeze({ ok: false, diagnostics: freezeDiagnostics(diagnostics) });
}

function succeeded(envelope, diagnostics = []) {
  return Object.freeze({
    ok: true,
    envelope,
    diagnostics: freezeDiagnostics(diagnostics),
  });
}

/** Validate only the stable Eino DAG envelope, not its domain payload. */
export function validateEinoDAGEnvelope(input) {
  const diagnostics = findJSONValueIssues(input).map((entry) =>
    diagnostic(`json.${entry.code}`, entry.path, entry.message),
  );

  if (!isObject(input)) {
    diagnostics.push(
      diagnostic(
        "envelope.invalid_document",
        "root",
        "Expected an Eino DAG envelope object.",
      ),
    );
    return { valid: false, diagnostics: freezeDiagnostics(diagnostics) };
  }
  if (diagnostics.some((entry) => entry.code === "json.recursive_reference")) {
    return { valid: false, diagnostics: freezeDiagnostics(diagnostics) };
  }

  validateKnownFields(input, "root", ENVELOPE_FIELDS, diagnostics);

  if (own(input, "protocol") !== EINO_DAG_PROTOCOL) {
    diagnostics.push(
      diagnostic(
        "envelope.invalid_protocol",
        "root.protocol",
        `Expected protocol to be "${EINO_DAG_PROTOCOL}".`,
      ),
    );
  }
  if (own(input, "protocolVersion") !== EINO_DAG_PROTOCOL_VERSION) {
    diagnostics.push(
      diagnostic(
        "envelope.unsupported_protocol_version",
        "root.protocolVersion",
        `Supported protocol version is ${EINO_DAG_PROTOCOL_VERSION}.`,
      ),
    );
  }

  const kind = own(input, "kind");
  if (typeof kind !== "string" || kind.length === 0) {
    diagnostics.push(
      diagnostic(
        "envelope.invalid_kind",
        "root.kind",
        "Expected kind to be a non-empty string.",
      ),
    );
  }
  const kindVersion = own(input, "kindVersion");
  if (!Number.isSafeInteger(kindVersion) || kindVersion < 1) {
    diagnostics.push(
      diagnostic(
        "envelope.invalid_kind_version",
        "root.kindVersion",
        "Expected kindVersion to be a positive safe integer.",
      ),
    );
  }
  if (!hasOwnDataProperty(input, "payload")) {
    diagnostics.push(
      diagnostic(
        "envelope.missing_payload",
        "root.payload",
        "An Eino DAG envelope requires a payload.",
      ),
    );
  }

  const source = own(input, "source");
  if (source !== undefined) {
    if (!isObject(source)) {
      diagnostics.push(
        diagnostic(
          "envelope.invalid_source",
          "root.source",
          "Expected source to be an object.",
        ),
      );
    } else {
      validateStringRecord(source, "root.source", diagnostics);
      if (own(source, "module") === undefined) {
        diagnostics.push(
          diagnostic(
            "envelope.missing_source_module",
            "root.source.module",
            "A source requires a module.",
          ),
        );
      }
      if (own(source, "format") === undefined) {
        diagnostics.push(
          diagnostic(
            "envelope.missing_source_format",
            "root.source.format",
            "A source requires a format.",
          ),
        );
      }
    }
  }

  const correlation = own(input, "correlation");
  if (correlation !== undefined) {
    if (!isObject(correlation)) {
      diagnostics.push(
        diagnostic(
          "envelope.invalid_correlation",
          "root.correlation",
          "Expected correlation to be an object.",
        ),
      );
    } else {
      validateStringRecord(correlation, "root.correlation", diagnostics);
    }
  }

  const observedAtMs = own(input, "observedAtMs");
  if (
    observedAtMs !== undefined &&
    (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0)
  ) {
    diagnostics.push(
      diagnostic(
        "envelope.invalid_observed_at",
        "root.observedAtMs",
        "Expected observedAtMs to be a non-negative safe integer.",
      ),
    );
  }

  const metadata = own(input, "metadata");
  if (metadata !== undefined && metadata !== null && !isObject(metadata)) {
    diagnostics.push(
      diagnostic(
        "envelope.invalid_metadata",
        "root.metadata",
        "Expected metadata to be a JSON object or null.",
      ),
    );
  }

  const unique = [];
  const seen = new Set();
  for (const entry of diagnostics) {
    const key = `${entry.code}\u0000${entry.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(entry);
    }
  }
  return {
    valid: unique.length === 0,
    diagnostics: freezeDiagnostics(unique),
  };
}

export class EinoDAGProtocolError extends TypeError {
  constructor(diagnostics) {
    const summary = diagnostics
      .slice(0, 5)
      .map((entry) => `${entry.path}: ${entry.message}`)
      .join("; ");
    const suffix =
      diagnostics.length > 5 ? `; and ${diagnostics.length - 5} more` : "";
    super(`Invalid Eino DAG envelope: ${summary}${suffix}`);
    this.name = "EinoDAGProtocolError";
    this.code = "INVALID_EINO_DAG_ENVELOPE";
    this.diagnostics = freezeDiagnostics(diagnostics);
  }
}

export function parseEinoDAGEnvelope(input) {
  const result = validateEinoDAGEnvelope(input);
  if (!result.valid) throw new EinoDAGProtocolError(result.diagnostics);
  return input;
}

/** Validate a Go-produced compose.GraphInfo topology envelope. */
export function validateComposeGraphEnvelope(input) {
  const envelopeValidation = validateEinoDAGEnvelope(input);
  const diagnostics = [...envelopeValidation.diagnostics];
  if (!isObject(input)) {
    return { valid: false, diagnostics: freezeDiagnostics(diagnostics) };
  }
  if (own(input, "kind") !== COMPOSE_GRAPH_KIND) {
    diagnostics.push(
      diagnostic(
        "compose.invalid_kind",
        "root.kind",
        `Expected kind to be "${COMPOSE_GRAPH_KIND}".`,
      ),
    );
  }
  if (own(input, "kindVersion") !== COMPOSE_GRAPH_KIND_VERSION) {
    diagnostics.push(
      diagnostic(
        "compose.unsupported_kind_version",
        "root.kindVersion",
        `Supported compose.graph kind version is ${COMPOSE_GRAPH_KIND_VERSION}.`,
      ),
    );
  }
  if (hasOwnDataProperty(input, "payload")) {
    const payloadValidation = validateWorkflowSnapshot({
      schemaVersion: 1,
      workflow: own(input, "payload"),
    });
    // compose.Graph may use Eino's Pregel mode and contain directed cycles.
    // WorkflowSnapshot remains DAG-only; reuse its structural validation while
    // deliberately retaining Graph's broader topology semantics here.
    for (const entry of payloadValidation.errors.filter(
      (entry) => entry.code !== "directed_cycle" && entry.code !== "self_edge",
    )) {
      diagnostics.push(
        diagnostic(
          `compose.${entry.code}`,
          entry.path.replace(/^root\.workflow/, "root.payload"),
          entry.message,
        ),
      );
    }
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics: freezeDiagnostics(diagnostics),
  };
}

export function parseComposeGraphEnvelope(input) {
  const result = validateComposeGraphEnvelope(input);
  if (!result.valid) throw new EinoDAGProtocolError(result.diagnostics);
  return input;
}

const CALLBACK_EVENT_FIELDS = new Set([
  "sequence",
  "phase",
  "streaming",
  "timestampMs",
  "address",
  "nodePath",
  "run",
  "error",
]);
const CALLBACK_ADDRESS_FIELDS = new Set(["type", "id", "subId"]);
const CALLBACK_RUN_FIELDS = new Set(["name", "type", "component"]);
const CALLBACK_ERROR_FIELDS = new Set(["message"]);

function validateDomainFields(value, path, allowed, domain, diagnostics) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      diagnostics.push(
        diagnostic(
          `${domain}.unknown_field`,
          propertyPath(path, key),
          `Unknown ${domain} field "${key}".`,
        ),
      );
    }
  }
}

function validateRequiredNonEmptyString(value, path, code, diagnostics) {
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(diagnostic(code, path, "Expected a non-empty string."));
  }
}

function validateCallbackPayload(payload, diagnostics) {
  if (!isObject(payload)) {
    diagnostics.push(
      diagnostic(
        "callback.invalid_payload",
        "root.payload",
        "Expected a callback event object.",
      ),
    );
    return;
  }
  validateDomainFields(
    payload,
    "root.payload",
    CALLBACK_EVENT_FIELDS,
    "callback",
    diagnostics,
  );
  const sequence = own(payload, "sequence");
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    diagnostics.push(
      diagnostic(
        "callback.invalid_sequence",
        "root.payload.sequence",
        "Expected sequence to be a positive safe integer.",
      ),
    );
  }
  const phase = own(payload, "phase");
  if (phase !== "start" && phase !== "end" && phase !== "error") {
    diagnostics.push(
      diagnostic(
        "callback.invalid_phase",
        "root.payload.phase",
        "Expected phase to be start, end, or error.",
      ),
    );
  }
  if (typeof own(payload, "streaming") !== "boolean") {
    diagnostics.push(
      diagnostic(
        "callback.invalid_streaming",
        "root.payload.streaming",
        "Expected streaming to be a boolean.",
      ),
    );
  }
  const timestampMs = own(payload, "timestampMs");
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
    diagnostics.push(
      diagnostic(
        "callback.invalid_timestamp",
        "root.payload.timestampMs",
        "Expected timestampMs to be a non-negative safe integer.",
      ),
    );
  }

  const address = own(payload, "address");
  if (!Array.isArray(address)) {
    diagnostics.push(
      diagnostic(
        "callback.invalid_address",
        "root.payload.address",
        "Expected address to be an array.",
      ),
    );
  } else {
    for (let index = 0; index < address.length; index += 1) {
      const segment = own(address, String(index));
      const path = `root.payload.address[${index}]`;
      if (!isObject(segment)) {
        diagnostics.push(
          diagnostic(
            "callback.invalid_address_segment",
            path,
            "Expected an address segment object.",
          ),
        );
        continue;
      }
      validateDomainFields(
        segment,
        path,
        CALLBACK_ADDRESS_FIELDS,
        "callback",
        diagnostics,
      );
      validateRequiredNonEmptyString(
        own(segment, "type"),
        `${path}.type`,
        "callback.invalid_address_type",
        diagnostics,
      );
      validateRequiredNonEmptyString(
        own(segment, "id"),
        `${path}.id`,
        "callback.invalid_address_id",
        diagnostics,
      );
      const subId = own(segment, "subId");
      if (subId !== undefined) {
        validateRequiredNonEmptyString(
          subId,
          `${path}.subId`,
          "callback.invalid_address_sub_id",
          diagnostics,
        );
      }
    }
  }

  const nodePath = own(payload, "nodePath");
  if (nodePath !== undefined) {
    let validNodePath = Array.isArray(nodePath) && nodePath.length > 0;
    for (let index = 0; validNodePath && index < nodePath.length; index += 1) {
      const entry = own(nodePath, String(index));
      if (typeof entry !== "string" || entry.length === 0) validNodePath = false;
    }
    if (!validNodePath) {
      diagnostics.push(
        diagnostic(
          "callback.invalid_node_path",
          "root.payload.nodePath",
          "Expected nodePath to contain non-empty node IDs.",
        ),
      );
    }
  }

  const run = own(payload, "run");
  if (run !== undefined) {
    if (!isObject(run)) {
      diagnostics.push(
        diagnostic(
          "callback.invalid_run_info",
          "root.payload.run",
          "Expected run to be an object.",
        ),
      );
    } else {
      validateDomainFields(
        run,
        "root.payload.run",
        CALLBACK_RUN_FIELDS,
        "callback",
        diagnostics,
      );
      for (const field of CALLBACK_RUN_FIELDS) {
        const value = own(run, field);
        if (value !== undefined) {
          validateRequiredNonEmptyString(
            value,
            `root.payload.run.${field}`,
            "callback.invalid_run_info",
            diagnostics,
          );
        }
      }
    }
  }

  const error = own(payload, "error");
  if (phase === "error") {
    if (!isObject(error)) {
      diagnostics.push(
        diagnostic(
          "callback.missing_error",
          "root.payload.error",
          "An error callback requires error details.",
        ),
      );
    } else {
      validateDomainFields(
        error,
        "root.payload.error",
        CALLBACK_ERROR_FIELDS,
        "callback",
        diagnostics,
      );
      if (typeof own(error, "message") !== "string") {
        diagnostics.push(
          diagnostic(
            "callback.invalid_error_message",
            "root.payload.error.message",
            "Expected an error message string.",
          ),
        );
      }
    }
  } else if (error !== undefined) {
    diagnostics.push(
      diagnostic(
        "callback.unexpected_error",
        "root.payload.error",
        "Only an error callback can contain error details.",
      ),
    );
  }
}

/** Validate one callback lifecycle envelope and its domain payload. */
export function validateCallbackEventEnvelope(input) {
  const envelopeValidation = validateEinoDAGEnvelope(input);
  const diagnostics = [...envelopeValidation.diagnostics];
  if (!isObject(input)) {
    return { valid: false, diagnostics: freezeDiagnostics(diagnostics) };
  }
  if (own(input, "kind") !== CALLBACK_EVENT_KIND) {
    diagnostics.push(
      diagnostic(
        "callback.invalid_kind",
        "root.kind",
        `Expected kind to be "${CALLBACK_EVENT_KIND}".`,
      ),
    );
  }
  if (own(input, "kindVersion") !== CALLBACK_EVENT_KIND_VERSION) {
    diagnostics.push(
      diagnostic(
        "callback.unsupported_kind_version",
        "root.kindVersion",
        `Supported callback.event kind version is ${CALLBACK_EVENT_KIND_VERSION}.`,
      ),
    );
  }
  if (hasOwnDataProperty(input, "payload")) {
    validateCallbackPayload(own(input, "payload"), diagnostics);
  }
  const correlation = own(input, "correlation");
  if (
    !isObject(correlation) ||
    typeof own(correlation, "runId") !== "string" ||
    own(correlation, "runId").length === 0 ||
    typeof own(correlation, "eventId") !== "string" ||
    own(correlation, "eventId").length === 0
  ) {
    diagnostics.push(
      diagnostic(
        "callback.missing_correlation",
        "root.correlation",
        "A callback event requires non-empty runId and eventId correlation values.",
      ),
    );
  }
  const observedAtMs = own(input, "observedAtMs");
  const timestampMs = own(own(input, "payload"), "timestampMs");
  if (
    Number.isSafeInteger(observedAtMs) &&
    Number.isSafeInteger(timestampMs) &&
    observedAtMs !== timestampMs
  ) {
    diagnostics.push(
      diagnostic(
        "callback.timestamp_mismatch",
        "root.observedAtMs",
        "observedAtMs must equal the callback payload timestampMs.",
      ),
    );
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics: freezeDiagnostics(diagnostics),
  };
}

export function parseCallbackEventEnvelope(input) {
  const result = validateCallbackEventEnvelope(input);
  if (!result.valid) throw new EinoDAGProtocolError(result.diagnostics);
  return input;
}

function validateDomainEnvelopeHeader(
  input,
  expectedKind,
  expectedVersion,
  domain,
  diagnostics,
) {
  if (own(input, "kind") !== expectedKind) {
    diagnostics.push(
      diagnostic(
        `${domain}.invalid_kind`,
        "root.kind",
        `Expected kind to be "${expectedKind}".`,
      ),
    );
  }
  if (own(input, "kindVersion") !== expectedVersion) {
    diagnostics.push(
      diagnostic(
        `${domain}.unsupported_kind_version`,
        "root.kindVersion",
        `Supported ${expectedKind} kind version is ${expectedVersion}.`,
      ),
    );
  }
}

function validateOpenObjectPayload(payload, domain, diagnostics) {
  if (!isObject(payload)) {
    diagnostics.push(
      diagnostic(
        `${domain}.invalid_payload`,
        "root.payload",
        `Expected a ${domain} object.`,
      ),
    );
    return false;
  }
  return true;
}

function validateSchemaEnvelope(input, kind, version, domain, validatePayload) {
  const envelopeValidation = validateEinoDAGEnvelope(input);
  const diagnostics = [...envelopeValidation.diagnostics];
  if (!isObject(input)) {
    return { valid: false, diagnostics: freezeDiagnostics(diagnostics) };
  }
  validateDomainEnvelopeHeader(input, kind, version, domain, diagnostics);
  if (hasOwnDataProperty(input, "payload")) {
    validatePayload(own(input, "payload"), diagnostics);
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics: freezeDiagnostics(diagnostics),
  };
}

function validateSchemaMessagePayload(payload, diagnostics) {
  if (!validateOpenObjectPayload(payload, "schema_message", diagnostics)) return;
  validateRequiredNonEmptyString(
    own(payload, "role"),
    "root.payload.role",
    "schema_message.invalid_role",
    diagnostics,
  );
  const content = own(payload, "content");
  if (content !== undefined && typeof content !== "string") {
    diagnostics.push(
      diagnostic(
        "schema_message.invalid_content",
        "root.payload.content",
        "Expected content to be a string.",
      ),
    );
  }
  for (const field of [
    "multi_content",
    "user_input_multi_content",
    "assistant_output_multi_content",
    "tool_calls",
  ]) {
    const value = own(payload, field);
    if (value !== undefined && !Array.isArray(value)) {
      diagnostics.push(
        diagnostic(
          "schema_message.invalid_collection",
          `root.payload.${field}`,
          `Expected ${field} to be an array.`,
        ),
      );
    }
  }
}

/** Validate an Eino schema.Message envelope while allowing version extensions. */
export function validateSchemaMessageEnvelope(input) {
  return validateSchemaEnvelope(
    input,
    SCHEMA_MESSAGE_KIND,
    SCHEMA_MESSAGE_KIND_VERSION,
    "schema_message",
    validateSchemaMessagePayload,
  );
}

export function parseSchemaMessageEnvelope(input) {
  const result = validateSchemaMessageEnvelope(input);
  if (!result.valid) throw new EinoDAGProtocolError(result.diagnostics);
  return input;
}

function validateSchemaAgenticMessagePayload(payload, diagnostics) {
  if (!validateOpenObjectPayload(payload, "schema_agentic_message", diagnostics)) {
    return;
  }
  validateRequiredNonEmptyString(
    own(payload, "role"),
    "root.payload.role",
    "schema_agentic_message.invalid_role",
    diagnostics,
  );
  const blocks = own(payload, "content_blocks");
  if (blocks !== undefined) {
    if (!Array.isArray(blocks)) {
      diagnostics.push(
        diagnostic(
          "schema_agentic_message.invalid_content_blocks",
          "root.payload.content_blocks",
          "Expected content_blocks to be an array.",
        ),
      );
    } else {
      for (let index = 0; index < blocks.length; index += 1) {
        const block = own(blocks, String(index));
        const path = `root.payload.content_blocks[${index}]`;
        if (!isObject(block)) {
          diagnostics.push(
            diagnostic(
              "schema_agentic_message.invalid_content_block",
              path,
              "Expected a content block object.",
            ),
          );
        } else {
          validateRequiredNonEmptyString(
            own(block, "type"),
            `${path}.type`,
            "schema_agentic_message.invalid_content_block_type",
            diagnostics,
          );
        }
      }
    }
  }
}

/** Validate an Eino schema.AgenticMessage envelope. */
export function validateSchemaAgenticMessageEnvelope(input) {
  return validateSchemaEnvelope(
    input,
    SCHEMA_AGENTIC_MESSAGE_KIND,
    SCHEMA_AGENTIC_MESSAGE_KIND_VERSION,
    "schema_agentic_message",
    validateSchemaAgenticMessagePayload,
  );
}

export function parseSchemaAgenticMessageEnvelope(input) {
  const result = validateSchemaAgenticMessageEnvelope(input);
  if (!result.valid) throw new EinoDAGProtocolError(result.diagnostics);
  return input;
}

function validateSchemaToolPayload(payload, diagnostics) {
  if (!validateOpenObjectPayload(payload, "schema_tool", diagnostics)) return;
  validateRequiredNonEmptyString(
    own(payload, "name"),
    "root.payload.name",
    "schema_tool.invalid_name",
    diagnostics,
  );
  const description = own(payload, "desc");
  if (description !== undefined && typeof description !== "string") {
    diagnostics.push(
      diagnostic(
        "schema_tool.invalid_description",
        "root.payload.desc",
        "Expected desc to be a string.",
      ),
    );
  }
  const hasParameters = own(payload, "has_params_one_of");
  if (hasParameters !== undefined && typeof hasParameters !== "boolean") {
    diagnostics.push(
      diagnostic(
        "schema_tool.invalid_parameter_marker",
        "root.payload.has_params_one_of",
        "Expected has_params_one_of to be a boolean.",
      ),
    );
  }
  for (const field of ["params", "json_schema", "extra"]) {
    const value = own(payload, field);
    if (value !== undefined && value !== null && !isObject(value)) {
      diagnostics.push(
        diagnostic(
          "schema_tool.invalid_object_field",
          `root.payload.${field}`,
          `Expected ${field} to be an object or null.`,
        ),
      );
    }
  }
}

/** Validate an Eino schema.ToolInfo envelope. */
export function validateSchemaToolEnvelope(input) {
  return validateSchemaEnvelope(
    input,
    SCHEMA_TOOL_KIND,
    SCHEMA_TOOL_KIND_VERSION,
    "schema_tool",
    validateSchemaToolPayload,
  );
}

export function parseSchemaToolEnvelope(input) {
  const result = validateSchemaToolEnvelope(input);
  if (!result.valid) throw new EinoDAGProtocolError(result.diagnostics);
  return input;
}

function validateSchemaDocumentPayload(payload, diagnostics) {
  if (!validateOpenObjectPayload(payload, "schema_document", diagnostics)) return;
  for (const field of ["id", "content"]) {
    if (typeof own(payload, field) !== "string") {
      diagnostics.push(
        diagnostic(
          `schema_document.invalid_${field}`,
          `root.payload.${field}`,
          `Expected ${field} to be a string.`,
        ),
      );
    }
  }
  const metadata = own(payload, "meta_data");
  if (metadata !== undefined && metadata !== null && !isObject(metadata)) {
    diagnostics.push(
      diagnostic(
        "schema_document.invalid_metadata",
        "root.payload.meta_data",
        "Expected meta_data to be an object or null.",
      ),
    );
  }
}

/** Validate an Eino schema.Document envelope. */
export function validateSchemaDocumentEnvelope(input) {
  return validateSchemaEnvelope(
    input,
    SCHEMA_DOCUMENT_KIND,
    SCHEMA_DOCUMENT_KIND_VERSION,
    "schema_document",
    validateSchemaDocumentPayload,
  );
}

export function parseSchemaDocumentEnvelope(input) {
  const result = validateSchemaDocumentEnvelope(input);
  if (!result.valid) throw new EinoDAGProtocolError(result.diagnostics);
  return input;
}

const AGENT_EVENT_FIELDS = new Set([
  "agentName",
  "runPath",
  "output",
  "action",
  "error",
]);
const AGENT_OUTPUT_FIELDS = new Set(["message", "customizedOutput"]);
const AGENT_MESSAGE_FIELDS = new Set([
  "format",
  "streaming",
  "role",
  "agenticRole",
  "toolName",
  "value",
]);
const AGENT_ACTION_FIELDS = new Set([
  "exit",
  "interrupted",
  "transfer",
  "breakLoop",
  "customized",
]);
const AGENT_ERROR_FIELDS = new Set(["message"]);
const AGENT_TRANSFER_FIELDS = new Set(["destinationAgent"]);
const AGENT_BREAK_LOOP_FIELDS = new Set([
  "from",
  "done",
  "currentIterations",
]);
const AGENT_INTERRUPT_FIELDS = new Set(["data", "contexts"]);
const AGENT_INTERRUPT_CONTEXT_FIELDS = new Set([
  "id",
  "address",
  "info",
  "isRootCause",
  "parentId",
]);
const AGENT_ADDRESS_FIELDS = new Set(["type", "id", "subId"]);

function validateAgentAddress(address, path, diagnostics) {
  if (!Array.isArray(address)) {
    diagnostics.push(
      diagnostic(
        "agent.invalid_interrupt_address",
        path,
        "Expected interrupt address to be an array.",
      ),
    );
    return;
  }
  for (let index = 0; index < address.length; index += 1) {
    const segment = own(address, String(index));
    const segmentPath = `${path}[${index}]`;
    if (!isObject(segment)) {
      diagnostics.push(
        diagnostic(
          "agent.invalid_interrupt_address_segment",
          segmentPath,
          "Expected an address segment object.",
        ),
      );
      continue;
    }
    validateDomainFields(
      segment,
      segmentPath,
      AGENT_ADDRESS_FIELDS,
      "agent",
      diagnostics,
    );
    for (const field of ["type", "id"]) {
      validateRequiredNonEmptyString(
        own(segment, field),
        `${segmentPath}.${field}`,
        "agent.invalid_interrupt_address_segment",
        diagnostics,
      );
    }
    const subId = own(segment, "subId");
    if (subId !== undefined) {
      validateRequiredNonEmptyString(
        subId,
        `${segmentPath}.subId`,
        "agent.invalid_interrupt_address_segment",
        diagnostics,
      );
    }
  }
}

function validateAgentInterrupt(interrupted, diagnostics) {
  if (!isObject(interrupted)) {
    diagnostics.push(
      diagnostic(
        "agent.invalid_interrupt",
        "root.payload.action.interrupted",
        "Expected interrupted to be an object.",
      ),
    );
    return;
  }
  validateDomainFields(
    interrupted,
    "root.payload.action.interrupted",
    AGENT_INTERRUPT_FIELDS,
    "agent",
    diagnostics,
  );
  const contexts = own(interrupted, "contexts");
  if (contexts === undefined) return;
  if (!Array.isArray(contexts)) {
    diagnostics.push(
      diagnostic(
        "agent.invalid_interrupt_contexts",
        "root.payload.action.interrupted.contexts",
        "Expected contexts to be an array.",
      ),
    );
    return;
  }
  for (let index = 0; index < contexts.length; index += 1) {
    const context = own(contexts, String(index));
    const path = `root.payload.action.interrupted.contexts[${index}]`;
    if (!isObject(context)) {
      diagnostics.push(
        diagnostic(
          "agent.invalid_interrupt_context",
          path,
          "Expected an interrupt context object.",
        ),
      );
      continue;
    }
    validateDomainFields(
      context,
      path,
      AGENT_INTERRUPT_CONTEXT_FIELDS,
      "agent",
      diagnostics,
    );
    validateRequiredNonEmptyString(
      own(context, "id"),
      `${path}.id`,
      "agent.invalid_interrupt_context_id",
      diagnostics,
    );
    validateAgentAddress(own(context, "address"), `${path}.address`, diagnostics);
    if (typeof own(context, "isRootCause") !== "boolean") {
      diagnostics.push(
        diagnostic(
          "agent.invalid_interrupt_root_cause",
          `${path}.isRootCause`,
          "Expected isRootCause to be a boolean.",
        ),
      );
    }
    const parentId = own(context, "parentId");
    if (parentId !== undefined) {
      validateRequiredNonEmptyString(
        parentId,
        `${path}.parentId`,
        "agent.invalid_interrupt_parent_id",
        diagnostics,
      );
    }
  }
}

function validateAgentMessage(message, diagnostics) {
  if (!isObject(message)) {
    diagnostics.push(
      diagnostic(
        "agent.invalid_message_output",
        "root.payload.output.message",
        "Expected message output to be an object.",
      ),
    );
    return;
  }
  validateDomainFields(
    message,
    "root.payload.output.message",
    AGENT_MESSAGE_FIELDS,
    "agent",
    diagnostics,
  );
  const format = own(message, "format");
  if (format !== "Message" && format !== "AgenticMessage") {
    diagnostics.push(
      diagnostic(
        "agent.invalid_message_format",
        "root.payload.output.message.format",
        "Expected format to be Message or AgenticMessage.",
      ),
    );
  }
  const streaming = own(message, "streaming");
  if (typeof streaming !== "boolean") {
    diagnostics.push(
      diagnostic(
        "agent.invalid_streaming",
        "root.payload.output.message.streaming",
        "Expected streaming to be a boolean.",
      ),
    );
  }
  if (streaming === true && hasOwnDataProperty(message, "value")) {
    diagnostics.push(
      diagnostic(
        "agent.live_stream_value",
        "root.payload.output.message.value",
        "A live streaming event must not contain a materialized value.",
      ),
    );
  }
  if (hasOwnDataProperty(message, "value") && !isObject(own(message, "value"))) {
    diagnostics.push(
      diagnostic(
        "agent.invalid_message_value",
        "root.payload.output.message.value",
        "Expected a projected message object.",
      ),
    );
  }
  for (const field of ["role", "agenticRole", "toolName"]) {
    const value = own(message, field);
    if (value !== undefined) {
      validateRequiredNonEmptyString(
        value,
        `root.payload.output.message.${field}`,
        "agent.invalid_message_metadata",
        diagnostics,
      );
    }
  }
}

function validateAgentAction(action, diagnostics) {
  if (!isObject(action)) {
    diagnostics.push(
      diagnostic(
        "agent.invalid_action",
        "root.payload.action",
        "Expected action to be an object.",
      ),
    );
    return;
  }
  validateDomainFields(
    action,
    "root.payload.action",
    AGENT_ACTION_FIELDS,
    "agent",
    diagnostics,
  );
  if (typeof own(action, "exit") !== "boolean") {
    diagnostics.push(
      diagnostic(
        "agent.invalid_exit",
        "root.payload.action.exit",
        "Expected exit to be a boolean.",
      ),
    );
  }
  const transfer = own(action, "transfer");
  if (transfer !== undefined) {
    if (!isObject(transfer)) {
      diagnostics.push(
        diagnostic(
          "agent.invalid_transfer",
          "root.payload.action.transfer",
          "Expected transfer to be an object.",
        ),
      );
    } else {
      validateDomainFields(
        transfer,
        "root.payload.action.transfer",
        AGENT_TRANSFER_FIELDS,
        "agent",
        diagnostics,
      );
      validateRequiredNonEmptyString(
        own(transfer, "destinationAgent"),
        "root.payload.action.transfer.destinationAgent",
        "agent.invalid_transfer_destination",
        diagnostics,
      );
    }
  }
  const breakLoop = own(action, "breakLoop");
  if (breakLoop !== undefined) {
    if (!isObject(breakLoop)) {
      diagnostics.push(
        diagnostic(
          "agent.invalid_break_loop",
          "root.payload.action.breakLoop",
          "Expected breakLoop to be an object.",
        ),
      );
    } else {
      validateDomainFields(
        breakLoop,
        "root.payload.action.breakLoop",
        AGENT_BREAK_LOOP_FIELDS,
        "agent",
        diagnostics,
      );
      if (
        typeof own(breakLoop, "done") !== "boolean" ||
        !Number.isSafeInteger(own(breakLoop, "currentIterations")) ||
        own(breakLoop, "currentIterations") < 0
      ) {
        diagnostics.push(
          diagnostic(
            "agent.invalid_break_loop",
            "root.payload.action.breakLoop",
            "Expected done boolean and non-negative currentIterations.",
          ),
        );
      }
      const from = own(breakLoop, "from");
      if (from !== undefined) {
        validateRequiredNonEmptyString(
          from,
          "root.payload.action.breakLoop.from",
          "agent.invalid_break_loop_source",
          diagnostics,
        );
      }
    }
  }
  const interrupted = own(action, "interrupted");
  if (interrupted !== undefined) {
    validateAgentInterrupt(interrupted, diagnostics);
  }
}

function validateAgentEventPayload(payload, diagnostics) {
  if (!validateOpenObjectPayload(payload, "agent", diagnostics)) return;
  validateDomainFields(
    payload,
    "root.payload",
    AGENT_EVENT_FIELDS,
    "agent",
    diagnostics,
  );
  const agentName = own(payload, "agentName");
  if (agentName !== undefined) {
    validateRequiredNonEmptyString(
      agentName,
      "root.payload.agentName",
      "agent.invalid_agent_name",
      diagnostics,
    );
  }
  const runPath = own(payload, "runPath");
  if (runPath !== undefined) {
    let valid = Array.isArray(runPath) && runPath.length > 0;
    for (let index = 0; valid && index < runPath.length; index += 1) {
      const entry = own(runPath, String(index));
      valid = typeof entry === "string" && entry.length > 0;
    }
    if (!valid) {
      diagnostics.push(
        diagnostic(
          "agent.invalid_run_path",
          "root.payload.runPath",
          "Expected runPath to contain non-empty agent names.",
        ),
      );
    }
  }
  const output = own(payload, "output");
  if (output !== undefined) {
    if (!isObject(output)) {
      diagnostics.push(
        diagnostic(
          "agent.invalid_output",
          "root.payload.output",
          "Expected output to be an object.",
        ),
      );
    } else {
      validateDomainFields(
        output,
        "root.payload.output",
        AGENT_OUTPUT_FIELDS,
        "agent",
        diagnostics,
      );
      if (hasOwnDataProperty(output, "message")) {
        validateAgentMessage(own(output, "message"), diagnostics);
      }
    }
  }
  if (hasOwnDataProperty(payload, "action")) {
    validateAgentAction(own(payload, "action"), diagnostics);
  }
  const error = own(payload, "error");
  if (error !== undefined) {
    if (!isObject(error)) {
      diagnostics.push(
        diagnostic(
          "agent.invalid_error",
          "root.payload.error",
          "Expected error to be an object.",
        ),
      );
    } else {
      validateDomainFields(
        error,
        "root.payload.error",
        AGENT_ERROR_FIELDS,
        "agent",
        diagnostics,
      );
      if (typeof own(error, "message") !== "string") {
        diagnostics.push(
          diagnostic(
            "agent.invalid_error_message",
            "root.payload.error.message",
            "Expected an error message string.",
          ),
        );
      }
    }
  }
}

/** Validate a non-consuming Eino ADK AgentEvent projection. */
export function validateAgentEventEnvelope(input) {
  return validateSchemaEnvelope(
    input,
    AGENT_EVENT_KIND,
    AGENT_EVENT_KIND_VERSION,
    "agent",
    validateAgentEventPayload,
  );
}

export function parseAgentEventEnvelope(input) {
  const result = validateAgentEventEnvelope(input);
  if (!result.valid) throw new EinoDAGProtocolError(result.diagnostics);
  return input;
}

function buildEnvelope(definition) {
  if (!isObject(definition)) {
    return definition;
  }
  const envelope = {
    protocol: EINO_DAG_PROTOCOL,
    protocolVersion: EINO_DAG_PROTOCOL_VERSION,
    kind: own(definition, "kind"),
    kindVersion: own(definition, "kindVersion"),
    payload: own(definition, "payload"),
  };
  for (const field of ["source", "correlation", "observedAtMs", "metadata"]) {
    if (hasOwnDataProperty(definition, field)) {
      envelope[field] = own(definition, field);
    }
  }
  return envelope;
}

/** Construct and validate a protocol envelope for one domain payload. */
export function createEinoDAGEnvelope(definition) {
  return parseEinoDAGEnvelope(buildEnvelope(definition));
}

function workflowDiagnostics(errors, adapterId) {
  return errors.map((entry) =>
    diagnostic(`workflow.${entry.code}`, entry.path, entry.message, { adapterId }),
  );
}

/** Losslessly wrap the existing WorkflowSnapshot v1 contract. */
export function adaptWorkflowSnapshot(input, options = {}) {
  const adapterId = "workflow-snapshot-v1";
  const validation = validateWorkflowSnapshot(input);
  if (!validation.valid) {
    return failed(workflowDiagnostics(validation.errors, adapterId));
  }

  const source = hasOwnDataProperty(options, "source")
    ? own(options, "source")
    : {
        module: "eino-workflow-dag",
        format: "WorkflowSnapshot",
      };
  const definition = {
    kind: WORKFLOW_SNAPSHOT_KIND,
    kindVersion: WORKFLOW_SNAPSHOT_KIND_VERSION,
    payload: input,
    source,
  };
  for (const field of ["correlation", "observedAtMs", "metadata"]) {
    if (hasOwnDataProperty(options, field)) {
      definition[field] = own(options, field);
    }
  }
  const envelope = buildEnvelope(definition);
  const envelopeValidation = validateEinoDAGEnvelope(envelope);
  return envelopeValidation.valid
    ? succeeded(envelope)
    : failed(
        envelopeValidation.diagnostics.map((entry) =>
          Object.freeze({ ...entry, adapterId }),
        ),
      );
}

export const workflowSnapshotAdapter = Object.freeze({
  id: "workflow-snapshot-v1",
  kind: WORKFLOW_SNAPSHOT_KIND,
  canAdapt(input) {
    return (
      isObject(input) &&
      own(input, "schemaVersion") === 1 &&
      hasOwnDataProperty(input, "workflow")
    );
  },
  adapt: adaptWorkflowSnapshot,
});

function validateAdapter(adapter) {
  if (!isObject(adapter)) {
    throw new TypeError("Expected an Eino DAG adapter object");
  }
  const id = own(adapter, "id");
  const kind = own(adapter, "kind");
  const canAdapt = own(adapter, "canAdapt");
  const adapt = own(adapter, "adapt");
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError("An Eino DAG adapter requires a non-empty string id");
  }
  if (typeof kind !== "string" || kind.length === 0) {
    throw new TypeError(`Adapter "${id}" requires a non-empty string kind`);
  }
  if (typeof canAdapt !== "function" || typeof adapt !== "function") {
    throw new TypeError(`Adapter "${id}" requires canAdapt and adapt functions`);
  }
  return { adapter, id, kind, canAdapt, adapt };
}

function adapterFailure(code, message, adapterId) {
  return failed([
    diagnostic(code, "root", message, adapterId ? { adapterId } : {}),
  ]);
}

function normalizeAdapterDiagnostics(value, adapterId) {
  if (!Array.isArray(value)) return null;
  const normalized = [];
  for (const entry of value) {
    if (!isObject(entry)) return null;
    const severity = own(entry, "severity");
    const code = own(entry, "code");
    const path = own(entry, "path");
    const message = own(entry, "message");
    if (
      (severity !== "warning" && severity !== "error") ||
      typeof code !== "string" ||
      code.length === 0 ||
      typeof path !== "string" ||
      path.length === 0 ||
      typeof message !== "string" ||
      message.length === 0
    ) {
      return null;
    }
    normalized.push(
      Object.freeze({
        severity,
        code,
        path,
        message,
        adapterId: own(entry, "adapterId") || adapterId,
      }),
    );
  }
  return normalized;
}

/** Create an isolated, deterministic adapter registry. */
export function createEinoDAGAdapterRegistry(
  initialAdapters = [workflowSnapshotAdapter],
) {
  const adapters = new Map();

  function register(adapter) {
    const validated = validateAdapter(adapter);
    if (adapters.has(validated.id)) {
      throw new TypeError(`Eino DAG adapter id "${validated.id}" is already registered`);
    }
    adapters.set(validated.id, validated);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (adapters.get(validated.id) === validated) adapters.delete(validated.id);
    };
  }

  if (!Array.isArray(initialAdapters)) {
    throw new TypeError("Expected initialAdapters to be an array");
  }
  for (const adapter of initialAdapters) register(adapter);

  function listAdapters() {
    return Object.freeze(
      [...adapters.values()].map(({ id, kind }) => Object.freeze({ id, kind })),
    );
  }

  function adapt(input, options = {}) {
    const jsonIssues = findJSONValueIssues(input);
    if (jsonIssues.length) {
      return failed(
        jsonIssues.map((entry) =>
          diagnostic(`json.${entry.code}`, entry.path, entry.message),
        ),
      );
    }

    const requestedId = own(options, "adapterId");
    let candidates;
    if (requestedId !== undefined) {
      if (typeof requestedId !== "string" || requestedId.length === 0) {
        return adapterFailure(
          "adapter.invalid_id",
          "adapterId must be a non-empty string.",
        );
      }
      const selected = adapters.get(requestedId);
      if (!selected) {
        return adapterFailure(
          "adapter.not_found",
          `No Eino DAG adapter is registered with id "${requestedId}".`,
          requestedId,
        );
      }
      candidates = [selected];
    } else {
      candidates = [];
      for (const entry of adapters.values()) {
        try {
          if (entry.canAdapt.call(entry.adapter, input)) candidates.push(entry);
        } catch (error) {
          return adapterFailure(
            "adapter.probe_failed",
            `Adapter "${entry.id}" failed while inspecting input: ${error instanceof Error ? error.message : String(error)}`,
            entry.id,
          );
        }
      }
    }

    if (candidates.length === 0) {
      return adapterFailure(
        "adapter.unsupported_input",
        "No registered Eino DAG adapter recognizes this input.",
      );
    }
    if (candidates.length > 1) {
      return adapterFailure(
        "adapter.ambiguous_input",
        `Multiple adapters recognize this input: ${candidates.map(({ id }) => id).join(", ")}. Select one with adapterId.`,
      );
    }

    const selected = candidates[0];
    let result;
    try {
      result = selected.adapt.call(
        selected.adapter,
        input,
        own(options, "adapterOptions") || {},
      );
    } catch (error) {
      return adapterFailure(
        "adapter.failed",
        `Adapter "${selected.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
        selected.id,
      );
    }
    if (!isObject(result) || typeof own(result, "ok") !== "boolean") {
      return adapterFailure(
        "adapter.invalid_result",
        `Adapter "${selected.id}" returned an invalid result.`,
        selected.id,
      );
    }
    const resultDiagnostics = normalizeAdapterDiagnostics(
      own(result, "diagnostics"),
      selected.id,
    );
    if (resultDiagnostics === null) {
      return adapterFailure(
        "adapter.invalid_result",
        `Adapter "${selected.id}" returned invalid diagnostics.`,
        selected.id,
      );
    }
    const resultOK = own(result, "ok");
    const hasErrorDiagnostic = resultDiagnostics.some(
      (entry) => entry.severity === "error",
    );
    if (resultOK && hasErrorDiagnostic) {
      return adapterFailure(
        "adapter.invalid_result",
        `Adapter "${selected.id}" reported success with error diagnostics.`,
        selected.id,
      );
    }
    if (!resultOK) {
      if (!hasErrorDiagnostic) {
        return adapterFailure(
          "adapter.invalid_result",
          `Adapter "${selected.id}" reported failure without an error diagnostic.`,
          selected.id,
        );
      }
      return failed(resultDiagnostics);
    }

    const envelope = own(result, "envelope");
    const validation = validateEinoDAGEnvelope(envelope);
    if (!validation.valid) {
      return failed(
        validation.diagnostics.map((entry) =>
          Object.freeze({ ...entry, adapterId: selected.id }),
        ),
      );
    }
    if (own(envelope, "kind") !== selected.kind) {
      return adapterFailure(
        "adapter.kind_mismatch",
        `Adapter "${selected.id}" declared kind "${selected.kind}" but returned "${String(own(envelope, "kind"))}".`,
        selected.id,
      );
    }
    return succeeded(envelope, resultDiagnostics);
  }

  return Object.freeze({ register, listAdapters, adapt });
}
