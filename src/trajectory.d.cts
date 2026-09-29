// Generated from the matching .d.ts file by scripts/sync-cjs-types.js.
import type { EinoDAGDiagnostic, EinoDAGEnvelope } from "./protocol.cjs";
import type { JsonObject, JsonValue } from "eino-workflow-dag";
import type { EinoRunCompletion } from "./run-record.cjs";

export declare const EXECUTION_TRAJECTORY_SCHEMA_VERSION: 1;

export type TrajectoryRecordKind = "user" | "assistant" | "tool" | "error";
export type TrajectoryStatus = "success" | "running" | "failed" | "cancelled" | "incomplete";

export interface TrajectoryEvidenceRef {
  readonly envelopeIndex: number;
  readonly kind: string;
  readonly role?: string;
}

export interface TrajectoryTiming {
  readonly semantics: "observed-at" | "observed-span" | "component-boundary";
  readonly startedAtMs?: number;
  readonly finishedAtMs?: number;
  readonly durationMs?: number;
}

export interface TrajectoryRecord {
  readonly id: string;
  readonly sequence: number;
  readonly kind: TrajectoryRecordKind;
  readonly status: TrajectoryStatus;
  readonly label: string;
  readonly turn?: number;
  readonly step?: number;
  readonly depth: number;
  readonly parentId?: string;
  readonly toolCallId?: string;
  readonly input?: JsonValue;
  readonly output?: JsonValue;
  readonly error?: { readonly message: string };
  readonly timing?: TrajectoryTiming;
  readonly evidence: readonly TrajectoryEvidenceRef[];
  readonly metadata: JsonObject;
}

export interface ExecutionTrajectory {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly status: TrajectoryStatus;
  readonly completion: EinoRunCompletion;
  readonly records: readonly TrajectoryRecord[];
  readonly metadata: {
    readonly envelopeCount: number;
    readonly representedEvidenceCount: number;
    readonly sourceKinds: readonly string[];
  };
}

export interface ExecutionTrajectoryDiagnostic extends EinoDAGDiagnostic {
  readonly envelopeIndex?: number;
}

export type ExecutionTrajectoryResult =
  | {
    readonly ok: true;
    readonly trajectory: ExecutionTrajectory;
    readonly diagnostics: readonly ExecutionTrajectoryDiagnostic[];
  }
  | { readonly ok: false; readonly diagnostics: readonly ExecutionTrajectoryDiagnostic[] };

export interface BuildExecutionTrajectoryOptions { readonly runId?: string; }

export interface ExecutionTrajectoryBuilder {
  append(envelope: EinoDAGEnvelope): ExecutionTrajectoryResult;
  appendAll(envelopes: readonly EinoDAGEnvelope[]): ExecutionTrajectoryResult;
  snapshot(): ExecutionTrajectoryResult;
  readonly size: number;
}

export function buildExecutionTrajectory(
  envelopes: readonly unknown[],
  options?: BuildExecutionTrajectoryOptions,
): ExecutionTrajectoryResult;

export function createExecutionTrajectoryBuilder(
  options?: BuildExecutionTrajectoryOptions,
): ExecutionTrajectoryBuilder;
