// Generated from the matching .d.ts file by scripts/sync-cjs-types.js.
import type { EinoDAGDiagnostic, EinoDAGEnvelope } from "./protocol.cjs";
import type { EinoWorkflowSnapshot, JsonObject } from "eino-workflow-dag";
import type { EinoRunCompletion } from "./run-record.cjs";

export declare const EXECUTION_DAG_SCHEMA_VERSION: 1;

export type ExecutionDAGNodeKind =
  | "input" | "output" | "agent" | "tool" | "tool-definition"
  | "component" | "workflow" | "data" | "event" | "error";
export type ExecutionDAGNodeStatus = "running" | "success" | "failed" | "skipped" | "cancelled" | "incomplete";
export type ExecutionDAGEdgeKind = "control" | "data" | "tool-call" | "observation" | "transfer" | "parent-child";

export interface ExecutionDAGEvidence {
  readonly envelopeIndex: number;
  readonly kind: string;
  readonly role?: string;
}

export interface ExecutionDAGNode {
  readonly id: string;
  readonly kind: ExecutionDAGNodeKind;
  readonly label: string;
  readonly component: string;
  readonly status: ExecutionDAGNodeStatus;
  readonly sequence: number;
  readonly evidence: readonly ExecutionDAGEvidence[];
  readonly correlation: Readonly<Record<string, string>>;
  readonly metadata: JsonObject;
  /** Recorded execution boundaries; supporting-message observation times are excluded. */
  readonly startedAtMs?: number;
  readonly finishedAtMs?: number;
  readonly errorMessage?: string;
}

export interface ExecutionDAGEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: ExecutionDAGEdgeKind;
  readonly sequence: number;
  readonly metadata: JsonObject;
}

export interface ExecutionDAG {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly nodes: readonly ExecutionDAGNode[];
  readonly edges: readonly ExecutionDAGEdge[];
  readonly status: "running" | "success" | "failed" | "cancelled" | "incomplete";
  readonly completion: EinoRunCompletion;
  /** Recorded whole-run boundaries, never the earliest/latest child observation. */
  readonly startedAtMs?: number;
  readonly finishedAtMs?: number;
  readonly metadata: JsonObject;
}

export interface ExecutionDAGDiagnostic extends EinoDAGDiagnostic {
  readonly envelopeIndex?: number;
}

export type ExecutionDAGResult =
  | { readonly ok: true; readonly dag: ExecutionDAG; readonly diagnostics: readonly ExecutionDAGDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly ExecutionDAGDiagnostic[] };

export interface BuildExecutionDAGOptions { readonly runId?: string; }

export interface ExecutionDAGCollectionResult {
  readonly ok: boolean;
  readonly dags: readonly ExecutionDAG[];
  readonly diagnostics: readonly ExecutionDAGDiagnostic[];
}

export interface ExecutionDAGBuilder {
  append(envelope: EinoDAGEnvelope): ExecutionDAGResult;
  appendAll(envelopes: readonly EinoDAGEnvelope[]): ExecutionDAGResult;
  snapshot(): ExecutionDAGResult;
  readonly size: number;
}

export function buildExecutionDAG(envelopes: readonly unknown[], options?: BuildExecutionDAGOptions): ExecutionDAGResult;
export function buildExecutionDAGs(envelopes: readonly unknown[]): ExecutionDAGCollectionResult;
export function createExecutionDAGBuilder(options?: BuildExecutionDAGOptions): ExecutionDAGBuilder;
export function executionDAGToWorkflowSnapshot(dag: ExecutionDAG): EinoWorkflowSnapshot;
