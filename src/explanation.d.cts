// Generated from the matching .d.ts file by scripts/sync-cjs-types.js.
import type { EinoDAGDiagnostic, EinoDAGEnvelope, EinoDAGSource } from "./protocol.cjs";
import type { ExecutionDAG, ExecutionDAGNodeKind, ExecutionDAGNodeStatus } from "./execution-dag.cjs";
import type { EinoWorkflowSnapshot, JsonObject, JsonValue } from "eino-workflow-dag";

export declare const EXPLANATION_SCHEMA_VERSION: 1;

export type EinoExplanationLocale = "en" | "zh";
export type EinoExplanationBasis = "observed" | "declared" | "inferred";
export type EinoExplanationAvailability = "available" | "not-observed";
export type EinoExplanationStatus = ExecutionDAGNodeStatus | "declared" | "observed" | "unknown";
export type EinoEvidenceDirection = "input" | "output" | "definition" | "event";
export type EinoTimingSemantics = "recorded-boundaries" | "observed-span" | "observed-at" | "declared-duration" | "not-observed";

export interface EinoEvidenceExplanation {
  readonly envelopeIndex: number;
  readonly kind: string;
  readonly role?: string;
  readonly direction: EinoEvidenceDirection;
  readonly claim: string;
  readonly basis: EinoExplanationBasis;
  readonly observedAtMs?: number;
  readonly source?: EinoDAGSource;
  readonly value?: JsonValue;
  readonly payload?: JsonValue;
}

export interface EinoExplanationValueItem {
  readonly label: string;
  readonly availability?: "available" | "empty" | "null" | "not-observed" | "truncated" | "redacted";
  readonly reason?: string;
  readonly value?: JsonValue;
  readonly basis: EinoExplanationBasis;
  readonly evidenceEnvelopeIndexes: readonly number[];
}

export interface EinoExplanationChannel {
  readonly availability: EinoExplanationAvailability;
  readonly summary: string;
  readonly items: readonly EinoExplanationValueItem[];
}

export interface EinoExplanationRelationship {
  readonly nodeId: string;
  readonly label: string;
  readonly relation: string;
  readonly summary: string;
  readonly basis: EinoExplanationBasis;
}

export interface EinoExplanationTiming {
  readonly semantics: EinoTimingSemantics;
  readonly availability: "available" | "partial" | "not-observed" | "invalid";
  readonly basis: "lifecycle" | "callback" | "component" | "workflow" | "unknown";
  readonly summary: string;
  readonly evidenceEnvelopeIndexes: readonly number[];
  readonly reason?: "boundaries-not-recorded" | "start-not-recorded" | "end-not-recorded" | "timestamp-not-recorded" | "invalid-timestamp" | "clock-reversed" | "ambiguous-boundary";
  /** Only recorded boundaries are exposed. Duration requires a valid, ordered pair. */
  readonly startedAtMs?: number;
  readonly finishedAtMs?: number;
  readonly durationMs?: number;
}

export interface EinoNodeExplanation {
  readonly id: string;
  readonly path: readonly string[];
  readonly label: string;
  readonly kind: ExecutionDAGNodeKind | "event" | string;
  readonly component: string;
  readonly status: EinoExplanationStatus;
  readonly basis: EinoExplanationBasis;
  readonly headline: string;
  readonly summary: string;
  readonly rationale: string;
  readonly input: EinoExplanationChannel;
  readonly output: EinoExplanationChannel;
  readonly causes: readonly EinoExplanationRelationship[];
  readonly effects: readonly EinoExplanationRelationship[];
  readonly timing: EinoExplanationTiming;
  readonly evidence: readonly EinoEvidenceExplanation[];
  readonly technical: {
    readonly correlation: JsonObject;
    readonly metadata: JsonObject;
  };
  readonly limitations: readonly string[];
}

export interface EinoExplanationStatistics {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly toolCallCount: number;
  readonly agentToolCallNodeCount: number;
  readonly failedNodeCount: number;
  readonly evidenceCount: number;
}

export interface EinoRunSummaryValue {
  readonly label: string;
  readonly reason?: string;
  readonly value?: JsonValue;
  readonly availability: "available" | "empty" | "null" | "not-observed" | "truncated" | "redacted";
  readonly evidenceEnvelopeIndexes: readonly number[];
}

export interface EinoRunSummaryChannel {
  readonly availability: "available" | "not-observed" | "partial" | "redacted";
  readonly summary: string;
  readonly items: readonly EinoRunSummaryValue[];
}

export interface EinoRunSummary {
  readonly timing: EinoExplanationTiming;
  readonly result: {
    readonly state: "success" | "failed" | "cancelled" | "interrupted" | "unknown" | "definition-only";
    readonly basis: "recorded" | "legacy" | "declared";
    readonly label: string;
    readonly evidenceEnvelopeIndexes: readonly number[];
  };
  readonly input: EinoRunSummaryChannel;
  readonly output: EinoRunSummaryChannel;
  readonly issues: readonly {
    readonly kind: "error" | "interruption";
    readonly scope: "run" | "step";
    readonly message: string;
    readonly nodeId?: string;
    readonly recovered: boolean;
    readonly evidenceEnvelopeIndexes: readonly number[];
  }[];
  readonly capture: {
    readonly status: "complete" | "partial" | "unknown";
    readonly label: string;
    readonly evidenceEnvelopeIndexes: readonly number[];
    readonly limitations: readonly string[];
  };
}

/** A reading context, not an additional execution step or inferred result. */
export interface EinoExplanationGroup {
  readonly id: string;
  readonly label: string;
  readonly kind: "agent" | "graph" | "workflow";
  readonly parentId?: string;
  /** Direct members only; child groups retain their own steps and evidence. */
  readonly nodeIds: readonly string[];
  readonly evidenceEnvelopeIndexes: readonly number[];
  readonly basis: "observed" | "declared";
  readonly limitations?: readonly string[];
}

export interface EinoExplanation {
  readonly schemaVersion: 1;
  readonly subject: "execution" | "workflow" | "graph" | "envelope";
  readonly title: string;
  readonly summary: string;
  readonly status: EinoExplanationStatus;
  readonly basis: EinoExplanationBasis;
  readonly runId?: string;
  readonly run: EinoRunSummary;
  readonly nodes: readonly EinoNodeExplanation[];
  readonly groups: readonly EinoExplanationGroup[];
  readonly statistics: EinoExplanationStatistics;
  readonly limitations: readonly string[];
}

export type EinoExplanationResult =
  | { readonly ok: true; readonly explanation: EinoExplanation; readonly diagnostics: readonly EinoDAGDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly EinoDAGDiagnostic[] };

export type EinoEvidenceExplanationResult =
  | { readonly ok: true; readonly explanation: EinoEvidenceExplanation; readonly diagnostics: readonly EinoDAGDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly EinoDAGDiagnostic[] };

export interface ExplainEinoOptions {
  readonly locale?: EinoExplanationLocale;
  readonly runId?: string;
  readonly envelopes?: readonly EinoDAGEnvelope[];
  readonly diagnostics?: readonly (EinoDAGDiagnostic & { readonly envelopeIndex?: number })[];
}

export interface ExplainEinoEnvelopeOptions {
  readonly locale?: EinoExplanationLocale;
  readonly envelopeIndex?: number;
  readonly role?: string;
}

export function explainEinoEnvelope(envelope: unknown, options?: ExplainEinoEnvelopeOptions): EinoEvidenceExplanationResult;
export function explainExecutionDAG(dag: ExecutionDAG, envelopes?: readonly EinoDAGEnvelope[], options?: ExplainEinoOptions): EinoExplanationResult;
export function explainWorkflowSnapshot(snapshot: EinoWorkflowSnapshot, options?: ExplainEinoOptions): EinoExplanationResult;
export function explainEino(value: unknown, options?: ExplainEinoOptions): EinoExplanationResult;
