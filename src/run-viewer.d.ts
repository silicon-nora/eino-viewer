import type { EinoViewerDocument, EinoViewerKind, EinoViewerNode } from "./viewer.js";
import type { EinoDAGEnvelope } from "./protocol.js";
import type { EinoExplanation, EinoExplanationLocale, EinoNodeExplanation } from "./explanation.js";

export interface CreateEinoRunViewerOptions {
  readonly locale?: EinoExplanationLocale;
  /** Bounded step/evidence list page size, clamped to 1..200. Default: 30. */
  readonly pageSize?: number;
  readonly onNodeClick?: (event: { readonly id: string; readonly node: EinoViewerNode | EinoNodeExplanation }) => void;
  readonly onEvidenceClick?: (event: { readonly envelopeIndex: number; readonly envelope: EinoDAGEnvelope }) => void;
}

export interface EinoRunViewerInstance {
  readonly kind: EinoViewerKind;
  readonly document: EinoViewerDocument;
  readonly explanation: EinoExplanation;
  readonly selectedStepId: string | null;
  readonly selectedEnvelopeIndex: number | null;
  /** Selected explicit reading group; null when viewing all or ungrouped records. */
  readonly selectedGroupId: string | null;
  /** Filter steps/evidence to a group and its descendants. null restores all. Unknown IDs return false. */
  selectGroup(id: string | null): boolean;
  /** Select a canonical explained step. Returns false for an unknown ID. */
  selectStep(id: string): boolean;
  /** Select an original zero-based evidence index. Returns false if absent. */
  selectEvidence(index: number): boolean;
  /** Replace a saved record. Invalid inputs throw EinoViewerError without changing the valid view. */
  update(input: unknown): void;
  /** Idempotent; subsequent update/selection calls throw EinoViewerError. */
  destroy(): void;
}

/** Self-styled, read-only complete saved-result inspector. Does not execute or subscribe to a run. */
export function createEinoRunViewer(container: Element, input: unknown, options?: CreateEinoRunViewerOptions): EinoRunViewerInstance;
