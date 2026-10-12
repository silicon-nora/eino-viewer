import type { RunRecord, Run, Invocation, Definition, Event, Relation, Content, Usage, Annotation, SourceRecord, Timing } from "./protocol-v2-types.js";
import type { EinoDAGDiagnostic } from "./protocol.js";

export interface InvocationReadingV2 extends Invocation {
  readonly input: readonly Content[];
  readonly output: readonly Content[];
  readonly events: readonly Event[];
  readonly usage: readonly Usage[];
  readonly annotations: readonly Annotation[];
  readonly children: readonly string[];
  /** Observed event order is a reading order, not an inferred causal relation. */
  readonly readingOrder: number;
}
export interface EinoViewerDocumentV2 {
  readonly schemaVersion: 2;
  /** Reading layout. The original source, including application, is run.source. */
  readonly kind: "agent" | "graph" | "workflow";
  readonly record: RunRecord;
  readonly run: Run;
  readonly nodes: readonly InvocationReadingV2[];
  readonly definitions: readonly Definition[];
  readonly events: readonly Event[];
  readonly relations: readonly Relation[];
  readonly contents: readonly Content[];
  readonly usage: readonly Usage[];
  readonly annotations: readonly Annotation[];
  readonly sourceRecords?: readonly SourceRecord[];
}
export type ViewerEntityReferenceV2 = { readonly kind: "run" | "definition" | "invocation" | "event" | "content" | "usage" | "annotation" | "relation" | "sourceRecord"; readonly id: string };
export type ViewerEntityV2 = Run | InvocationReadingV2 | Definition | Event | Relation | Content | Usage | Annotation | SourceRecord;
export interface ContentReadingV2 {
  readonly id: string;
  readonly role: Content["role"];
  readonly availability: Content["data"]["availability"];
  readonly completeness: Content["completeness"];
  readonly provenance: Content["provenance"];
  readonly redacted: boolean;
  readonly truncated: boolean;
  readonly value?: import("./protocol-v2-types.js").JsonValue;
  readonly reason?: string;
  readonly key?: string;
  readonly sha256?: string;
  readonly byteLength?: number;
}
export interface TimingReadingV2 extends Timing {
  readonly clockReversed: boolean;
  readonly availability: "available" | "not-observed";
}
export interface RunExplanationV2 {
  readonly schemaVersion: 2;
  readonly run: {
    readonly id: string;
    readonly mode: Run["mode"];
    readonly status: Run["status"];
    readonly timing: TimingReadingV2;
    readonly capture: Run["capture"];
    readonly input: readonly ContentReadingV2[];
    readonly output: readonly ContentReadingV2[];
    readonly error?: Invocation["error"];
  };
  readonly nodes: readonly (Omit<InvocationReadingV2, "timing" | "input" | "output"> & {
    readonly timing: TimingReadingV2;
    readonly input: readonly ContentReadingV2[];
    readonly output: readonly ContentReadingV2[];
  })[];
  readonly relations: readonly Relation[];
}
export function projectRunRecordV2Document(input: unknown, options?: { readonly kind?: "agent" | "graph" | "workflow"; readonly runId?: string }):
  | { readonly ok: true; readonly document: EinoViewerDocumentV2; readonly diagnostics: readonly EinoDAGDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly EinoDAGDiagnostic[] };
export function contentReadingV2(content: Content): ContentReadingV2;
export function timingReadingV2(timing: Timing): TimingReadingV2;
export function invocationScopeV2(document: EinoViewerDocumentV2, id: string | null): Set<string> | undefined;
export function explainRunRecordV2(document: EinoViewerDocumentV2): RunExplanationV2;
