import type {
  EinoDAGEnvelope,
  EinoDAGEnvelopeValidationResult,
} from "./protocol-core.js";
import type { JsonValue } from "eino-workflow-dag";

export declare const COMPONENT_IO_KIND: "component.io";
export declare const COMPONENT_IO_KIND_VERSION: 1;

export interface ComponentIOAddressSegment {
  readonly type: string;
  readonly id: string;
  readonly subId?: string;
}

export interface ComponentIOPayload {
  readonly direction: "input" | "output";
  readonly streaming: boolean;
  readonly component: string;
  readonly name?: string;
  readonly type?: string;
  readonly format: string;
  readonly address: readonly ComponentIOAddressSegment[];
  readonly nodePath?: readonly string[];
  readonly body?: JsonValue;
}

export type ComponentIOEnvelope = EinoDAGEnvelope<
  "component.io",
  ComponentIOPayload
>;

export function validateComponentIOEnvelope(
  input: unknown,
): EinoDAGEnvelopeValidationResult;

export function parseComponentIOEnvelope(input: unknown): ComponentIOEnvelope;
