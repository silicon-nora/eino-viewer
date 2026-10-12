import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { parseRunRecordV2, validateRunRecordV2 } from '../protocol/v2/validate.js';

const directory = new URL('../protocol/v2/fixtures/', import.meta.url);
const fixture = name => JSON.parse(readFileSync(new URL(`${name}.json`, directory), 'utf8'));
const standard = () => fixture('cloud-focus-week-report-normal');
const annotation = (r, name) => r.annotations.find(a => a.type === `cloud-focus.${name}`);
function valid(record) {
  const before = JSON.stringify(record);
  const result = validateRunRecordV2(record);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(JSON.stringify(record), before, 'Validation must not rewrite evidence');
  return result;
}
function invalid(name, mutate, code, load = standard) {
  test(name, () => {
    const record = load(); mutate(record);
    const result = validateRunRecordV2(record);
    assert.equal(result.ok, false, 'Invalid contract was accepted');
    assert.ok(result.errors.some(e => e.code === code), JSON.stringify(result.errors));
  });
}

for (const file of readdirSync(directory).filter(f => f.endsWith('.json')).sort()) {
  test(`fixture: ${file}`, () => {
    const text = readFileSync(new URL(file, directory), 'utf8');
    const record = parseRunRecordV2(text);
    assert.deepEqual(record, JSON.parse(text));
    valid(record);
    assert.equal(record.run.labels.synthetic, 'true', 'Examples cannot masquerade as production captures');
  });
}

test('repair consumes a distinct model request while the original model succeeded', () => {
  const record = fixture('cloud-focus-card-repair');
  const calls = record.invocations.filter(i => i.kind === 'model');
  assert.equal(calls.length, 3); assert.ok(calls.every(i => i.status === 'succeeded'));
  assert.equal(record.usage.length, 3);
  assert.equal(record.usage.reduce((n, u) => n + u.tokens.total, 0), 570);
  assert.ok(record.annotations.some(a => a.type === 'cloud-focus.validation' && a.payload.status === 'failed'));
  const repair = record.relations.find(r => r.type === 'repairs');
  assert.notEqual(repair.from.id, repair.to.id);
});
test('soft-stop, work-item parse failure, and unsuccessful Workflow preserve separate facts', () => {
  const soft = fixture('cloud-focus-soft-stop');
  assert.equal(soft.usage.length, 0);
  assert.ok(soft.invocations.length > 0);
  const parse = fixture('cloud-focus-work-items-parse-soft-stop');
  assert.equal(parse.usage.length, 1);
  assert.equal(parse.invocations.filter(i => i.kind === 'model').length, 1);
  assert.equal(annotation(parse, 'validation').payload.stage, 'work_items');
  assert.equal(annotation(parse, 'result').payload.status, 'no_items');
  const empty = fixture('cloud-focus-workflow-failed-success-empty');
  assert.equal(empty.run.status, 'succeeded');
  assert.ok(empty.invocations.some(i => i.kind === 'workflow' && i.status === 'failed'));
  assert.equal(annotation(empty, 'result').payload.status, 'no_items');
});
test('loop instances stay distinct even with the same definition and timestamps', () => {
  const record = fixture('graph-loop-repeated-definition');
  const counts = new Map();
  for (const i of record.invocations) counts.set(i.definitionId, (counts.get(i.definitionId) || 0) + 1);
  assert.ok([...counts.values()].some(n => n >= 3));
  record.events.forEach(e => { e.atMs = 10; });
  valid(record);
});
test('same external tool IDs in different scopes and undispatched requests are valid', () => {
  const record = fixture('agent-parallel-interrupted');
  const requests = record.events.filter(e => e.type === 'tool.requested');
  assert.ok(new Set(requests.map(e => e.attributes.externalCallId)).size < requests.length);
  const dispatched = new Set(record.relations.filter(r => r.type === 'responds_to').map(r => r.to.id));
  assert.ok(requests.some(e => !dispatched.has(e.id)));
  assert.equal(record.run.status, 'interrupted');
  valid(record);
});
test('unknown extensions, original source attachments, and null survive export', () => {
  const r = standard();
  const payload = { value: null, items: [], user_profile: { id: '9007199254740993' } };
  r.annotations.push({ id: 'unregistered', owner: { kind: 'run', id: r.run.id }, type: 'custom.unknown', schemaVersion: 87, payload });
  r.sourceRecords = [{ id: 'source', owner: { kind: 'run', id: r.run.id }, format: 'original', payload }];
  assert.ok(valid(r).warnings.some(w => w.code === 'unknown_annotation'));
  assert.deepEqual(parseRunRecordV2(JSON.stringify(r)), r);
  delete r.sourceRecords; valid(r);
});
test('unknown event and schema names cannot access prototype properties', () => {
  for (const name of ['constructor', 'toString', '__proto__']) {
    const r = standard();
    r.events.push({ id: 'unknown-name', sequence: r.events.at(-1).sequence + 1, type: name, owner: { kind: 'run', id: r.run.id }, contentRefs: [] });
    r.contents[0].schemaRef = name;
    assert.ok(valid(r).warnings.some(w => w.code === 'unknown_content_schema'));
  }
});
test('unknown ownership remains unknown and explicit null is present content', () => {
  const r = standard();
  r.run.capture = { ...r.run.capture, state: 'partial', issues: [{ code: 'ambiguous', message: 'Cannot identify source' }] };
  r.contents.push({ id: 'null-value', owner: { kind: 'unknown', reason: 'Ambiguous producer' }, role: 'other', mediaType: 'application/json', provenance: 'observed', completeness: 'complete', transforms: [], data: { availability: 'inline', value: null } });
  r.invocations.at(-1).parent = { state: 'unknown', reason: 'Parent not observed' };
  valid(r);
});
test('reference content is opaque and clock skew is preserved without guessed timestamps', () => {
  const r = standard();
  r.contents.push({ id: 'external', owner: { kind: 'run', id: r.run.id }, role: 'other', mediaType: 'text/plain', provenance: 'observed', completeness: 'complete', transforms: [], data: { availability: 'reference', key: 'host-controlled-key', sha256: 'a'.repeat(64), byteLength: 0 } });
  r.invocations.at(-1).timing = { startedAtMs: 20, endedAtMs: 10, durationMs: 3, basis: 'monotonic' };
  assert.ok(valid(r).warnings.some(w => w.code === 'clock_order'));
});
test('unknown and known zero usage are distinct legal representations', () => {
  const r = standard();
  r.usage[0] = { id: 'unknown', invocationId: r.usage[0].invocationId, source: 'unknown', completeness: 'unknown', tokens: {} };
  r.usage[1].tokens = { input: 0, output: 0, total: 0, inputCached: 0, outputReasoning: 0 };
  valid(r);
});
test('a second repair request is expressible without changing current production policy', () => {
  const r = fixture('cloud-focus-card-repair');
  const previous = r.invocations.find(i => i.id === 'i:model:repair');
  const response = structuredClone(r.contents.find(c => c.id === previous.outputRefs[0]));
  response.id = 'response:repair-2'; response.owner.id = 'model:repair-2';
  r.contents.push(response);
  r.invocations.push({ ...structuredClone(previous), id: 'model:repair-2', outputRefs: [response.id] });
  r.usage.push({ ...structuredClone(r.usage.at(-1)), id: 'usage:repair-2', invocationId: 'model:repair-2', requestId: 'request:repair-2' });
  r.relations.push({ id: 'repair-2', type: 'repairs', from: { kind: 'invocation', id: 'model:repair-2' }, to: { kind: 'invocation', id: previous.id } });
  const a = structuredClone(r.annotations.find(a => a.payload.repair?.status === 'attempted'));
  a.id = 'validation:repair-2'; a.payload.modelInvocationId = 'model:repair-2'; a.payload.subjectContentRef = response.id;
  a.payload.repair = { status: 'attempted', attemptIndex: 2, attemptCount: 2 };
  r.annotations.push(a); valid(r);
});
test('stream failure can retain partial output and partial usage independently of root result', () => {
  const r = standard();
  const model = r.invocations.find(i => i.kind === 'model');
  model.status = 'failed'; model.error = { code: 'stream_interrupted', message: 'Observed stream ended early' };
  const response = r.contents.find(c => c.id === model.outputRefs[0]);
  response.completeness = 'partial'; response.data = { availability: 'inline', value: 'received prefix' };
  const usage = r.usage.find(u => u.invocationId === model.id);
  usage.completeness = 'partial'; usage.tokens = { input: 120 };
  valid(r);
  assert.equal(usage.tokens.output, undefined);
});
test('Agent transfer requests and observed handoff are separate facts', () => {
  const r = fixture('agent-parallel-interrupted');
  const event = { id: 'transfer', sequence: r.events.at(-1).sequence + 1, type: 'agent.transfer-requested', owner: { kind: 'invocation', id: r.run.rootInvocationId }, contentRefs: [], attributes: { destinationAgent: 'worker' } };
  r.events.push(event); valid(r);
  r.relations.push({ id: 'handoff', type: 'transfers_to', from: event.owner, to: { kind: 'invocation', id: 'i:left' }, evidenceEventId: event.id });
  valid(r);
});

invalid('reject v1 masquerading as v2', r => { r.schemaVersion = 1; }, 'schema');
invalid('reject unversioned core additions', r => { r.task_status = 'done'; }, 'schema');
invalid('reject duplicate invocation identity', r => r.invocations.push(structuredClone(r.invocations[1])), 'duplicate_id');
invalid('reject foreign run content references', r => r.invocations[0].outputRefs.push('other-run:output'), 'dangling_reference');
invalid('reject a missing root', r => { r.run.rootInvocationId = 'unknown'; }, 'dangling_reference');
invalid('reject root outcome inferred from leaf', r => { r.run.status = 'failed'; }, 'root_status');
invalid('reject two roots', r => { r.invocations[1].parent = { state: 'root' }; }, 'root_count');
invalid('reject invocation parent cycle', r => { r.invocations[1].parent = { state: 'known', invocationId: r.invocations[2].id }; r.invocations[2].parent = { state: 'known', invocationId: r.invocations[1].id }; }, 'parent_cycle');
invalid('reject definition containment cycle', r => { r.definitions[0].parentId = r.definitions[1].id; r.definitions[1].parentId = r.definitions[0].id; }, 'parent_cycle');
invalid('reject duplicate observation sequence', r => { r.events[1].sequence = r.events[0].sequence; }, 'event_sequence');
invalid('reject missing body claiming a value', r => { r.contents[0].data = { availability: 'missing', reason: 'not captured', value: null }; }, 'schema');
invalid('reject missing body claiming completeness', r => { r.contents[0].data = { availability: 'missing', reason: 'not captured' }; r.contents[0].completeness = 'complete'; }, 'missing_content');
invalid('reject unknown attribution with complete capture', r => { r.contents[0].owner = { kind: 'unknown', reason: 'ambiguous' }; }, 'capture_gap');
invalid('reject duplicate charge for a model request', r => r.usage.push({ ...r.usage[0], id: 'duplicate-charge' }), 'duplicate_usage');
invalid('reject parent aggregate as a billable call', r => { r.usage[0].invocationId = r.run.rootInvocationId; }, 'usage_owner');
invalid('reject double-added cached tokens', r => { r.usage[0].tokens.total += r.usage[0].tokens.inputCached; }, 'token_total');
invalid('reject reasoning larger than output', r => { r.usage[0].tokens.outputReasoning = 99999; }, 'token_subset');
invalid('reject unknown usage represented as zero', r => { r.usage[0].completeness = 'unknown'; r.usage[0].tokens = { total: 0 }; }, 'unknown_usage');
invalid('reject silently omitted model usage', r => { r.usage = []; }, 'usage_coverage');
invalid('reject route annotation mismatching actual event', r => { annotation(r, 'route-decision').payload.selectedDefinitionIds = [r.definitions[0].id]; }, 'route_targets');
invalid('reject legacy default intent in registered profile', r => { annotation(r, 'route-decision').payload.effectiveIntent = 'week_review'; }, 'annotation_schema');
invalid('reject eval intent mismatching observed route', r => { annotation(r, 'evaluation-context').payload.intent = 'work_guidance'; }, 'evaluation_intent');
invalid('reject eval pointing to a diagnostic instead of result', r => { annotation(r, 'evaluation-context').payload.resultAnnotationId = annotation(r, 'route-decision').id; }, 'evaluation_result');
invalid('reject serialized string user profile', r => { const id = annotation(r, 'evaluation-context').payload.userProfileContentRef; r.contents.find(c => c.id === id).data.value = '{"user_id":"1"}'; }, 'content_schema');
invalid('reject mislabelled eval material', r => { const id = annotation(r, 'evaluation-context').payload.documentsContentRef; delete r.contents.find(c => c.id === id).schemaRef; }, 'profile_content_type');
invalid('reject reassigned card order', r => { annotation(r, 'result').payload.itemIds.reverse(); }, 'result_items');
invalid('reject duplicate item identity', r => { const a = annotation(r, 'result'); const value = r.contents.find(c => c.id === a.payload.contentRef).data.value; value.items[1].itemId = value.items[0].itemId; }, 'duplicate_item');
invalid('reject reordered partial results', r => { const c = r.contents.find(c => c.id === annotation(r, 'result').payload.contentRef); c.completeness = 'partial'; c.data.value.items.reverse(); }, 'result_order');
invalid('reject validation falsely attributed to another model request', r => { annotation(r, 'validation').payload.modelInvocationId = r.invocations.find(i => i.id === 'i:model:work-items').id; }, 'validation_subject');
invalid('reject duplicate contradictory soft-stop origins', r => { const a = r.annotations.find(a => a.type === 'cloud-focus.soft-stop' && !a.payload.inherited); r.annotations.push({ ...structuredClone(a), id: 'contradictory', payload: { ...a.payload, reasonCode: 'different-reason' } }); }, 'duplicate_soft_stop', () => fixture('cloud-focus-soft-stop'));
invalid('reject a complete repair record without repair evidence', r => { r.relations = r.relations.filter(r => r.type !== 'repairs'); }, 'repair_evidence', () => fixture('cloud-focus-card-repair'));
invalid('reject repair count larger than observed requests', r => { r.annotations.find(a => a.payload.repair?.status === 'attempted').payload.repair.attemptCount = 99; }, 'repair_count_evidence', () => fixture('cloud-focus-card-repair'));
invalid('reject inherited soft-stop changing first reason', r => { r.annotations.find(a => a.type === 'cloud-focus.soft-stop' && a.payload.inherited).payload.reasonCode = 'changed'; }, 'soft_stop_reason', () => fixture('cloud-focus-soft-stop'));
invalid('reject requests linked to the wrong event type', r => { const c = r.contents.find(c => c.schemaRef?.endsWith('/Message') && c.data.value.toolRequestEventIds?.length); c.data.value.toolRequestEventIds[0] = r.events.find(e => e.type !== 'tool.requested').id; }, 'message_request', () => fixture('agent-parallel-interrupted'));
invalid('reject tool execution responding to an arbitrary event', r => { r.relations.find(x => x.type === 'responds_to').to.id = r.events.find(e => e.type !== 'tool.requested').id; }, 'tool_request_relation', () => fixture('agent-parallel-interrupted'));
invalid('reject a model call masquerading as tool response', r => { r.relations.find(x => x.type === 'responds_to').from.id = r.invocations.find(i => i.kind === 'model').id; }, 'tool_response_kind', () => fixture('agent-parallel-interrupted'));
invalid('reject a model-to-tool relation masquerading as Agent handoff', r => { r.relations.push({ id: 'invalid-transfer', type: 'transfers_to', from: { kind: 'invocation', id: r.invocations.find(i => i.kind === 'model').id }, to: { kind: 'invocation', id: r.invocations.find(i => i.kind === 'tool').id } }); }, 'transfer_kind', () => fixture('agent-parallel-interrupted'));
invalid('reject unsafe numeric business IDs instead of silently rounding', r => { r.annotations.push({ id: 'unsafe', owner: { kind: 'run', id: r.run.id }, type: 'custom.value', schemaVersion: 1, payload: 9007199254740992 }); }, 'unsafe_integer');
invalid('reject nonfinite metrics', r => r.invocations[0].metrics.push({ name: 'bad', value: Infinity }), 'non_json_number');
test('parser rejects malformed text and validation does not execute getters', () => {
  assert.throws(() => parseRunRecordV2('{broken'));
  let invoked = false;
  const r = standard(); Object.defineProperty(r, 'malicious', { enumerable: true, get() { invoked = true; throw new Error('executed'); } });
  assert.equal(validateRunRecordV2(r).ok, false); assert.equal(invoked, false);
});
test('text import rejects numeric precision loss before JSON.parse rounds facts', () => {
  const r = standard();
  r.annotations.push({ id: 'numeric', owner: { kind: 'run', id: r.run.id }, type: 'custom.numeric', schemaVersion: 1, payload: 'TOKEN' });
  for (const token of ['0.12345678901234567890123456789', '1e-400', '9007199254740991.4']) {
    const text = JSON.stringify(r).replace('"TOKEN"', token);
    assert.throws(() => parseRunRecordV2(text), error => error.code === 'number_precision_loss');
  }
  for (const token of ['1e3', '1.0', '-0']) valid(parseRunRecordV2(JSON.stringify(r).replace('"TOKEN"', token)));
});
