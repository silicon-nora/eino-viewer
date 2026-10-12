// Deterministic synthetic examples; never calls Eino, cloud-focus, or a model.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const directory = fileURLToPath(new URL('.', import.meta.url));
const epoch = 1791792000000;
const syntheticSystemPrompt = 'Synthetic schema-constrained generation.';
writeFileSync(`${directory}reference-system-prompt.txt`, syntheticSystemPrompt);
const ref = (kind, id) => ({ kind, id });
const iv = id => ref('invocation', id);
const ct = id => ref('content', id);
const time = (start, end) => ({ startedAtMs: epoch + start, endedAtMs: epoch + end, durationMs: end - start, basis: 'observed' });

function record(slug, source = 'application', status = 'succeeded', mode = 'execution') {
  return {
    schemaVersion: 2,
    run: {
      id: `run:${slug}`, mode, scope: source === 'application' ? 'recommend.Generate' : `fixture.${source}`,
      source, ...(mode === 'execution' ? { rootInvocationId: 'i:root' } : {}), status,
      timing: mode === 'execution' ? time(0, 1000) : { basis: 'unknown' }, sealedAtMs: epoch + 1010,
      producer: { name: 'synthetic-contract-fixtures', version: '2.0.0-candidate' },
      capture: { state: 'complete', coverage: mode === 'definition' ? ['definitions'] : ['definitions', 'invocations', 'events'], issues: [] },
      labels: { synthetic: 'true', origin: 'hand-authored-not-production-capture', scenario: slug },
    },
    definitions: [], invocations: [], events: [], relations: [], contents: [], usage: [], annotations: [],
  };
}
function definition(r, id, kind, name, parentId, extra = {}) {
  const d = { id, kind, name, ...(parentId ? { parentId } : {}), ...extra };
  r.definitions.push(d);
  return d;
}
function invocation(r, id, kind, name, parentId, start, end, extra = {}) {
  const i = {
    id, kind, name, parent: parentId ? { state: 'known', invocationId: parentId } : { state: 'root' },
    status: 'succeeded', timing: time(start, end), inputRefs: [], outputRefs: [], metrics: [], ...extra,
  };
  r.invocations.push(i);
  return i;
}
function content(r, id, owner, role, value, extra = {}) {
  const c = {
    id, owner: typeof owner === 'string' ? iv(owner) : owner, role, mediaType: 'application/json',
    provenance: 'observed', completeness: 'complete', transforms: [], data: { availability: 'inline', value }, ...extra,
  };
  r.contents.push(c);
  return c;
}
function annotation(r, id, owner, type, payload) {
  r.annotations.push({ id, owner: typeof owner === 'string' ? iv(owner) : owner, type, schemaVersion: 1, payload });
}
function event(r, id, type, owner, at, extra = {}) {
  r.events.push({ id, sequence: 0, type, owner: typeof owner === 'string' ? iv(owner) : owner, atMs: epoch + at, contentRefs: [], ...extra });
  return id;
}
function relation(r, type, from, to, evidenceEventId) {
  r.relations.push({ id: `rel:${r.relations.length + 1}`, type, from, to, ...(evidenceEventId ? { evidenceEventId } : {}) });
}
function metric(i, name, value, unit) { i.metrics.push({ name, value, ...(unit ? { unit } : {}) }); }
function lookup(r, id) { return r.invocations.find(i => i.id === id); }
function partial(r, code, message, owner) {
  r.run.capture.state = 'partial';
  r.run.capture.issues.push({ code, message, ...(owner ? { owner } : {}) });
}
function finish(r) {
  for (const i of r.invocations) {
    event(r, `ev:start:${i.id}`, 'invocation.started', i.id, i.timing.startedAtMs - epoch);
    if (i.timing.endedAtMs !== undefined) event(r, `ev:end:${i.id}`, `invocation.${i.status}`, i.id, i.timing.endedAtMs - epoch);
  }
  r.events.sort((a, b) => a.atMs - b.atMs);
  r.events.forEach((e, n) => { e.sequence = n + 1; });
  writeFileSync(`${directory}${r.run.labels.scenario}.json`, `${JSON.stringify(r, null, 2)}\n`);
}

const gate = ['discover_events', 'resolve_files', 'report_files', 'behavior_heatmap', 'intent_router'];
const preparation = ['rank_docs', 'prepare_token', 'load_summary', 'load_topn_docs_content', 'file_behavior_context', 'user_profile', 'prepare_llm_input', 'llm_work_items', 'work_item_behavior'];
const recommendation = ['prepare_card_input', 'llm_card', 'card_format_repair', 'enrich'];
function semantic(key) { return key.includes('llm') && !key.includes('prepare') || key.endsWith('card_format_repair') ? 'llm' : /discover|resolve|load_|token|user_profile|write_/.test(key) ? 'io' : 'cpu'; }
function topology(r) {
  const root = definition(r, 'd:workflow', 'workflow', 'weekly_report', undefined, { component: 'Workflow', semanticKind: 'graph', revision: 'synthetic/2026.10.12.1', edges: [] });
  const groups = {
    week_report_work_items: preparation.map(n => `week_report_${n}`),
    week_report_recommend: recommendation.map(n => `week_report_${n}`),
    work_guidance: [...preparation, ...recommendation].map(n => `work_guidance_${n}`),
  };
  const containers = { root };
  for (const name of gate) definition(r, `d:${name}`, 'node', name, root.id, { key: name, path: [name], component: 'Lambda', semanticKind: semantic(name) });
  for (const [name, children] of Object.entries(groups)) {
    const container = definition(r, `d:${name}`, 'workflow', name, root.id, { key: name, path: [name], component: 'Workflow', semanticKind: 'graph', edges: [] });
    containers[name] = container;
    for (const child of children) definition(r, `d:${child}`, 'node', child, container.id, { key: child, path: [name, child], component: 'Lambda', semanticKind: semantic(child) });
  }
  definition(r, 'd:week_report_write_cycle_portrait', 'node', 'week_report_write_cycle_portrait', root.id, { component: 'Lambda', semanticKind: 'io' });
  for (const [name, container] of Object.entries(containers)) {
    definition(r, `d:${name}:START`, 'boundary', 'START', container.id);
    definition(r, `d:${name}:END`, 'boundary', 'END', container.id);
  }
  const edge = (container, from, to, kind, extra = {}) => container.edges.push({ id: `edge:${container.id}:${container.edges.length + 1}`, from: `d:${from}`, to: `d:${to}`, kind, ...extra });
  let prev = 'root:START';
  for (const name of gate) { edge(root, prev, name, 'dependency'); edge(root, prev, name, 'data', { mappings: [{ sourcePath: '', targetPath: '' }] }); prev = name; }
  for (const [branch, target] of [['week_report', 'week_report_work_items'], ['work_guidance', 'work_guidance']]) {
    edge(root, 'intent_router', target, 'candidate', { branchKey: branch });
    edge(root, 'intent_router', target, 'data', { mappings: [{ sourcePath: '', targetPath: '' }] });
  }
  for (const child of ['week_report_recommend', 'week_report_write_cycle_portrait']) { edge(root, 'week_report_work_items', child, 'dependency'); edge(root, 'week_report_work_items', child, 'data'); }
  for (const child of ['week_report_recommend', 'week_report_write_cycle_portrait', 'work_guidance']) edge(root, child, 'root:END', 'dependency');
  edge(root, 'week_report_recommend', 'root:END', 'data', { mappings: [{ sourcePath: '', targetPath: '/week_report' }] });
  edge(root, 'work_guidance', 'root:END', 'data', { mappings: [{ sourcePath: '', targetPath: '/work_guidance' }] });
  for (const arm of ['week_report', 'work_guidance']) {
    const group = arm === 'week_report' ? 'week_report_work_items' : 'work_guidance';
    const c = containers[group];
    const link = (a, b, kind = 'dependency', extra = {}) => edge(c, a.startsWith(`${group}:`) ? a : `${arm}_${a}`, b.startsWith(`${group}:`) ? b : `${arm}_${b}`, kind, extra);
    link(`${group}:START`, 'rank_docs'); link('rank_docs', 'prepare_token');
    for (const child of ['load_summary', 'load_topn_docs_content', 'file_behavior_context', 'user_profile']) link('prepare_token', child);
    link('load_summary', 'prepare_llm_input', 'data', { mappings: [{ sourcePath: '', targetPath: arm === 'week_report' ? '/Summary' : '' }] });
    link('load_summary', 'prepare_llm_input');
    for (const child of ['file_behavior_context', 'user_profile']) link(child, 'prepare_llm_input');
    if (arm === 'week_report') { link('load_topn_docs_content', 'prepare_llm_input'); link('load_topn_docs_content', 'prepare_llm_input', 'data', { mappings: [{ sourcePath: '', targetPath: '/Content' }] }); }
    link('prepare_llm_input', 'llm_work_items'); link('llm_work_items', 'work_item_behavior');
    if (arm === 'week_report') link('work_item_behavior', `${group}:END`);
    else {
      for (const [from, target] of [['work_item_behavior', 'WorkItems'], ['load_topn_docs_content', 'Content']]) { link(from, 'prepare_card_input'); link(from, 'prepare_card_input', 'data', { mappings: [{ sourcePath: '', targetPath: `/${target}` }] }); }
      for (let n = 1; n < recommendation.length; n++) link(recommendation[n - 1], recommendation[n]);
      link('enrich', `${group}:END`);
    }
  }
  const c = containers.week_report_recommend;
  const chain = ['week_report_recommend:START', ...recommendation.map(n => `week_report_${n}`), 'week_report_recommend:END'];
  for (let n = 1; n < chain.length; n++) edge(c, chain[n - 1], chain[n], 'dependency');
  edge(c, 'week_report_llm_card', 'week_report_card_format_repair', 'data', { mappings: ['SkipInfo', 'Candidates', 'NeedsFormatRepair', 'ParseError', 'LLMRawOutput'].map(name => ({ sourcePath: `/${name}`, targetPath: `/${name}` })) });
}
function cloudBase(slug, arm = 'week_report', variant = 'normal') {
  const r = record(slug);
  r.run.correlation = { taskId: `synthetic-task:${slug}`, uid: 'synthetic-user', scene: 'weekly_report' };
  r.run.capture.coverage.push('model', 'state', 'business');
  const root = invocation(r, 'i:root', 'application', 'recommend.Generate', null, 0, 1000);
  invocation(r, 'i:workflow', 'workflow', 'weekly_report', root.id, 10, 990, { definitionId: 'd:workflow' });
  topology(r);
  content(r, 'c:request', root.id, 'input', { scene: 'weekly_report', count: 2, forceIntent: arm, nowUnix: 1791792000, userId: 'synthetic-user' });
  root.inputRefs.push('c:request');
  gate.forEach((name, n) => invocation(r, `i:${name}`, 'node', name, 'i:workflow', [20, 45, 75, 95, 125][n], [40, 70, 90, 120, 140][n], { definitionId: `d:${name}` }));
  gate.slice(1).forEach((name, n) => relation(r, 'caused_by', iv(`i:${name}`), iv(`i:${gate[n]}`)));
  const decisionEvent = event(r, 'ev:route', 'route.selected', 'i:intent_router', 138, { targetDefinitionIds: [`d:${arm === 'week_report' ? 'week_report_work_items' : 'work_guidance'}`], attributes: { requestedIntent: arm, effectiveIntent: arm, reason: 'force_intent' } });
  metric(lookup(r, 'i:intent_router'), 'intent', arm);
  metric(lookup(r, 'i:intent_router'), 'reason', 'force_intent');
  content(r, 'c:heatmap', 'i:behavior_heatmap', 'diagnostic', { scores: Array.from({ length: 168 }, (_, n) => n === 112 ? 0.75 : 0), k: 1, t: 0.5, now_unix: epoch / 1000 }, { provenance: 'projected' });
  lookup(r, 'i:behavior_heatmap').outputRefs.push('c:heatmap');
  r._profile = { arm, variant, decisionEvent };
  return r;
}
function model(r, parent, suffix, start, end, response, tokens = { input: 120, output: 40, total: 160, inputCached: 20, outputReasoning: 10 }) {
  const id = `i:model:${suffix}`;
  const i = invocation(r, id, 'model', 'synthetic-model', parent, start, end);
  content(r, `c:model:${suffix}:request`, id, 'model-request', { provider: 'synthetic-provider', model: 'synthetic-model-v1', parameters: { jsonObject: true, thinking: false }, messages: [{ role: 'system', content: 'Synthetic schema-constrained generation.' }, { role: 'user', content: `Use synthetic material for ${suffix}.` }] });
  content(r, `c:model:${suffix}:response`, id, 'model-response', response, { mediaType: 'text/plain' });
  i.inputRefs.push(`c:model:${suffix}:request`); i.outputRefs.push(`c:model:${suffix}:response`);
  r.usage.push({ id: `u:${suffix}`, invocationId: id, provider: 'synthetic-provider', model: 'synthetic-model-v1', requestId: `synthetic-request:${suffix}`, source: 'provider', completeness: 'complete', tokens });
  return i;
}
function state(r, key, writer, at, value, readers) {
  const id = `c:state:${key}`;
  content(r, id, writer, 'state', { key, version: 1, value }, { provenance: 'projected' });
  const evidence = event(r, `ev:state:${key}`, 'state.written', writer, at, { contentRefs: [id] });
  relation(r, 'writes', iv(writer), ct(id), evidence);
  for (const reader of readers) { lookup(r, reader).inputRefs.push(id); relation(r, 'reads', iv(reader), ct(id)); }
}
function cloud(slug, arm, variant = 'normal') {
  const r = cloudBase(slug, arm, variant);
  const week = arm === 'week_report';
  const workParent = week ? 'i:week_report_work_items' : 'i:work_guidance';
  const cardParent = week ? 'i:week_report_recommend' : workParent;
  invocation(r, workParent, 'workflow', week ? 'week_report_work_items' : 'work_guidance', 'i:workflow', 150, week ? 510 : 900, { definitionId: workParent.replace('i:', 'd:') });
  relation(r, 'caused_by', iv(workParent), iv('i:intent_router'), 'ev:route');
  if (week) {
    invocation(r, cardParent, 'workflow', 'week_report_recommend', 'i:workflow', 520, 900, { definitionId: 'd:week_report_recommend' });
    invocation(r, 'i:week_report_write_cycle_portrait', 'node', 'week_report_write_cycle_portrait', 'i:workflow', 520, 620, { definitionId: 'd:week_report_write_cycle_portrait' });
    relation(r, 'caused_by', iv(cardParent), iv(workParent));
    relation(r, 'caused_by', iv('i:week_report_write_cycle_portrait'), iv(workParent));
  }
  const bounds = {
    rank_docs: [155, 180], prepare_token: [185, 205], load_summary: [210, 265], load_topn_docs_content: [210, week ? 290 : 500],
    file_behavior_context: [210, 240], user_profile: [210, 260], prepare_llm_input: week ? [300, 320] : [270, 290],
    llm_work_items: week ? [325, 480] : [295, 470], work_item_behavior: week ? [485, 505] : [475, 490],
    prepare_card_input: [525, 555], llm_card: [560, 760], card_format_repair: [765, 850], enrich: [855, 890],
  };
  for (const name of [...preparation, ...recommendation]) {
    const id = `i:${arm}_${name}`;
    invocation(r, id, 'node', `${arm}_${name}`, recommendation.includes(name) ? cardParent : workParent, ...bounds[name], { definitionId: id.replace('i:', 'd:') });
  }
  const ni = name => `i:${arm}_${name}`;
  const stopped = variant === 'soft-stop' || variant === 'parse-soft-stop';
  for (const name of ['load_summary', 'load_topn_docs_content', 'file_behavior_context', 'user_profile']) relation(r, 'caused_by', iv(ni(name)), iv(ni('prepare_token')));
  for (const name of ['load_summary', 'file_behavior_context', 'user_profile', ...(week ? ['load_topn_docs_content'] : [])]) relation(r, 'caused_by', iv(ni('prepare_llm_input')), iv(ni(name)));
  if (!week) for (const name of ['work_item_behavior', 'load_topn_docs_content']) relation(r, 'caused_by', iv(ni('prepare_card_input')), iv(ni(name)));
  const candidateDocs = [{ fileId: 'synthetic-file-1', title: '示例迭代方案', permission: variant === 'soft-stop' ? 'readonly' : 'owner' }, { fileId: 'synthetic-file-2', title: '示例质量清单', permission: variant === 'soft-stop' ? 'readonly' : 'editor' }];
  content(r, 'c:materials', ni('load_summary'), 'evaluation-context', candidateDocs.map(d => ({ file_id: d.fileId, title: d.title, permission: d.permission, summary: '完全虚构的测试材料。' })), { provenance: 'projected', schemaRef: 'urn:eino:cloud-focus:1#/$defs/documents' });
  state(r, 'document-facts', ni('rank_docs'), 180, { topFileIds: candidateDocs.map(d => d.fileId), documents: [...candidateDocs, { fileId: 'synthetic-report-file', title: '示例周报', permission: 'owner' }] }, ['load_summary', 'load_topn_docs_content', 'prepare_llm_input', ...(!stopped ? ['prepare_card_input'] : [])].map(ni));
  state(r, 'report-documents', 'i:report_files', 90, { byFileId: { 'synthetic-report-file': { titleMatched: true, tagMatched: false } } }, [ni('load_summary')]);
  const contextualReaders = variant === 'soft-stop' ? [] : [ni('prepare_llm_input'), ...(!stopped ? [ni('llm_card')] : [])];
  state(r, 'prompt-context', ni('file_behavior_context'), 240, { nowUnix: 1791792000, currentTime: '2026-10-12T16:00:00+08:00', timezone: 'Asia/Shanghai', fileBehavior: [] }, contextualReaders);
  state(r, 'user-profile', ni('user_profile'), 260, { user_id: 'synthetic-user', ...(variant !== 'dependency-degraded' ? { company_role: 'synthetic-project-owner' } : {}) }, contextualReaders);
  if (variant !== 'soft-stop') model(r, ni('llm_work_items'), 'work-items', week ? 330 : 300, week ? 470 : 460, variant === 'parse-soft-stop' ? 'synthetic malformed JSON {' : JSON.stringify({ work_items: candidateDocs.map((d, n) => ({ title: `示例事项${n + 1}`, summary: '虚构事项摘要', primary_file_ids: [d.fileId], supporting_file_ids: [] })) }));
  if (stopped) {
    const origin = variant === 'soft-stop' ? ni('prepare_llm_input') : ni('llm_work_items');
    const reason = variant === 'soft-stop' ? 'no_primary_candidate' : 'no_work_items';
    const startIndex = variant === 'soft-stop' ? 6 : 7;
    for (const name of [...preparation, ...recommendation].slice(startIndex)) {
      metric(lookup(r, ni(name)), 'skip', true); metric(lookup(r, ni(name)), 'skip_reason', reason);
      r._profile.softStops ??= [];
      r._profile.softStops.push({ owner: ni(name), origin, reason, inherited: ni(name) !== origin });
    }
    for (const owner of week ? [workParent, cardParent, 'i:week_report_write_cycle_portrait'] : [workParent]) {
      metric(lookup(r, owner), 'skip', true); metric(lookup(r, owner), 'skip_reason', reason);
      r._profile.softStops.push({ owner, origin, reason, inherited: true });
    }
    if (variant === 'parse-soft-stop') {
      metric(lookup(r, ni('llm_work_items')), 'parse_status', 'format_error');
      event(r, 'ev:work-items-validation', 'validation.failed', ni('llm_work_items'), 471, { contentRefs: ['c:model:work-items:response'], attributes: { stage: 'work-items-parse', outcome: 'format_error' } });
    }
  } else {
    const raw = variant === 'card-repair' ? '{"cards":' : JSON.stringify({ cards: candidateDocs.map((d, n) => ({ title: `示例卡片${n + 1}`, prompt: '请整理完全虚构的测试材料。', related_file_ids: [d.fileId] })) });
    model(r, ni('llm_card'), 'card', 565, 750, raw, { input: 240, output: 60, total: 300, inputCached: 40, outputReasoning: 12 });
    if (variant === 'card-repair') {
      metric(lookup(r, ni('llm_card')), 'needs_format_repair', true);
      const validation = event(r, 'ev:card-validation', 'validation.failed', ni('llm_card'), 755, { contentRefs: ['c:model:card:response'], attributes: { stage: 'card-parse', reason: 'synthetic invalid JSON' } });
      model(r, ni('card_format_repair'), 'repair', 770, 840, JSON.stringify({ cards: [{ title: '修复后的示例卡片', prompt: '请整理完全虚构的测试材料。', related_file_ids: ['synthetic-file-1'] }] }), { input: 80, output: 30, total: 110, inputCached: 0, outputReasoning: 5 });
      r.contents.find(c => c.id === 'c:model:repair:request').data.value.messages[1].content = 'Repair the synthetic invalid card JSON: {"cards":';
      lookup(r, 'i:model:repair').inputRefs.push('c:model:card:response');
      relation(r, 'repairs', iv('i:model:repair'), iv('i:model:card'), validation);
      relation(r, 'derived_from', ct('c:model:repair:response'), ct('c:model:card:response'));
      event(r, 'ev:repair-validation', 'validation.succeeded', ni('card_format_repair'), 845, { contentRefs: ['c:model:repair:response'] });
    }
  }
  metric(lookup(r, ni('card_format_repair')), 'format_repair_count', variant === 'card-repair' ? 1 : 0, 'call');
  if (week) metric(lookup(r, 'i:week_report_write_cycle_portrait'), 'cycle_portrait_write_status', stopped ? 'skipped' : 'ok');
  if (variant === 'dependency-degraded') {
    metric(lookup(r, ni('user_profile')), 'fetch_status', 'error');
    content(r, 'c:profile-warning', ni('user_profile'), 'diagnostic', { dependency: 'UserProfileFetcher', code: 'synthetic_backend_unavailable', recovery: 'continue_without_profile' }, { provenance: 'projected' });
    event(r, 'ev:profile-warning', 'dependency.warning', ni('user_profile'), 258, { contentRefs: ['c:profile-warning'] });
    content(r, 'c:unavailable-document-body', ni('load_topn_docs_content'), 'output', undefined, { completeness: 'unknown', data: { availability: 'missing', reason: 'Synthetic capture policy omitted document text; the application did read it.' } });
    content(r, 'c:partial-diagnostic', ni('load_topn_docs_content'), 'diagnostic', 'Synthetic preview...', { mediaType: 'text/plain', completeness: 'partial', transforms: [{ kind: 'truncated', reason: 'Synthetic export budget', originalByteLength: 120 }] });
    lookup(r, ni('load_topn_docs_content')).outputRefs.push('c:unavailable-document-body', 'c:partial-diagnostic');
    partial(r, 'content.omitted', 'Application outcome is successful; selected captured contents are unavailable or truncated.', ct('c:unavailable-document-body'));
  }
  if (variant === 'normal' && week) {
    content(r, 'c:reference-system-prompt', 'i:model:card', 'other', undefined, {
      mediaType: 'text/plain', data: { availability: 'reference', key: 'reference-system-prompt.txt', sha256: createHash('sha256').update(syntheticSystemPrompt).digest('hex'), byteLength: Buffer.byteLength(syntheticSystemPrompt) },
    });
    lookup(r, 'i:model:card').inputRefs.push('c:reference-system-prompt');
    content(r, 'c:masked-prompt-diagnostic', ni('llm_card'), 'diagnostic', 'Synthetic input; document body: [redacted]', {
      mediaType: 'text/plain', provenance: 'reconstructed', transforms: [{ kind: 'redacted', reason: 'Synthetic diagnostic projection omits document bodies.' }],
    });
  }
  r._profile.itemCount = stopped ? 0 : variant === 'card-repair' ? 1 : 2;
  r._profile.resultOwner = ni('enrich');
  return r;
}

function emptyWorkflow() {
  const r = cloudBase('cloud-focus-workflow-failed-success-empty');
  // Router and later nodes never ran: remove their invocations and decisions.
  r.invocations = r.invocations.filter(i => ['i:root', 'i:workflow', 'i:discover_events', 'i:resolve_files'].includes(i.id));
  r.contents = r.contents.filter(c => c.id !== 'c:heatmap');
  r.events = []; r.relations = r.relations.filter(rel => rel.from.id === 'i:resolve_files');
  const error = { code: 'ErrNoDocuments', message: 'All synthetic documents were filtered.' };
  Object.assign(lookup(r, 'i:resolve_files'), { status: 'failed', error });
  Object.assign(lookup(r, 'i:workflow'), { status: 'failed', error, timing: time(10, 80) });
  metric(lookup(r, 'i:resolve_files'), 'candidate_count', 2, 'document');
  metric(lookup(r, 'i:resolve_files'), 'oversized_filtered', 2, 'document');
  content(r, 'c:filter-diag', 'i:resolve_files', 'diagnostic', { filtered_docs: [{ file_id: 'synthetic-file-1', reason: 'oversized' }, { file_id: 'synthetic-file-2', reason: 'oversized' }] }, { provenance: 'projected' });
  lookup(r, 'i:resolve_files').outputRefs.push('c:filter-diag');
  event(r, 'ev:empty-convergence', 'business.empty-result', 'i:root', 90, { attributes: { reason: 'no_documents', causeInvocationId: 'i:resolve_files' } });
  r._profile = { arm: 'unknown', variant: 'empty-convergence', itemCount: 0, resultOwner: 'i:root' };
  r.run.capture.coverage = ['definitions', 'invocations', 'events', 'business'];
  return r;
}
function compilationFailure() {
  const r = record('cloud-focus-compile-failure', 'application', 'failed');
  invocation(r, 'i:root', 'application', 'recommend.Generate', null, 0, 1000, { status: 'failed', error: { code: 'compile_failed', message: 'Synthetic graph compile failure before Workflow.Invoke.' } });
  event(r, 'ev:compile', 'definition.compilation-failed', 'i:root', 500, { attributes: { stage: 'BuildWorkflow' } });
  r.run.capture.coverage = ['invocations', 'events'];
  return r;
}
function loopGraph() {
  const r = record('graph-loop-repeated-definition', 'graph');
  const d = definition(r, 'd:graph', 'graph', 'bounded-loop', undefined, { edges: [
    { id: 'edge:step-check', from: 'd:step', to: 'd:check', kind: 'dependency' },
    { id: 'edge:repeat', from: 'd:check', to: 'd:step', kind: 'candidate', branchKey: 'again' },
    { id: 'edge:done', from: 'd:check', to: 'd:end', kind: 'candidate', branchKey: 'done' },
  ] });
  definition(r, 'd:step', 'node', 'transform', d.id); definition(r, 'd:check', 'node', 'check', d.id); definition(r, 'd:end', 'boundary', 'END', d.id);
  invocation(r, 'i:root', 'graph', 'bounded-loop', null, 0, 1000, { definitionId: d.id });
  content(r, 'c:previous-result', 'i:root', 'input', null);
  lookup(r, 'i:root').inputRefs.push('c:previous-result');
  r.run.capture.coverage.push('state');
  for (let n = 1; n <= 3; n++) {
    invocation(r, `i:step:${n}`, 'node', 'transform', 'i:root', n * 200 - 100, n * 200, { definitionId: 'd:step', iteration: n });
    invocation(r, `i:check:${n}`, 'node', 'check', 'i:root', n * 200 + 5, n * 200 + 20, { definitionId: 'd:check', iteration: n });
    relation(r, 'caused_by', iv(`i:check:${n}`), iv(`i:step:${n}`));
    if (n > 1) relation(r, 'caused_by', iv(`i:step:${n}`), iv(`i:check:${n - 1}`), `ev:decision:${n - 1}`);
    event(r, `ev:decision:${n}`, 'route.selected', `i:check:${n}`, n * 200 + 15, { targetDefinitionIds: [n < 3 ? 'd:step' : 'd:end'], attributes: { decision: n < 3 ? 'again' : 'done' } });
    content(r, `c:counter:${n}`, `i:step:${n}`, 'state', { key: 'counter', version: n, value: n });
    relation(r, 'writes', iv(`i:step:${n}`), ct(`c:counter:${n}`));
    relation(r, 'reads', iv(`i:check:${n}`), ct(`c:counter:${n}`));
    if (n > 1) relation(r, 'reads', iv(`i:step:${n}`), ct(`c:counter:${n - 1}`));
  }
  content(r, 'c:graph-final', 'i:root', 'result', { counter: 3 });
  lookup(r, 'i:root').outputRefs.push('c:graph-final');
  relation(r, 'derived_from', ct('c:graph-final'), ct('c:counter:3'));
  return r;
}
function interruptedAgent() {
  const r = record('agent-parallel-interrupted', 'agent', 'interrupted');
  definition(r, 'd:agent', 'agent', 'coordinator');
  invocation(r, 'i:root', 'agent', 'coordinator', null, 0, 1000, { definitionId: 'd:agent', status: 'interrupted', error: { code: 'interrupted', message: 'Synthetic execution interrupted before all tool work completed.' } });
  const messageSchema = 'urn:eino:run:2#/$defs/Message';
  content(r, 'c:agent-user-message', 'i:root', 'message', { role: 'user', parts: [{ kind: 'text', text: 'Compare the two fictional project summaries and render the result.' }] }, { schemaRef: messageSchema });
  lookup(r, 'i:root').inputRefs.push('c:agent-user-message');
  r.run.capture.coverage.push('model');
  for (const worker of ['left', 'right']) {
    definition(r, `d:${worker}`, 'agent', 'worker', 'd:agent', { path: [worker] });
    definition(r, `d:${worker}:lookup`, 'tool', 'lookup', `d:${worker}`);
    invocation(r, `i:${worker}`, 'agent', 'worker', 'i:root', 100, worker === 'left' ? 700 : 999, { definitionId: `d:${worker}`, status: worker === 'left' ? 'succeeded' : 'interrupted' });
    const m = model(r, `i:${worker}`, worker, 120, 300, JSON.stringify({ tool_calls: [{ id: 'shared-external-call', name: 'lookup', arguments: { query: `synthetic-${worker}` } }, ...(worker === 'right' ? [{ id: 'pending-call', name: 'render', arguments: {} }] : [])] }));
    m.inputRefs.push('c:agent-user-message');
    content(r, `c:assistant:${worker}`, m.id, 'message', {
      role: 'assistant', parts: [{ kind: 'text', text: `Lookup fictional material for ${worker}.` }],
      toolRequestEventIds: [`ev:request:${worker}`, ...(worker === 'right' ? ['ev:request:not-dispatched'] : [])],
    }, { schemaRef: messageSchema });
    m.outputRefs.push(`c:assistant:${worker}`);
    event(r, `ev:request:${worker}`, 'tool.requested', m.id, 300, { targetDefinitionIds: [`d:${worker}:lookup`], contentRefs: [`c:assistant:${worker}`], attributes: { toolName: 'lookup', externalCallId: 'shared-external-call' } });
    const tool = invocation(r, `i:${worker}:lookup`, 'tool', 'lookup', `i:${worker}`, 310, worker === 'left' ? 650 : 998, { definitionId: `d:${worker}:lookup`, externalCallId: 'shared-external-call' });
    relation(r, 'responds_to', iv(tool.id), ref('event', `ev:request:${worker}`), `ev:request:${worker}`);
    if (worker === 'left') {
      content(r, 'c:left:tool-result', tool.id, 'message', { role: 'tool', name: 'lookup', parts: [{ kind: 'text', text: 'Fictional left project completed its draft.' }], respondsToEventId: 'ev:request:left' }, { schemaRef: messageSchema });
      tool.outputRefs.push('c:left:tool-result');
    }
    if (worker === 'right') { tool.status = 'running'; tool.timing = { startedAtMs: epoch + 310, basis: 'observed' }; }
  }
  definition(r, 'd:right:render', 'tool', 'render', 'd:right');
  event(r, 'ev:request:not-dispatched', 'tool.requested', 'i:model:right', 300, { targetDefinitionIds: ['d:right:render'], contentRefs: ['c:assistant:right'], attributes: { toolName: 'render', externalCallId: 'pending-call' } });
  content(r, 'c:agent-final-output', 'i:root', 'output', undefined, { completeness: 'unknown', data: { availability: 'missing', reason: 'No final assistant answer was produced before interruption.' } });
  lookup(r, 'i:root').outputRefs.push('c:agent-final-output');
  partial(r, 'capture.interrupted', 'Tool lookup had started but no terminal observation was captured; render was requested but never dispatched.', iv('i:right:lookup'));
  return r;
}
function definitionsOnly() {
  const r = record('definition-only-workflow', 'workflow', 'unknown', 'definition');
  topology(r);
  return r;
}

const examples = [
  cloud('cloud-focus-week-report-normal', 'week_report'),
  cloud('cloud-focus-work-guidance-normal', 'work_guidance'),
  cloud('cloud-focus-soft-stop', 'work_guidance', 'soft-stop'),
  cloud('cloud-focus-work-items-parse-soft-stop', 'week_report', 'parse-soft-stop'),
  cloud('cloud-focus-card-repair', 'week_report', 'card-repair'),
  emptyWorkflow(),
  cloud('cloud-focus-dependency-degraded-partial', 'work_guidance', 'dependency-degraded'),
  compilationFailure(), loopGraph(), interruptedAgent(), definitionsOnly(),
];

function cloudProfile(r) {
  const p = r._profile;
  if (!p) return;
  const schemaRef = name => `urn:eino:cloud-focus:1#/$defs/${name}`;
  if (p.decisionEvent) annotation(r, 'a:route', ref('event', p.decisionEvent), 'cloud-focus.route-decision', {
    requestedIntent: p.arm, effectiveIntent: p.arm, selectedDefinitionIds: [`d:${p.arm === 'week_report' ? 'week_report_work_items' : 'work_guidance'}`],
    source: 'request_override', reasonCode: 'force_intent', fallback: false, policyVersion: 'synthetic/2026.10.12.1', requestContentRef: 'c:request',
  });
  for (const [n, stop] of (p.softStops ?? []).entries()) annotation(r, `a:soft-stop:${n + 1}`, stop.owner, 'cloud-focus.soft-stop', {
    reasonCode: stop.reason, originInvocationId: stop.origin, inherited: stop.inherited,
  });
  if (p.variant === 'parse-soft-stop') annotation(r, 'a:work-items-validation', `i:${p.arm}_llm_work_items`, 'cloud-focus.validation', {
    stage: 'work_items', status: 'failed', reasonCode: 'format_error', subjectContentRef: 'c:model:work-items:response', modelInvocationId: 'i:model:work-items',
    message: 'The successful model response failed parsing; the business result is empty. No card repair is invoked.',
  });
  if (lookup(r, 'i:model:card')) {
    annotation(r, 'a:card-validation', `i:${p.arm}_llm_card`, 'cloud-focus.validation', {
      stage: 'card', status: p.variant === 'card-repair' ? 'failed' : 'passed', subjectContentRef: 'c:model:card:response', modelInvocationId: 'i:model:card',
      repair: p.variant === 'card-repair' ? { status: 'required' } : { status: 'not_required', attemptCount: 0 },
    });
    if (p.variant === 'card-repair') annotation(r, 'a:repair-validation', `i:${p.arm}_card_format_repair`, 'cloud-focus.validation', {
      stage: 'card', status: 'passed', subjectContentRef: 'c:model:repair:response', modelInvocationId: 'i:model:repair', repair: { status: 'attempted', attemptIndex: 1, attemptCount: 1 },
    });
  }
  if (p.variant === 'dependency-degraded') annotation(r, 'a:profile-warning', `i:${p.arm}_user_profile`, 'cloud-focus.dependency-warning', {
    dependency: 'UserProfileFetcher', operation: 'fetch', reasonCode: 'synthetic_backend_unavailable', effect: 'continued', detailsContentRef: 'c:profile-warning',
  });
  const itemIds = Array.from({ length: p.itemCount }, (_, n) => `item:${r.run.id}:${n + 1}`);
  const items = itemIds.map((itemId, n) => ({ itemId, title: p.variant === 'card-repair' ? '修复后的示例卡片' : `示例卡片${n + 1}`, prompt: '请整理完全虚构的测试材料。', intent: p.arm, related_files: [{ file_id: `synthetic-file-${n + 1}`, file_name: n === 0 ? '示例迭代方案' : '示例质量清单' }] }));
  content(r, 'c:engine-result', p.resultOwner, 'result', { items }, { schemaRef: schemaRef('result-content'), provenance: 'projected' });
  lookup(r, p.resultOwner).outputRefs.push('c:engine-result');
  if (p.resultOwner !== 'i:root') lookup(r, 'i:root').outputRefs.push('c:engine-result');
  metric(lookup(r, 'i:root'), 'items_count', p.itemCount, 'item');
  const emptyDetails = p.variant === 'empty-convergence' ? { reasonCode: 'no_documents', causeInvocationId: 'i:resolve_files', detailsContentRef: 'c:filter-diag' } : {};
  annotation(r, 'a:result', ref('run', r.run.id), 'cloud-focus.result', {
    resultId: `result:${r.run.id}`, version: 1, status: p.itemCount ? 'items' : 'no_items', contentRef: 'c:engine-result', itemIds, ...emptyDetails,
  });
  const evaluation = { scene: 'weekly_report', resultAnnotationId: 'a:result' };
  if (p.arm !== 'unknown') evaluation.intent = p.arm;
  if (p.decisionEvent) evaluation.routeDecisionEventId = p.decisionEvent;
  if (p.variant !== 'empty-convergence') {
    const workItems = p.itemCount ? [0, 1].map(n => ({ title: `示例事项${n + 1}`, summary: '虚构事项摘要', primary_file_ids: [`synthetic-file-${n + 1}`], supporting_file_ids: [], weeks_behavior: [] })) : [];
    content(r, 'c:eval-work-items', `i:${p.arm}_work_item_behavior`, 'evaluation-context', workItems, { provenance: 'projected', schemaRef: schemaRef('work-items') });
    content(r, 'c:eval-time', `i:${p.arm}_file_behavior_context`, 'evaluation-context', { current_time: '2026-10-12T16:00:00+08:00', timezone: 'Asia/Shanghai', weekday: 'Monday', now_unix: epoch / 1000 }, { provenance: 'projected', schemaRef: schemaRef('time-context') });
    content(r, 'c:eval-profile', `i:${p.arm}_user_profile`, 'evaluation-context', { user_id: 'synthetic-user', ...(p.variant !== 'dependency-degraded' ? { company_role: 'synthetic-project-owner' } : {}) }, { provenance: 'projected', schemaRef: schemaRef('user-profile') });
    Object.assign(evaluation, { documentsContentRef: 'c:materials', workItemsContentRef: 'c:eval-work-items', timeContextContentRef: 'c:eval-time', userProfileContentRef: 'c:eval-profile' });
  }
  annotation(r, 'a:evaluation', ref('run', r.run.id), 'cloud-focus.evaluation-context', evaluation);
}

for (const r of examples) {
  cloudProfile(r);
  delete r._profile;
  finish(r);
}
