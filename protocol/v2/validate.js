import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { findJSONValueIssues } from '../../src/json-value.js';
import { parseRecordJSON } from '../../src/record-input.js';

export const runRecordSchema = JSON.parse(readFileSync(new URL('./run-record.schema.json', import.meta.url), 'utf8'));
export const cloudFocusSchema = JSON.parse(readFileSync(new URL('./cloud-focus.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
ajv.addSchema(cloudFocusSchema);
const structural = ajv.compile(runRecordSchema);
const contentValidators = new Map();
for (const catalog of [runRecordSchema, cloudFocusSchema]) {
  for (const name of Object.keys(catalog.$defs)) {
    const uri = `${catalog.$id}#/$defs/${name}`;
    contentValidators.set(uri, ajv.getSchema(uri));
  }
}
const profiles = new Map();
const eventPayloads = new Map([['tool.requested', 'ToolRequest'], ['agent.transfer-requested', 'TransferRequest']]);
for (const name of ['route-decision', 'soft-stop', 'validation', 'dependency-warning', 'evaluation-context', 'result']) {
  profiles.set(`cloud-focus.${name}@1`, ajv.getSchema(`${cloudFocusSchema.$id}#/$defs/${name}`));
}

/** Repository contract validator; does not mutate, fetch content, or infer missing facts. */
export function validateRunRecordV2(record) {
  const errors = [];
  const warnings = [];
  const fail = (code, path, message) => errors.push({ code, path, message });
  const warn = (code, path, message) => warnings.push({ code, path, message });
  const jsonErrors = findJSONValueIssues(record, 'record');
  if (jsonErrors.length) return { ok: false, errors: jsonErrors, warnings };
  if (!structural(record)) {
    return { ok: false, errors: structural.errors.map(e => ({ code: 'schema', path: e.instancePath || '/', message: e.message })), warnings };
  }
  const collections = { definition: record.definitions, invocation: record.invocations, event: record.events,
    content: record.contents, usage: record.usage, annotation: record.annotations };
  const indexes = { run: new Map([[record.run.id, record.run]]) };
  for (const [kind, list] of Object.entries(collections)) {
    indexes[kind] = new Map();
    list.forEach((item, i) => {
      if (indexes[kind].has(item.id)) fail('duplicate_id', `/${kind}/${i}/id`, `Duplicate ${kind} ID: ${item.id}`);
      indexes[kind].set(item.id, item);
    });
  }
  const get = (kind, id, path) => {
    const value = indexes[kind]?.get(id);
    if (!value) fail('dangling_reference', path, `Unknown ${kind}: ${id}`);
    return value;
  };
  const resolve = (ref, path, allowUnknown = true) => {
    if (ref.kind === 'unknown') {
      if (!allowUnknown) fail('unknown_relation', path, 'A relation requires observed, known endpoints; omit an unobserved relation.');
      if (record.run.capture.state !== 'partial') fail('capture_gap', path, 'Unknown ownership requires partial capture.');
      return;
    }
    return get(ref.kind, ref.id, path);
  };
  const contentRef = (id, path) => get('content', id, path);
  const checkParentCycles = (list, kind, parentOf) => {
    const done = new Set();
    for (const item of list) {
      const active = new Set();
      let cursor = item;
      while (cursor && !done.has(cursor.id)) {
        if (active.has(cursor.id)) { fail('parent_cycle', `/${kind}/${item.id}`, 'Containment parents must not form a cycle.'); break; }
        active.add(cursor.id);
        const parentId = parentOf(cursor);
        cursor = parentId ? indexes[kind].get(parentId) : undefined;
      }
      for (const id of active) done.add(id);
    }
  };
  const timing = (value, path, status) => {
    if (status === 'running' && value.endedAtMs !== undefined) fail('running_has_end', path, 'Running calls cannot have a known end time.');
    if (value.startedAtMs !== undefined && value.endedAtMs !== undefined && value.endedAtMs < value.startedAtMs) {
      warn('clock_order', path, 'Source wall-clock end precedes start; preserve it and use an observed monotonic duration.');
    }
  };
  const capture = record.run.capture;
  if (capture.state === 'partial' && !capture.issues.length) fail('missing_capture_reason', '/run/capture', 'Partial capture needs at least one issue.');
  if (capture.state === 'complete' && capture.issues.length) fail('conflicting_capture', '/run/capture', 'Complete capture cannot contain capture issues.');
  capture.issues.forEach((issue, i) => { if (issue.owner) resolve(issue.owner, `/run/capture/issues/${i}/owner`); });
  timing(record.run.timing, '/run/timing', record.run.status);
  if (record.run.mode === 'definition') {
    if (record.run.rootInvocationId !== undefined || record.invocations.length || record.usage.length || record.run.status !== 'unknown') {
      fail('definition_execution', '/run', 'Definition-only records have no root, invocations or usage and have unknown execution status.');
    }
  } else {
    const root = get('invocation', record.run.rootInvocationId, '/run/rootInvocationId');
    if (root) {
      if (root.parent.state !== 'root' || root.kind !== record.run.source) fail('invalid_root', '/run/rootInvocationId', 'Root parent and kind must agree with the declared run source.');
      if (root.status !== record.run.status) fail('root_status', '/run/status', 'Run status must be the explicit root status.');
      for (const key of ['basis', 'startedAtMs', 'endedAtMs', 'durationMs']) {
        if (root.timing[key] !== record.run.timing[key]) fail('root_timing', `/run/timing/${key}`, 'Run timing must mirror the root boundary.');
      }
    }
    if (record.invocations.filter(i => i.parent.state === 'root').length !== 1) fail('root_count', '/invocations', 'An execution record has exactly one declared root.');
  }
  for (const d of record.definitions) {
    if (d.parentId) get('definition', d.parentId, `/definitions/${d.id}/parentId`);
    const edgeIDs = new Set();
    for (const e of d.edges || []) {
      if (edgeIDs.has(e.id)) fail('duplicate_edge', `/definitions/${d.id}/edges`, 'Edge IDs are unique within their container.');
      edgeIDs.add(e.id);
      get('definition', e.from, `/definitions/${d.id}/edges/${e.id}/from`);
      get('definition', e.to, `/definitions/${d.id}/edges/${e.id}/to`);
      if (e.mappings?.length && e.kind !== 'data') fail('mapping_kind', `/definitions/${d.id}/edges/${e.id}`, 'Field mappings belong to data edges.');
      for (const m of e.mappings || []) {
        if (![m.sourcePath, m.targetPath].every(p => p === '' || /^(?:\/(?:[^~/]|~[01])*)+$/.test(p))) {
          fail('field_pointer', `/definitions/${d.id}/edges/${e.id}/mappings`, 'Mapping paths use JSON Pointer; empty string means the whole value.');
        }
      }
    }
  }
  checkParentCycles(record.definitions, 'definition', d => d.parentId);
  for (const i of record.invocations) {
    const path = `/invocations/${i.id}`;
    if (i.definitionId) get('definition', i.definitionId, `${path}/definitionId`);
    if (i.parent.state === 'known') get('invocation', i.parent.invocationId, `${path}/parent/invocationId`);
    if (i.parent.state === 'unknown' && capture.state !== 'partial') fail('capture_gap', `${path}/parent`, 'Unknown parents require partial capture.');
    timing(i.timing, `${path}/timing`, i.status);
    for (const id of [...i.inputRefs, ...i.outputRefs]) contentRef(id, path);
    if (i.error?.contentRef) contentRef(i.error.contentRef, `${path}/error/contentRef`);
    if (i.status === 'failed' && !i.error && capture.state !== 'partial') fail('missing_error', path, 'A failed call without error evidence requires partial capture.');
    if (['succeeded', 'failed', 'cancelled'].includes(record.run.status) && ['running', 'unknown'].includes(i.status) && capture.state !== 'partial') {
      fail('unfinished_child', path, 'A terminal root with unresolved child execution requires partial capture.');
    }
    const names = new Set();
    for (const metric of i.metrics) {
      if (names.has(metric.name)) fail('duplicate_metric', `${path}/metrics`, `Duplicate metric: ${metric.name}`);
      names.add(metric.name);
    }
  }
  checkParentCycles(record.invocations, 'invocation', i => i.parent.state === 'known' ? i.parent.invocationId : undefined);
  let lastSequence = -1;
  for (const e of record.events) {
    const path = `/events/${e.id}`;
    if (e.sequence <= lastSequence) fail('event_sequence', `${path}/sequence`, 'Event sequence must be unique and increasing in this record; it is not causal order.');
    lastSequence = e.sequence;
    resolve(e.owner, `${path}/owner`);
    e.contentRefs.forEach(id => contentRef(id, `${path}/contentRefs`));
    e.targetDefinitionIds?.forEach(id => get('definition', id, `${path}/targetDefinitionIds`));
    const eventPayload = eventPayloads.get(e.type);
    if (eventPayload) {
      const schema = ajv.getSchema(`${runRecordSchema.$id}#/$defs/${eventPayload}`);
      if (!schema(e.attributes)) fail('event_payload', path, ajv.errorsText(schema.errors));
    }
  }
  const relationIDs = new Set();
  const endpoints = {
    repairs: [['invocation'], ['invocation']], responds_to: [['invocation', 'event'], ['event']],
    transfers_to: [['invocation'], ['invocation']], derived_from: [['content'], ['content']],
    reads: [['invocation'], ['content']], writes: [['invocation'], ['content']],
    caused_by: [['invocation', 'event', 'content'], ['invocation', 'event', 'content']],
    follows: [['invocation', 'event'], ['invocation', 'event']],
  };
  for (const r of record.relations) {
    const path = `/relations/${r.id}`;
    if (relationIDs.has(r.id)) fail('duplicate_id', path, 'Duplicate relation ID.');
    relationIDs.add(r.id);
    resolve(r.from, `${path}/from`, false); resolve(r.to, `${path}/to`, false);
    const [fromKinds, toKinds] = endpoints[r.type];
    if (!fromKinds.includes(r.from.kind) || !toKinds.includes(r.to.kind)) fail('relation_kind', path, `Invalid endpoints for ${r.type}.`);
    if (r.from.kind === r.to.kind && r.from.id === r.to.id) fail('self_relation', path, 'An observed relation cannot refer to itself.');
    if (r.evidenceEventId) get('event', r.evidenceEventId, `${path}/evidenceEventId`);
    if (r.type === 'responds_to') {
      const request = indexes.event.get(r.to.id);
      const response = indexes[r.from.kind]?.get(r.from.id);
      if (request && request.type !== 'tool.requested') fail('tool_request_relation', path, 'A tool response must point to a tool.requested event.');
      if (r.from.kind === 'invocation' && response && response.kind !== 'tool') fail('tool_response_kind', path, 'The responding invocation must be a tool call.');
      if (r.from.kind === 'event' && response) {
        const call = response.owner.kind === 'invocation' ? indexes.invocation.get(response.owner.id) : undefined;
        if (!call || call.kind !== 'tool') fail('tool_response_kind', path, 'A responding event must belong to the actual tool invocation.');
      }
    }
    if (r.type === 'transfers_to') {
      const from = indexes.invocation.get(r.from.id);
      const to = indexes.invocation.get(r.to.id);
      if ((from && from.kind !== 'agent') || (to && to.kind !== 'agent')) fail('transfer_kind', path, 'Actual handoffs connect agent invocations.');
      if (r.evidenceEventId) {
        const evidence = indexes.event.get(r.evidenceEventId);
        if (evidence && evidence.type !== 'agent.transfer-requested') fail('transfer_evidence', path, 'Handoff evidence must identify the transfer request.');
      }
    }
  }
  for (const c of record.contents) {
    const path = `/contents/${c.id}`;
    resolve(c.owner, `${path}/owner`);
    if (c.data.availability === 'missing' && c.completeness !== 'unknown') fail('missing_content', path, 'Missing content has unknown completeness.');
    if (c.transforms.some(t => t.kind === 'truncated') && c.completeness !== 'partial') fail('truncated_content', path, 'Truncated content has partial completeness.');
    if (c.schemaRef && c.data.availability === 'inline') {
      const schema = contentValidators.get(c.schemaRef);
      if (schema) {
        if (!schema(c.data.value)) fail('content_schema', path, ajv.errorsText(schema.errors));
      } else warn('unknown_content_schema', path, `Content schema is not registered: ${c.schemaRef}`);
      if (c.schemaRef === `${runRecordSchema.$id}#/$defs/Message` && schema?.(c.data.value)) {
        const message = c.data.value;
        for (const part of message.parts) if (part.kind === 'content') contentRef(part.contentRef, `${path}/data/value/parts`);
        for (const id of [...(message.toolRequestEventIds || []), ...(message.respondsToEventId ? [message.respondsToEventId] : [])]) {
          const event = get('event', id, `${path}/data/value`);
          if (event && event.type !== 'tool.requested') fail('message_request', path, 'Message tool references must identify tool.requested events.');
        }
        if (message.respondsToEventId && message.role !== 'tool') fail('message_role', path, 'Only a tool message responds to a tool request.');
        if (message.toolRequestEventIds?.length && message.role !== 'assistant') fail('message_role', path, 'Only an assistant message issues tool requests.');
      }
    }
  }
  const metered = new Set();
  for (const u of record.usage) {
    const path = `/usage/${u.id}`;
    const call = get('invocation', u.invocationId, `${path}/invocationId`);
    if (call && call.kind !== 'model') fail('usage_owner', path, 'Only an actual model invocation owns token usage; aggregates are derived.');
    if (metered.has(u.invocationId)) fail('duplicate_usage', path, 'Merge observations into one usage entry per model invocation.');
    metered.add(u.invocationId);
    const t = u.tokens;
    if (u.completeness === 'unknown' && Object.keys(t).length) fail('unknown_usage', path, 'Unknown usage contains no numeric claims; use partial when some counts are known.');
    if (u.completeness === 'complete' && (['input', 'output', 'total'].some(k => t[k] === undefined) || u.source === 'unknown')) fail('incomplete_usage', path, 'Complete usage requires input, output, total and a known source.');
    if (t.input !== undefined && t.output !== undefined && t.total !== undefined && t.total !== t.input + t.output) fail('token_total', path, 'Total is input + output; cache and reasoning are included subsets.');
    if (t.inputCached !== undefined && t.input !== undefined && t.inputCached > t.input) fail('token_subset', path, 'Cached input cannot exceed input.');
    if (t.outputReasoning !== undefined && t.output !== undefined && t.outputReasoning > t.output) fail('token_subset', path, 'Reasoning output cannot exceed output.');
  }
  if (capture.state === 'complete' && capture.coverage.includes('model')) {
    for (const i of record.invocations) if (i.kind === 'model' && !metered.has(i.id)) fail('usage_coverage', `/invocations/${i.id}`, 'Declared model coverage requires a usage entry, including explicitly unknown usage.');
  }
  for (const a of record.annotations) {
    const path = `/annotations/${a.id}`;
    resolve(a.owner, `${path}/owner`);
    const profile = profiles.get(`${a.type}@${a.schemaVersion}`);
    if (!profile) { warn('unknown_annotation', path, `Preserved unregistered annotation: ${a.type}@${a.schemaVersion}`); continue; }
    if (!profile(a.payload)) { fail('annotation_schema', path, ajv.errorsText(profile.errors)); continue; }
    validateCloudFocus(a, { record, indexes, get, contentRef, fail, warn }, path);
  }
  const sourceIDs = new Set();
  for (const s of record.sourceRecords || []) {
    if (sourceIDs.has(s.id)) fail('duplicate_id', `/sourceRecords/${s.id}`, 'Duplicate source record ID.');
    sourceIDs.add(s.id); resolve(s.owner, `/sourceRecords/${s.id}/owner`);
  }
  const results = new Set();
  const routes = new Set();
  const softStops = new Set();
  for (const a of record.annotations) {
    if (a.schemaVersion !== 1) continue;
    if (a.type === 'cloud-focus.result' && a.payload && typeof a.payload === 'object') {
      const key = JSON.stringify([a.payload.resultId, a.payload.version]);
      if (results.has(key)) fail('duplicate_result', `/annotations/${a.id}`, 'A result ID/version identifies a single immutable artifact.');
      results.add(key);
    }
    if (a.type === 'cloud-focus.route-decision') {
      if (routes.has(a.owner.id)) fail('duplicate_route', `/annotations/${a.id}`, 'One route decision annotation describes each selector event.');
      routes.add(a.owner.id);
    }
    if (a.type === 'cloud-focus.soft-stop') {
      if (softStops.has(a.owner.id)) fail('duplicate_soft_stop', `/annotations/${a.id}`, 'One invocation has one observed soft-stop reason.');
      softStops.add(a.owner.id);
    }
  }
  return { ok: !errors.length, errors, warnings };
}

function validateCloudFocus(a, context, path) {
  const { record, indexes, get, contentRef, fail, warn } = context;
  const p = a.payload;
  const type = a.type.slice('cloud-focus.'.length);
  const ownerCallId = a.owner.kind === 'invocation' ? a.owner.id
    : a.owner.kind === 'event' ? indexes.event.get(a.owner.id)?.owner.id : undefined;
  const isWithin = (callId, parentId) => {
    const seen = new Set();
    while (callId && !seen.has(callId)) {
      if (callId === parentId) return true;
      seen.add(callId);
      const call = indexes.invocation.get(callId);
      callId = call?.parent.state === 'known' ? call.parent.invocationId : undefined;
    }
    return false;
  };
  const owners = { 'route-decision': ['event'], 'soft-stop': ['invocation'], validation: ['invocation', 'event'],
    'dependency-warning': ['invocation', 'event'], 'evaluation-context': ['run', 'invocation'], result: ['run', 'invocation'] };
  if (!owners[type].includes(a.owner.kind)) fail('profile_owner', `${path}/owner`, `Invalid owner for ${a.type}.`);
  if (a.owner.kind === 'event') {
    const event = indexes.event.get(a.owner.id);
    if (event && event.owner.kind !== 'invocation') fail('profile_event_owner', path, 'Business events must identify the actual producing invocation.');
  }
  for (const [key, value] of Object.entries(p)) {
    if (key.endsWith('ContentRef') && value !== undefined) contentRef(value, `${path}/payload/${key}`);
  }
  if (type === 'route-decision') {
    p.selectedDefinitionIds.forEach(id => get('definition', id, `${path}/payload/selectedDefinitionIds`));
    const event = indexes.event.get(a.owner.id);
    if (event && JSON.stringify([...(event.targetDefinitionIds || [])].sort()) !== JSON.stringify([...p.selectedDefinitionIds].sort())) fail('route_targets', path, 'Route annotation and event must agree on selected definition IDs.');
  }
  if (type === 'soft-stop') {
    get('invocation', p.originInvocationId, `${path}/payload/originInvocationId`);
    if (p.inherited === (a.owner.id === p.originInvocationId)) fail('soft_stop_origin', path, 'Inherited soft stops must reference another invocation; the origin references itself.');
    if (p.inherited) {
      const origin = record.annotations.find(x => x.type === a.type && x.schemaVersion === 1 && x.owner.kind === 'invocation' && x.owner.id === p.originInvocationId && x.payload?.inherited === false);
      if (!origin || origin.payload.reasonCode !== p.reasonCode) fail('soft_stop_reason', path, 'Inherited soft stop must preserve an observed origin annotation and its first reason.');
    }
  }
  if (p.modelInvocationId) {
    const call = get('invocation', p.modelInvocationId, `${path}/payload/modelInvocationId`);
    if (call && call.kind !== 'model') fail('profile_model', path, 'modelInvocationId must refer to a model invocation.');
    if (call && type === 'validation') {
      if (ownerCallId && !isWithin(call.id, ownerCallId)) {
        if (record.run.capture.state === 'complete') fail('validation_scope', path, 'The model request must belong to the business validation scope.');
        else warn('validation_scope_unknown', path, 'Cannot verify validation scope from partial parent observations.');
      }
      if (p.subjectContentRef) {
        const pending = [p.subjectContentRef]; const seen = new Set(); let connected = false;
        while (pending.length) {
          const id = pending.pop();
          if (seen.has(id)) continue;
          seen.add(id);
          if (call.outputRefs.includes(id)) { connected = true; break; }
          for (const r of record.relations) if (r.type === 'derived_from' && r.from.kind === 'content' && r.from.id === id && r.to.kind === 'content') pending.push(r.to.id);
        }
        if (!connected) fail('validation_subject', path, 'Validated content must be an output of the declared model request or explicitly derived from it.');
      }
    }
  }
  for (const key of ['causeInvocationId']) if (p[key]) get('invocation', p[key], `${path}/payload/${key}`);
  if (p.repair?.attemptIndex !== undefined && p.repair?.attemptCount !== undefined && p.repair.attemptIndex > p.repair.attemptCount) fail('repair_count', path, 'Repair attempt index cannot exceed observed attempt count.');
  if (p.repair && ['attempted', 'exhausted'].includes(p.repair.status)) {
    const repairs = record.relations.filter(r => r.type === 'repairs' && r.from.kind === 'invocation' && r.to.kind === 'invocation'
      && indexes.invocation.get(r.from.id)?.kind === 'model' && indexes.invocation.get(r.to.id)?.kind === 'model');
    const ownerCall = indexes.invocation.get(ownerCallId);
    const repairScopeId = ownerCall?.kind === 'model' && ownerCall.parent.state === 'known' ? ownerCall.parent.invocationId : ownerCallId;
    const observed = new Set(repairs.filter(r => repairScopeId && isWithin(r.from.id, repairScopeId)).map(r => r.from.id));
    const complete = record.run.capture.state === 'complete' && record.run.capture.coverage.includes('model');
    if (!p.modelInvocationId || !repairs.some(r => r.from.id === p.modelInvocationId)) {
      (complete ? fail : warn)('repair_evidence', path, 'Observed repair attempts need the actual model invocation and an explicit repairs relation.');
    }
    if (p.repair.attemptCount !== undefined && p.repair.attemptCount > observed.size) {
      (complete ? fail : warn)('repair_count_evidence', path, 'Repair count exceeds the distinct repair requests observed in this scope.');
    }
  }
  const typedContent = (id, definition, field) => {
    const content = contentRef(id, `${path}/payload/${field}`);
    const expected = `${cloudFocusSchema.$id}#/$defs/${definition}`;
    if (!content) return;
    if (content.schemaRef !== expected) fail('profile_content_type', `${path}/payload/${field}`, `Expected content schemaRef ${expected}.`);
    if (content.data.availability !== 'inline' || content.completeness !== 'complete') warn('content_not_fully_verified', `${path}/payload/${field}`, 'Only available inline content is value-checked; unavailable, external or partial content is not a complete artifact validation.');
    return content;
  };
  if (type === 'evaluation-context') {
    if (p.routeDecisionEventId) {
      get('event', p.routeDecisionEventId, `${path}/payload/routeDecisionEventId`);
      const route = record.annotations.find(x => x.type === 'cloud-focus.route-decision' && x.schemaVersion === 1 && x.owner.kind === 'event' && x.owner.id === p.routeDecisionEventId);
      if (!route) fail('evaluation_route', path, 'Evaluation route event needs a registered route decision annotation.');
      else if (p.intent !== undefined && route.payload?.effectiveIntent !== undefined && p.intent !== route.payload.effectiveIntent) fail('evaluation_intent', path, 'Evaluation intent must agree with the observed route decision.');
    }
    if (p.resultAnnotationId) {
      const result = get('annotation', p.resultAnnotationId, `${path}/payload/resultAnnotationId`);
      if (result && (result.type !== 'cloud-focus.result' || result.schemaVersion !== 1)) fail('evaluation_result', path, 'Evaluation must reference a cloud-focus.result@1 annotation.');
    }
    for (const [field, definition] of Object.entries({ workItemsContentRef: 'work-items', documentsContentRef: 'documents', userProfileContentRef: 'user-profile', timeContextContentRef: 'time-context' })) {
      if (p[field]) typedContent(p[field], definition, field);
    }
    p.additionalContentRefs?.forEach(id => contentRef(id, `${path}/payload/additionalContentRefs`));
  }
  if (type === 'result') {
    const content = typedContent(p.contentRef, 'result-content', 'contentRef');
    if (content?.data.availability === 'inline' && Array.isArray(content.data.value?.items)) {
      const ids = content.data.value.items.map(x => x?.itemId);
      if (new Set(ids).size !== ids.length) fail('duplicate_item', path, 'Result content item IDs must be unique.');
      if (p.itemIds && content.completeness === 'complete' && JSON.stringify(ids) !== JSON.stringify(p.itemIds)) fail('result_items', path, 'Complete result content must match the declared item IDs in order.');
      if (p.itemIds && ids.some(id => !p.itemIds.includes(id))) fail('unknown_result_item', path, 'Content contains an item outside the declared result.');
      if (p.itemIds && ids.some((id, i) => i > 0 && p.itemIds.indexOf(id) <= p.itemIds.indexOf(ids[i - 1]))) fail('result_order', path, 'Partial content must preserve the relative order of declared item IDs.');
    }
  }
}

export function parseRunRecordV2(text) {
  const record = parseRecordJSON(text);
  const result = validateRunRecordV2(record);
  if (!result.ok) throw new TypeError(result.errors.slice(0, 5).map(e => `${e.code} ${e.path}: ${e.message}`).join('\n'));
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = process.argv.slice(2);
  if (!paths.length) { console.error('Usage: node protocol/v2/validate.js <record.json> [...]'); process.exitCode = 2; }
  for (const path of paths) {
    try {
      const record = parseRunRecordV2(readFileSync(path, 'utf8'));
      const { warnings } = validateRunRecordV2(record);
      console.log(`${path}: valid${warnings.length ? ` (${warnings.length} warning(s))` : ''}`);
    } catch (error) { console.error(`${path}: ${error.message}`); process.exitCode = 1; }
  }
}
