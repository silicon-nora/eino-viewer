import type { RunRecord } from "./protocol-v2-types.cjs";
export type * from "./protocol-v2-types.cjs";

export interface RunRecordV2Diagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}
export interface RunRecordV2Validation {
  readonly ok: boolean;
  readonly errors: readonly RunRecordV2Diagnostic[];
  readonly warnings: readonly RunRecordV2Diagnostic[];
}
/** Validate plain JSON without mutation, fetching references or inferring facts. */
export function validateRunRecordV2(record: unknown): RunRecordV2Validation;
/** Parse text with the shared numeric precision/input limits, then validate v2. */
export function parseRunRecordV2(text: string): RunRecord;
export const runRecordSchema: Readonly<Record<string, unknown>>;
export const cloudFocusSchema: Readonly<Record<string, unknown>>;
