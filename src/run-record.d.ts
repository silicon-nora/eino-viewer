import type { EinoDAGDiagnostic, EinoDAGEnvelope, EinoDAGEnvelopeValidationResult } from "./protocol.js";

export declare const EINO_RUN_RECORD_SCHEMA_VERSION: 1;
export declare const EINO_RUN_SOURCES: readonly ["agent", "graph", "workflow"];
export type EinoRunSource = "agent" | "graph" | "workflow";

/** Source-factual settlement and capture completeness, independent of step errors. */
export type EinoRunCompletion =
  | { readonly state: "ended"; readonly basis: "recorded"; readonly outcome: "success" | "failed" | "cancelled" | "unknown"; readonly capture: "complete" | "partial" }
  | { readonly state: "open"; readonly basis: "recorded" }
  | { readonly state: "unknown"; readonly basis: "legacy" };

export interface EinoRunRecord {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly source: EinoRunSource;
  readonly evidence: readonly EinoDAGEnvelope[];
  readonly diagnostics?: readonly EinoDAGDiagnostic[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function validateEinoRunRecord(input: unknown): EinoDAGEnvelopeValidationResult;
export function parseEinoRunRecord(input: unknown): EinoRunRecord;
