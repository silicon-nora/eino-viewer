// Generated from the matching .d.ts file by scripts/sync-cjs-types.js.
import type {
  EinoWorkflowSnapshot,
  JsonObject,
  JsonValue,
  WorkflowGraph,
} from "eino-workflow-dag";

export declare const EINO_DAG_PROTOCOL: "eino-dag";
export declare const EINO_DAG_PROTOCOL_VERSION: 1;
export declare const WORKFLOW_SNAPSHOT_KIND: "workflow.snapshot";
export declare const WORKFLOW_SNAPSHOT_KIND_VERSION: 1;
export declare const COMPOSE_GRAPH_KIND: "compose.graph";
export declare const COMPOSE_GRAPH_KIND_VERSION: 1;
export declare const CALLBACK_EVENT_KIND: "callback.event";
export declare const CALLBACK_EVENT_KIND_VERSION: 1;
export declare const AGENT_EVENT_KIND: "agent.event";
export declare const AGENT_EVENT_KIND_VERSION: 1;
export declare const SCHEMA_MESSAGE_KIND: "schema.message";
export declare const SCHEMA_MESSAGE_KIND_VERSION: 1;
export declare const SCHEMA_AGENTIC_MESSAGE_KIND: "schema.agentic_message";
export declare const SCHEMA_AGENTIC_MESSAGE_KIND_VERSION: 1;
export declare const SCHEMA_TOOL_KIND: "schema.tool";
export declare const SCHEMA_TOOL_KIND_VERSION: 1;
export declare const SCHEMA_DOCUMENT_KIND: "schema.document";
export declare const SCHEMA_DOCUMENT_KIND_VERSION: 1;

export interface EinoDAGSource {
  readonly [key: string]: string | undefined;
  readonly module: string;
  readonly format: string;
  readonly einoVersion?: string;
  readonly producer?: string;
  readonly producerVersion?: string;
}

export interface EinoDAGCorrelation {
  readonly [key: string]: string | undefined;
  readonly runId?: string;
  readonly parentRunId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly parentSpanId?: string;
  readonly sessionId?: string;
  readonly entityId?: string;
}

export interface EinoDAGEnvelope<
  TKind extends string = string,
  TPayload = unknown,
> {
  readonly protocol: "eino-dag";
  readonly protocolVersion: 1;
  readonly kind: TKind;
  readonly kindVersion: number;
  readonly payload: TPayload;
  readonly source?: EinoDAGSource;
  readonly correlation?: EinoDAGCorrelation;
  readonly observedAtMs?: number;
  readonly metadata?: JsonObject | null;
}

export interface EinoDAGEnvelopeDefinition<
  TKind extends string,
  TPayload,
> {
  readonly kind: TKind;
  readonly kindVersion: number;
  readonly payload: TPayload;
  readonly source?: EinoDAGSource;
  readonly correlation?: EinoDAGCorrelation;
  readonly observedAtMs?: number;
  readonly metadata?: JsonObject | null;
}

export type EinoDAGDiagnosticSeverity = "warning" | "error";

export interface EinoDAGDiagnostic {
  readonly severity: EinoDAGDiagnosticSeverity;
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly adapterId?: string;
}

export interface EinoDAGEnvelopeValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly EinoDAGDiagnostic[];
}

export class EinoDAGProtocolError extends TypeError {
  constructor(diagnostics: readonly EinoDAGDiagnostic[]);
  readonly code: "INVALID_EINO_DAG_ENVELOPE";
  readonly diagnostics: readonly EinoDAGDiagnostic[];
}

export type EinoDAGAdaptResult<
  TEnvelope extends EinoDAGEnvelope = EinoDAGEnvelope,
> =
  | {
      readonly ok: true;
      readonly envelope: TEnvelope;
      readonly diagnostics: readonly EinoDAGDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly EinoDAGDiagnostic[];
    };

export interface EinoDAGAdaptOptions {
  readonly source?: EinoDAGSource;
  readonly correlation?: EinoDAGCorrelation;
  readonly observedAtMs?: number;
  readonly metadata?: JsonObject | null;
}

export interface EinoDAGAdapter<
  TInput = unknown,
  TEnvelope extends EinoDAGEnvelope = EinoDAGEnvelope,
> {
  readonly id: string;
  readonly kind: TEnvelope["kind"];
  canAdapt(input: unknown): input is TInput;
  adapt(input: TInput, options?: unknown): EinoDAGAdaptResult<TEnvelope>;
}

export interface EinoDAGAdapterDescriptor {
  readonly id: string;
  readonly kind: string;
}

export interface EinoDAGRegistryAdaptOptions {
  readonly adapterId?: string;
  readonly adapterOptions?: unknown;
}

export interface EinoDAGAdapterRegistry {
  register(adapter: EinoDAGAdapter): () => void;
  listAdapters(): readonly EinoDAGAdapterDescriptor[];
  adapt(
    input: unknown,
    options?: EinoDAGRegistryAdaptOptions,
  ): EinoDAGAdaptResult;
}

export type WorkflowSnapshotEnvelope = EinoDAGEnvelope<
  "workflow.snapshot",
  EinoWorkflowSnapshot
>;

export type ComposeGraphEnvelope = EinoDAGEnvelope<
  "compose.graph",
  WorkflowGraph
>;

export type CallbackPhase = "start" | "end" | "error";

export interface CallbackAddressSegment {
  readonly type: string;
  readonly id: string;
  readonly subId?: string;
}

export interface CallbackRunInfo {
  readonly name?: string;
  readonly type?: string;
  readonly component?: string;
}

export interface CallbackEventPayload {
  readonly sequence: number;
  readonly phase: CallbackPhase;
  readonly streaming: boolean;
  readonly timestampMs: number;
  readonly address: readonly CallbackAddressSegment[];
  readonly nodePath?: readonly string[];
  readonly run?: CallbackRunInfo;
  readonly error?: { readonly message: string };
}

export type CallbackEventEnvelope = EinoDAGEnvelope<
  "callback.event",
  CallbackEventPayload
>;

/** Open projection of Eino schema.Message JSON, including future fields. */
export interface SchemaMessagePayload {
  readonly [key: string]: JsonValue | undefined;
  readonly role: string;
  readonly content?: string;
  readonly multi_content?: readonly JsonValue[];
  readonly user_input_multi_content?: readonly JsonValue[];
  readonly assistant_output_multi_content?: readonly JsonValue[];
  readonly tool_calls?: readonly JsonValue[];
}

export type SchemaAgenticContentBlock = JsonObject & {
  readonly type: string;
};

/** Open projection of Eino schema.AgenticMessage JSON. */
export interface SchemaAgenticMessagePayload {
  readonly [key: string]: JsonValue | undefined;
  readonly role: string;
  readonly content_blocks?: readonly SchemaAgenticContentBlock[];
}

/** Open projection of Eino schema.ToolInfo JSON. */
export interface SchemaToolPayload {
  readonly [key: string]: JsonValue | undefined;
  readonly name: string;
  readonly desc?: string;
  readonly has_params_one_of?: boolean;
  readonly params?: JsonObject | null;
  readonly json_schema?: JsonObject | null;
  readonly extra?: JsonObject | null;
}

/** Open projection of Eino schema.Document JSON. */
export interface SchemaDocumentPayload {
  readonly [key: string]: JsonValue | undefined;
  readonly id: string;
  readonly content: string;
  readonly meta_data?: JsonObject | null;
}

export type SchemaMessageEnvelope = EinoDAGEnvelope<
  "schema.message",
  SchemaMessagePayload
>;
export type SchemaAgenticMessageEnvelope = EinoDAGEnvelope<
  "schema.agentic_message",
  SchemaAgenticMessagePayload
>;
export type SchemaToolEnvelope = EinoDAGEnvelope<
  "schema.tool",
  SchemaToolPayload
>;
export type SchemaDocumentEnvelope = EinoDAGEnvelope<
  "schema.document",
  SchemaDocumentPayload
>;

export interface AgentMessageOutput {
  readonly format: "Message" | "AgenticMessage";
  readonly streaming: boolean;
  readonly role?: string;
  readonly agenticRole?: string;
  readonly toolName?: string;
  /** Absent for live streams; projection never consumes a stream. */
  readonly value?: SchemaMessagePayload | SchemaAgenticMessagePayload;
}

export interface AgentEventOutput {
  readonly message?: AgentMessageOutput;
  readonly customizedOutput?: JsonValue;
}

export interface AgentAddressSegment {
  readonly type: string;
  readonly id: string;
  readonly subId?: string;
}

export interface AgentInterruptContext {
  readonly id: string;
  readonly address: readonly AgentAddressSegment[];
  readonly info?: JsonValue;
  readonly isRootCause: boolean;
  readonly parentId?: string;
}

export interface AgentInterrupt {
  readonly data?: JsonValue;
  readonly contexts?: readonly AgentInterruptContext[];
}

export interface AgentEventAction {
  readonly exit: boolean;
  readonly interrupted?: AgentInterrupt;
  readonly transfer?: { readonly destinationAgent: string };
  readonly breakLoop?: {
    readonly from?: string;
    readonly done: boolean;
    readonly currentIterations: number;
  };
  readonly customized?: JsonValue;
}

export interface AgentEventPayload {
  readonly agentName?: string;
  readonly runPath?: readonly string[];
  readonly output?: AgentEventOutput;
  readonly action?: AgentEventAction;
  readonly error?: { readonly message: string };
}

export type AgentEventEnvelope = EinoDAGEnvelope<
  "agent.event",
  AgentEventPayload
>;

export function validateEinoDAGEnvelope(
  input: unknown,
): EinoDAGEnvelopeValidationResult;

export function parseEinoDAGEnvelope(input: unknown): EinoDAGEnvelope;

export function validateComposeGraphEnvelope(
  input: unknown,
): EinoDAGEnvelopeValidationResult;

export function parseComposeGraphEnvelope(input: unknown): ComposeGraphEnvelope;

export function validateCallbackEventEnvelope(
  input: unknown,
): EinoDAGEnvelopeValidationResult;

export function parseCallbackEventEnvelope(input: unknown): CallbackEventEnvelope;

export function validateAgentEventEnvelope(
  input: unknown,
): EinoDAGEnvelopeValidationResult;

export function parseAgentEventEnvelope(input: unknown): AgentEventEnvelope;

export function validateSchemaMessageEnvelope(
  input: unknown,
): EinoDAGEnvelopeValidationResult;

export function parseSchemaMessageEnvelope(input: unknown): SchemaMessageEnvelope;

export function validateSchemaAgenticMessageEnvelope(
  input: unknown,
): EinoDAGEnvelopeValidationResult;

export function parseSchemaAgenticMessageEnvelope(
  input: unknown,
): SchemaAgenticMessageEnvelope;

export function validateSchemaToolEnvelope(
  input: unknown,
): EinoDAGEnvelopeValidationResult;

export function parseSchemaToolEnvelope(input: unknown): SchemaToolEnvelope;

export function validateSchemaDocumentEnvelope(
  input: unknown,
): EinoDAGEnvelopeValidationResult;

export function parseSchemaDocumentEnvelope(
  input: unknown,
): SchemaDocumentEnvelope;

export function createEinoDAGEnvelope<TKind extends string, TPayload>(
  definition: EinoDAGEnvelopeDefinition<TKind, TPayload>,
): EinoDAGEnvelope<TKind, TPayload>;

export function adaptWorkflowSnapshot(
  input: unknown,
  options?: EinoDAGAdaptOptions,
): EinoDAGAdaptResult<WorkflowSnapshotEnvelope>;

export const workflowSnapshotAdapter: EinoDAGAdapter<
  EinoWorkflowSnapshot,
  WorkflowSnapshotEnvelope
>;

export function createEinoDAGAdapterRegistry(
  initialAdapters?: readonly EinoDAGAdapter[],
): EinoDAGAdapterRegistry;
