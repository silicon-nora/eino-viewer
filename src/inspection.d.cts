// Generated from the matching .d.ts declaration.
import type { EinoExplanation, EinoNodeExplanation, EinoExplanationGroup } from "./explanation.cjs";
import type { EinoDAGEnvelope } from "./protocol.cjs";

export interface EinoInspectionPage<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}
export interface EinoInspectionPageOptions {
  readonly offset?: number;
  readonly limit?: number;
}
export interface EinoInspectionScopeOptions {
  /** Selects this group and all descendants without changing the original nodes. */
  readonly groupId?: string;
  /** Nodes/evidence with no recorded group; distinct from evidence with no step owner. */
  readonly ungroupedOnly?: boolean;
}
export interface EinoEvidenceDirectoryEntry {
  readonly envelopeIndex: number;
  readonly kind: string;
  readonly label: string;
  readonly nodeIds: readonly string[];
  readonly scope: "run" | "step" | "unassigned";
}
export interface EinoRunInspectionIndex {
  readonly nodeCount: number;
  readonly evidenceCount: number;
  readonly groupCount: number;
  getNode(id: string): EinoNodeExplanation | undefined;
  getEvidence(index: number): EinoEvidenceDirectoryEntry | undefined;
  getGroup(id: string): EinoExplanationGroup | undefined;
  getNodeGroups(nodeId: string): readonly EinoExplanationGroup[];
  getGroupPath(groupId: string): readonly EinoExplanationGroup[];
  searchSteps(query?: string, options?: EinoInspectionPageOptions & EinoInspectionScopeOptions & { readonly issuesOnly?: boolean }): EinoInspectionPage<EinoNodeExplanation>;
  searchEvidence(query?: string, options?: EinoInspectionPageOptions & EinoInspectionScopeOptions & { readonly scope?: "all" | EinoEvidenceDirectoryEntry["scope"] }): EinoInspectionPage<EinoEvidenceDirectoryEntry>;
}
/** Read-only metadata navigation; payload bodies are not indexed or copied. Rebuild after updating the record. */
export function createRunInspectionIndex(explanation: EinoExplanation, envelopes?: readonly EinoDAGEnvelope[]): EinoRunInspectionIndex;
