import type {
  Annotation,
  ContentData,
  Event,
  JsonObject,
  JsonValue,
  Parent,
  Ref,
  RunRecord,
  TokenCounts,
} from "../protocol/v2/types.js";

const inlineNull = { availability: "inline", value: null } satisfies ContentData;
const inlineBusiness = { availability: "inline", value: { profile: { name: "Ada" }, documents: [], missing: null } } satisfies ContentData;
const missing = { availability: "missing", reason: "not collected" } satisfies ContentData;
const parent = { state: "unknown", reason: "concurrent scopes" } satisfies Parent;
const owner = { kind: "unknown", reason: "not attributed" } satisfies Ref;
const zeroAndUnknown = { input: 0, inputCached: 0 } satisfies TokenCounts;
const arbitraryBusiness = { schemaVersion: 1, id: "a", owner: { kind: "run", id: "r" }, type: "another-app.unregistered", payload: { unknown: { object: [null, 0, false, ""] } } } satisfies Annotation;
const event = { id: "e", sequence: 0, type: "agent.message", owner, contentRefs: [], attributes: { externalCallId: "same-id" } } satisfies Event;
const json: JsonValue = [null, false, 0, "", {}, []];
const object: JsonObject = { json };

// @ts-expect-error Inline null is present; a missing value is a different state.
const absentInline: ContentData = { availability: "inline" };
// @ts-expect-error Missing content cannot contain a value.
const contradictoryContent: ContentData = { availability: "missing", reason: "lost", value: null };
// @ts-expect-error Unknown ownership requires a reason.
const unknownWithoutReason: Ref = { kind: "unknown" };
// @ts-expect-error Known ownership requires an ID.
const knownWithoutID: Ref = { kind: "invocation" };
// @ts-expect-error Known parent requires an invocation ID.
const parentWithoutID: Parent = { state: "known" };
// @ts-expect-error Source records are optional attachments, not core reference targets.
const rawSourceOwner: Ref = { kind: "sourceRecord", id: "source" };
// @ts-expect-error The normalized contract has a distinct major version.
const oldVersion: RunRecord["schemaVersion"] = 1;

void [inlineNull, inlineBusiness, missing, parent, zeroAndUnknown, arbitraryBusiness, event, object];
void [absentInline, contradictoryContent, unknownWithoutReason, knownWithoutID, parentWithoutID, rawSourceOwner, oldVersion];
