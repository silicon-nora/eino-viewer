import {
  adaptWorkflowSnapshot,
  validateAgentEventEnvelope,
  validateCallbackEventEnvelope,
  validateComposeGraphEnvelope,
  validateComponentIOEnvelope,
  validateEinoDAGEnvelope,
  validateSchemaAgenticMessageEnvelope,
  validateSchemaDocumentEnvelope,
  validateSchemaMessageEnvelope,
  validateSchemaToolEnvelope,
} from "./protocol.js";

function own(object, key) {
  const descriptor =
    object && typeof object === "object"
      ? Object.getOwnPropertyDescriptor(object, key)
      : undefined;
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function freezeDiagnostics(diagnostics) {
  return Object.freeze(diagnostics.slice());
}

function diagnostic(code, path, message, viewId) {
  const value = { severity: "error", code, path, message };
  if (viewId) value.viewId = viewId;
  return Object.freeze(value);
}

function failed(diagnostics) {
  return Object.freeze({ ok: false, diagnostics: freezeDiagnostics(diagnostics) });
}

function succeeded(viewId, output, diagnostics = []) {
  return Object.freeze({
    ok: true,
    viewId,
    output,
    diagnostics: freezeDiagnostics(diagnostics),
  });
}

function mapDiagnostics(diagnostics, viewId) {
  return diagnostics.map((entry) =>
    Object.freeze({
      severity: entry.severity,
      code: entry.code,
      path: entry.path,
      message: entry.message,
      viewId,
    }),
  );
}

export const workflowSnapshotView = Object.freeze({
  id: "workflow.snapshot-v1",
  kinds: Object.freeze(["workflow.snapshot@1"]),
  canProject(envelope) {
    return own(envelope, "kind") === "workflow.snapshot" && own(envelope, "kindVersion") === 1;
  },
  project(envelope) {
    const adapted = adaptWorkflowSnapshot(own(envelope, "payload"));
    if (!adapted.ok) {
      return failed(mapDiagnostics(adapted.diagnostics, this.id));
    }
    return succeeded(this.id, adapted.envelope.payload);
  },
});

export const composeGraphView = Object.freeze({
  id: "compose.graph-v1",
  kinds: Object.freeze(["compose.graph@1"]),
  canProject(envelope) {
    return own(envelope, "kind") === "compose.graph" && own(envelope, "kindVersion") === 1;
  },
  project(envelope) {
    const validation = validateComposeGraphEnvelope(envelope);
    if (!validation.valid) {
      return failed(mapDiagnostics(validation.diagnostics, this.id));
    }
    return succeeded(this.id, {
      schemaVersion: 1,
      workflow: own(envelope, "payload"),
    });
  },
});

function domainView(id, kind, validate, project) {
  return Object.freeze({
    id,
    kinds: Object.freeze([`${kind}@1`]),
    canProject(envelope) {
      return own(envelope, "kind") === kind && own(envelope, "kindVersion") === 1;
    },
    project(envelope) {
      const validation = validate(envelope);
      if (!validation.valid) {
        return failed(mapDiagnostics(validation.diagnostics, id));
      }
      return succeeded(id, project(envelope));
    },
  });
}

export const callbackTraceView = domainView(
  "callback.trace-v1",
  "callback.event",
  validateCallbackEventEnvelope,
  (envelope) => ({
    type: "trace",
    runId: own(own(envelope, "correlation"), "runId"),
    event: own(envelope, "payload"),
  }),
);

export const agentExecutionView = domainView(
  "agent.execution-v1",
  "agent.event",
  validateAgentEventEnvelope,
  (envelope) => ({
    type: "agent",
    runId: own(own(envelope, "correlation"), "runId"),
    event: own(envelope, "payload"),
  }),
);

export const messageConversationView = domainView(
  "schema.message-conversation-v1",
  "schema.message",
  validateSchemaMessageEnvelope,
  (envelope) => ({ type: "conversation", format: "Message", message: own(envelope, "payload") }),
);

export const agenticMessageConversationView = domainView(
  "schema.agentic-message-conversation-v1",
  "schema.agentic_message",
  validateSchemaAgenticMessageEnvelope,
  (envelope) => ({
    type: "conversation",
    format: "AgenticMessage",
    message: own(envelope, "payload"),
  }),
);

export const toolInspectorView = domainView(
  "schema.tool-inspector-v1",
  "schema.tool",
  validateSchemaToolEnvelope,
  (envelope) => ({ type: "tool", tool: own(envelope, "payload") }),
);

export const documentDataFlowView = domainView(
  "schema.document-data-flow-v1",
  "schema.document",
  validateSchemaDocumentEnvelope,
  (envelope) => ({ type: "data-flow", document: own(envelope, "payload") }),
);

export const componentIOTraceView = domainView(
  "component.io-trace-v1",
  "component.io",
  validateComponentIOEnvelope,
  (envelope) => ({
    type: "component-io",
    runId: own(own(envelope, "correlation"), "runId"),
    event: own(envelope, "payload"),
  }),
);

export const genericInspectorView = Object.freeze({
  id: "generic.inspector-v1",
  kinds: Object.freeze(["*@*"]),
  automatic: false,
  canProject() {
    return true;
  },
  project(envelope) {
    return succeeded(this.id, { type: "inspector", envelope });
  },
});

export const builtInEinoDAGViews = Object.freeze([
  workflowSnapshotView,
  composeGraphView,
  callbackTraceView,
  agentExecutionView,
  messageConversationView,
  agenticMessageConversationView,
  toolInspectorView,
  documentDataFlowView,
  componentIOTraceView,
  genericInspectorView,
]);

function validateView(view) {
  if (!isObject(view)) throw new TypeError("Expected an Eino DAG view object");
  const id = own(view, "id");
  const kinds = own(view, "kinds");
  const canProject = own(view, "canProject");
  const project = own(view, "project");
  const automatic = own(view, "automatic");
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError("An Eino DAG view requires a non-empty string id");
  }
  if (
    !Array.isArray(kinds) ||
    kinds.length === 0 ||
    kinds.some((kind) => typeof kind !== "string" || kind.length === 0)
  ) {
    throw new TypeError(`View "${id}" requires non-empty kind descriptors`);
  }
  if (typeof canProject !== "function" || typeof project !== "function") {
    throw new TypeError(`View "${id}" requires canProject and project functions`);
  }
  if (automatic !== undefined && typeof automatic !== "boolean") {
    throw new TypeError(`View "${id}" automatic must be a boolean`);
  }
  return {
    view,
    id,
    kinds: [...kinds],
    automatic: automatic !== false,
    canProject,
    project,
  };
}

function normalizeDiagnostics(value, viewId) {
  if (!Array.isArray(value)) return null;
  const result = [];
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
    result.push(Object.freeze({ severity, code, path, message, viewId }));
  }
  return result;
}

function normalizeViewResult(result, viewId) {
  if (!isObject(result) || typeof own(result, "ok") !== "boolean") {
    return failed([
      diagnostic("view.invalid_result", "root", `View "${viewId}" returned an invalid result.`, viewId),
    ]);
  }
  const diagnostics = normalizeDiagnostics(own(result, "diagnostics"), viewId);
  if (diagnostics === null) {
    return failed([
      diagnostic("view.invalid_result", "root", `View "${viewId}" returned invalid diagnostics.`, viewId),
    ]);
  }
  if (own(result, "ok") === true) {
    if (!Object.prototype.hasOwnProperty.call(result, "output") || diagnostics.some((entry) => entry.severity === "error")) {
      return failed([
        diagnostic("view.invalid_result", "root", `View "${viewId}" returned an inconsistent success result.`, viewId),
      ]);
    }
    return succeeded(viewId, own(result, "output"), diagnostics);
  }
  if (!diagnostics.some((entry) => entry.severity === "error")) {
    return failed([
      diagnostic("view.invalid_result", "root", `View "${viewId}" failure requires an error diagnostic.`, viewId),
    ]);
  }
  return failed(diagnostics);
}

/** Create a deterministic registry that projects envelopes into view inputs. */
export function createEinoDAGViewRegistry(
  initialViews = builtInEinoDAGViews,
) {
  if (!Array.isArray(initialViews)) {
    throw new TypeError("Expected initial Eino DAG views to be an array");
  }
  const views = new Map();

  function register(view) {
    const record = validateView(view);
    if (views.has(record.id)) {
      throw new TypeError(`View "${record.id}" is already registered`);
    }
    views.set(record.id, record);
    let registered = true;
    return () => {
      if (!registered) return false;
      registered = false;
      return views.delete(record.id);
    };
  }

  function listViews() {
    return Object.freeze(
      [...views.values()].map((record) =>
        Object.freeze({
          id: record.id,
          kinds: Object.freeze([...record.kinds]),
          automatic: record.automatic,
        }),
      ),
    );
  }

  function project(envelope, options = {}) {
    const validation = validateEinoDAGEnvelope(envelope);
    if (!validation.valid) return failed(validation.diagnostics);
    const requestedId = own(options, "viewId");
    if (requestedId !== undefined && (typeof requestedId !== "string" || requestedId.length === 0)) {
      return failed([
        diagnostic("view.invalid_id", "root.options.viewId", "Expected viewId to be a non-empty string."),
      ]);
    }

    let matches;
    if (requestedId !== undefined) {
      const selected = views.get(requestedId);
      if (!selected) {
        return failed([
          diagnostic("view.not_found", "root", `No registered view has id "${requestedId}".`, requestedId),
        ]);
      }
      matches = [selected];
    } else {
      matches = [];
      for (const record of views.values()) {
        if (!record.automatic) continue;
        let matched;
        try {
          matched = record.canProject.call(record.view, envelope);
        } catch (error) {
          return failed([
            diagnostic(
              "view.probe_failed",
              "root",
              `View "${record.id}" failed while inspecting the envelope: ${error instanceof Error ? error.message : String(error)}`,
              record.id,
            ),
          ]);
        }
        if (matched === true) matches.push(record);
      }
    }

    if (matches.length === 0) {
      return failed([
        diagnostic("view.unsupported_kind", "root.kind", `No view supports ${own(envelope, "kind")}@${own(envelope, "kindVersion")}.`),
      ]);
    }
    if (matches.length > 1) {
      return failed([
        diagnostic(
          "view.ambiguous",
          "root",
          `Multiple views match the envelope: ${matches.map((record) => record.id).join(", ")}. Select viewId explicitly.`,
        ),
      ]);
    }

    const selected = matches[0];
    if (requestedId !== undefined) {
      let supported;
      try {
        supported = selected.canProject.call(selected.view, envelope);
      } catch (error) {
        return failed([
          diagnostic("view.probe_failed", "root", `View "${selected.id}" failed while inspecting the envelope: ${error instanceof Error ? error.message : String(error)}`, selected.id),
        ]);
      }
      if (supported !== true) {
        return failed([
          diagnostic("view.unsupported_kind", "root.kind", `View "${selected.id}" does not support this envelope.`, selected.id),
        ]);
      }
    }

    try {
      return normalizeViewResult(
        selected.project.call(selected.view, envelope, own(options, "viewOptions")),
        selected.id,
      );
    } catch (error) {
      return failed([
        diagnostic(
          "view.projection_failed",
          "root",
          `View "${selected.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
          selected.id,
        ),
      ]);
    }
  }

  for (const view of initialViews) register(view);
  return Object.freeze({ register, listViews, project });
}

function collectionDiagnostic(entry, envelopeIndex) {
  return Object.freeze({ ...entry, envelopeIndex });
}

/** Project an ordered collection and index successful results by runId. */
export function projectEinoDAGEnvelopes(envelopes, options = {}) {
  if (!Array.isArray(envelopes)) {
    return Object.freeze({
      ok: false,
      projections: Object.freeze([]),
      byRun: Object.freeze({}),
      diagnostics: freezeDiagnostics([
        Object.freeze({
          severity: "error",
          code: "view.invalid_collection",
          path: "root",
          message: "Expected an array of Eino DAG envelopes.",
        }),
      ]),
    });
  }
  const registry = own(options, "registry") || createEinoDAGViewRegistry();
  if (!registry || typeof registry.project !== "function") {
    throw new TypeError("Expected options.registry to be an Eino DAG view registry");
  }
  const includeUnknown = own(options, "includeUnknown") !== false;
  const projections = [];
  const diagnostics = [];
  const runIndexes = new Map();

  for (let index = 0; index < envelopes.length; index += 1) {
    const envelope = own(envelopes, String(index));
    let result = registry.project(envelope);
    if (
      !result.ok &&
      includeUnknown &&
      result.diagnostics.length === 1 &&
      result.diagnostics[0].code === "view.unsupported_kind"
    ) {
      const validation = validateEinoDAGEnvelope(envelope);
      result = validation.valid
        ? normalizeViewResult(genericInspectorView.project(envelope), genericInspectorView.id)
        : failed(validation.diagnostics);
    }
    if (!result.ok) {
      diagnostics.push(
        ...result.diagnostics.map((entry) => collectionDiagnostic(entry, index)),
      );
      continue;
    }
    const projectionIndex = projections.length;
    projections.push(
      Object.freeze({
        envelopeIndex: index,
        envelope,
        viewId: result.viewId,
        output: result.output,
        diagnostics: result.diagnostics,
      }),
    );
    const runId = own(own(envelope, "correlation"), "runId");
    if (typeof runId === "string" && runId.length > 0) {
      const indexes = runIndexes.get(runId) || [];
      indexes.push(projectionIndex);
      runIndexes.set(runId, indexes);
    }
    diagnostics.push(
      ...result.diagnostics.map((entry) => collectionDiagnostic(entry, index)),
    );
  }

  const byRun = {};
  for (const [runId, indexes] of runIndexes) {
    Object.defineProperty(byRun, runId, {
      enumerable: true,
      value: Object.freeze([...indexes]),
    });
  }
  return Object.freeze({
    ok: !diagnostics.some((entry) => entry.severity === "error"),
    projections: Object.freeze(projections),
    byRun: Object.freeze(byRun),
    diagnostics: freezeDiagnostics(diagnostics),
  });
}
