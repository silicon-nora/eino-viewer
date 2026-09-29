import type {
  ComposeGraphEnvelope,
  AgentEventEnvelope,
  CallbackEventEnvelope,
  EinoDAGDiagnostic,
  EinoDAGEnvelope,
  SchemaAgenticMessageEnvelope,
  SchemaDocumentEnvelope,
  SchemaMessageEnvelope,
  SchemaToolEnvelope,
} from "./protocol.js";
import type { EinoWorkflowSnapshot } from "eino-workflow-dag";
import type { ComponentIOEnvelope } from "./component-protocol.js";

export interface EinoDAGViewDiagnostic extends EinoDAGDiagnostic {
  readonly viewId?: string;
  readonly envelopeIndex?: number;
}

export type EinoDAGViewResult<TOutput = unknown> =
  | {
      readonly ok: true;
      readonly viewId: string;
      readonly output: TOutput;
      readonly diagnostics: readonly EinoDAGViewDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly EinoDAGViewDiagnostic[];
    };

export interface EinoDAGView<
  TEnvelope extends EinoDAGEnvelope = EinoDAGEnvelope,
  TOutput = unknown,
> {
  readonly id: string;
  readonly kinds: readonly string[];
  readonly automatic?: boolean;
  canProject(envelope: EinoDAGEnvelope): envelope is TEnvelope;
  project(envelope: TEnvelope, options?: unknown): EinoDAGViewResult<TOutput>;
}

export interface EinoDAGViewDescriptor {
  readonly id: string;
  readonly kinds: readonly string[];
  readonly automatic: boolean;
}

export interface EinoDAGViewProjectOptions {
  readonly viewId?: string;
  readonly viewOptions?: unknown;
}

export interface EinoDAGViewRegistry {
  register(view: EinoDAGView): () => boolean;
  listViews(): readonly EinoDAGViewDescriptor[];
  project(
    envelope: unknown,
    options?: EinoDAGViewProjectOptions,
  ): EinoDAGViewResult;
}

export const workflowSnapshotView: EinoDAGView<
  EinoDAGEnvelope<"workflow.snapshot", EinoWorkflowSnapshot>,
  EinoWorkflowSnapshot
>;

export const composeGraphView: EinoDAGView<
  ComposeGraphEnvelope,
  EinoWorkflowSnapshot
>;

export interface TraceViewOutput<TEvent> {
  readonly type: "trace" | "agent" | "component-io";
  readonly runId?: string;
  readonly event: TEvent;
}

export interface ConversationViewOutput<TMessage> {
  readonly type: "conversation";
  readonly format: "Message" | "AgenticMessage";
  readonly message: TMessage;
}

export const callbackTraceView: EinoDAGView<
  CallbackEventEnvelope,
  TraceViewOutput<CallbackEventEnvelope["payload"]>
>;
export const agentExecutionView: EinoDAGView<
  AgentEventEnvelope,
  TraceViewOutput<AgentEventEnvelope["payload"]>
>;
export const messageConversationView: EinoDAGView<
  SchemaMessageEnvelope,
  ConversationViewOutput<SchemaMessageEnvelope["payload"]>
>;
export const agenticMessageConversationView: EinoDAGView<
  SchemaAgenticMessageEnvelope,
  ConversationViewOutput<SchemaAgenticMessageEnvelope["payload"]>
>;
export const toolInspectorView: EinoDAGView<
  SchemaToolEnvelope,
  { readonly type: "tool"; readonly tool: SchemaToolEnvelope["payload"] }
>;
export const documentDataFlowView: EinoDAGView<
  SchemaDocumentEnvelope,
  { readonly type: "data-flow"; readonly document: SchemaDocumentEnvelope["payload"] }
>;
export const componentIOTraceView: EinoDAGView<
  ComponentIOEnvelope,
  TraceViewOutput<ComponentIOEnvelope["payload"]>
>;
export const genericInspectorView: EinoDAGView<
  EinoDAGEnvelope,
  { readonly type: "inspector"; readonly envelope: EinoDAGEnvelope }
>;
export const builtInEinoDAGViews: readonly EinoDAGView[];

export function createEinoDAGViewRegistry(
  initialViews?: readonly EinoDAGView[],
): EinoDAGViewRegistry;

export interface EinoDAGEnvelopeProjection {
  readonly envelopeIndex: number;
  readonly envelope: EinoDAGEnvelope;
  readonly viewId: string;
  readonly output: unknown;
  readonly diagnostics: readonly EinoDAGViewDiagnostic[];
}

export interface EinoDAGCollectionResult {
  readonly ok: boolean;
  readonly projections: readonly EinoDAGEnvelopeProjection[];
  /** Values are indexes into projections, grouped without inventing missing run IDs. */
  readonly byRun: Readonly<Record<string, readonly number[]>>;
  readonly diagnostics: readonly EinoDAGViewDiagnostic[];
}

export interface EinoDAGCollectionOptions {
  readonly registry?: EinoDAGViewRegistry;
  readonly includeUnknown?: boolean;
}

export function projectEinoDAGEnvelopes(
  envelopes: readonly unknown[],
  options?: EinoDAGCollectionOptions,
): EinoDAGCollectionResult;
