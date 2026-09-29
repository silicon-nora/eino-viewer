// Generated from the matching .d.ts file by scripts/sync-cjs-types.js.
import type { CreateWorkflowDAGOptions, EinoWorkflowSnapshot, RenderedNodeData, WorkflowGraph, WorkflowNode } from "eino-workflow-dag";
import type { EinoDAGDiagnostic, EinoDAGEnvelope } from "./protocol.cjs";
import type { ExecutionDAG, ExecutionDAGNode } from "./execution-dag.cjs";
import type { EinoRunCompletion } from "./run-record.cjs";

export declare const EINO_VIEWER_SCHEMA_VERSION: 1;
export declare const EINO_VIEWER_KINDS: readonly ["agent", "graph", "workflow"];
export type EinoViewerKind = "agent" | "graph" | "workflow";

export declare class EinoViewerError extends TypeError {
  readonly code: string;
  readonly diagnostics: readonly EinoDAGDiagnostic[];
  constructor(code: string, message: string, diagnostics?: readonly EinoDAGDiagnostic[]);
}

export interface EinoViewerDocumentBase {
  readonly schemaVersion: 1;
  readonly kind: EinoViewerKind;
  readonly evidence: readonly EinoDAGEnvelope[];
  readonly completion: EinoRunCompletion;
}
export interface AgentViewerDocument extends EinoViewerDocumentBase {
  readonly kind: "agent";
  readonly execution: ExecutionDAG;
  readonly definition?: WorkflowGraph;
}
export interface GraphViewerDocument extends EinoViewerDocumentBase {
  readonly kind: "graph";
  readonly definition: WorkflowGraph;
  readonly execution?: ExecutionDAG;
}
export interface WorkflowViewerDocument extends EinoViewerDocumentBase {
  readonly kind: "workflow";
  readonly definition: EinoWorkflowSnapshot;
  readonly execution?: ExecutionDAG;
}
export type EinoViewerDocument = AgentViewerDocument | GraphViewerDocument | WorkflowViewerDocument;

export interface ProjectEinoViewerOptions {
  readonly kind?: EinoViewerKind;
  readonly runId?: string;
}
export type EinoViewerProjectionResult =
  | { readonly ok: true; readonly document: EinoViewerDocument; readonly diagnostics: readonly EinoDAGDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly EinoDAGDiagnostic[] };

export function projectEinoViewerDocument(input: unknown, options?: ProjectEinoViewerOptions): EinoViewerProjectionResult;

export type EinoViewerNode = ExecutionDAGNode | WorkflowNode | RenderedNodeData;
export interface EinoViewerNodeClickEvent {
  readonly id: string;
  readonly node: EinoViewerNode;
}
export interface CreateEinoViewerOptions extends Omit<CreateWorkflowDAGOptions, "snapshot" | "onNodeClick">, ProjectEinoViewerOptions {
  readonly onNodeClick?: (event: EinoViewerNodeClickEvent) => void;
}
export interface EinoViewerInstance {
  readonly kind: EinoViewerKind;
  readonly document: EinoViewerDocument;
  update(input: unknown): void;
  destroy(): void;
}
export function createEinoViewer(container: Element, input: unknown, options?: CreateEinoViewerOptions): EinoViewerInstance;
