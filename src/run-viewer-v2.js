import { contentReadingV2, explainRunRecordV2, invocationScopeV2, projectRunRecordV2Document } from "./viewer-v2.js";
import { registerRunViewerState } from "./run-viewer-state.js";

const labels = {
  en: { title: "Saved result", overall: "Overall result", input: "Input", output: "Output", final: "Final output", calls: "Calls", steps: "Steps", flow: "Flow", trajectory: "Trajectory", details: "Details", definition: "Declared structure", declared: "Execution not observed", unknown: "Not recorded", reference: "Content reference · not loaded", missing: "Content not recorded", partial: "Partial", complete: "Complete", redacted: "Redacted", truncated: "Source truncated", original: "Original record", source: "Original source", content: "Contents", usage: "Model usage", annotations: "Annotations", relations: "Recorded relations", events: "Events", previous: "Previous", next: "Next", back: "Back", enter: "Open child scope", close: "Close", search: "Find a call", all: "All calls", local: "Call result", duration: "Duration", copy: "Copy full value", copied: "Copied", unavailable: "Copy unavailable; select the value", expand: "Show full content", empty: "Empty string", null: "Recorded null", unassigned: "Parent unknown", pending: "Requested · execution not observed", noCalls: "No calls recorded", noDefinition: "No declared definition recorded", raw: "Source details", unknownUsage: "Unknown", issues: "Capture issues", clock: "Clock order conflict", scope: "Reading scope", evidence: "Original events", boundaries: "Cross-scope edges", status: { succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled", interrupted: "Interrupted", running: "Running", unknown: "Unknown" } },
  zh: { title: "运行结果", overall: "整次结果", input: "输入", output: "输出", final: "最终输出", calls: "次调用", steps: "步骤", flow: "流程", trajectory: "轨迹", details: "详情", definition: "声明结构", declared: "未观察到执行", unknown: "未记录", reference: "内容引用 · 尚未加载", missing: "正文未采集", partial: "部分", complete: "完整", redacted: "已脱敏", truncated: "源内容已截断", original: "完整原始记录", source: "原始来源", content: "内容", usage: "模型用量", annotations: "业务扩展", relations: "已记录关系", events: "事件", previous: "上一页", next: "下一页", back: "返回", enter: "进入子范围", close: "关闭", search: "查找调用", all: "全部调用", local: "局部调用结果", duration: "耗时", copy: "复制完整内容", copied: "已复制", unavailable: "无法自动复制，请选中正文", expand: "展开完整内容", empty: "空字符串", null: "已记录 null", unassigned: "父调用未知", pending: "已请求 · 未观察到执行", noCalls: "没有已记录调用", noDefinition: "未记录声明结构", raw: "来源详情", unknownUsage: "未知", issues: "采集问题", clock: "时钟顺序冲突", scope: "阅读范围", evidence: "原始事件", boundaries: "跨范围连线", status: { succeeded: "成功", failed: "失败", cancelled: "已取消", interrupted: "已中断", running: "运行中", unknown: "未知" } },
};

const style = `
.ev2{--ink:#172536;--muted:#586b7d;--line:#d5dfe7;--blue:#2758c7;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:12px;font:14px/1.55 "Avenir Next","PingFang SC","Microsoft YaHei",system-ui,sans-serif;overflow:hidden;container-type:inline-size}
.ev2 *{box-sizing:border-box}.ev2 [hidden]{display:none!important}.ev2 h2,.ev2 h3,.ev2 p{margin:0}.ev2 h2{font-size:20px}.ev2 h3{font-size:14px}.ev2 button,.ev2 input{font:inherit;color:inherit}.ev2 button{cursor:pointer;border:1px solid var(--line);border-radius:6px;background:#fff;padding:6px 10px;text-align:left;overflow-wrap:anywhere}.ev2 button:hover,.ev2 button[aria-pressed=true]{background:#edf3ff;border-color:var(--blue)}.ev2 button:disabled{opacity:.5;cursor:default}.ev2 :is(button,input,summary,pre):focus-visible{outline:3px solid #2758c770;outline-offset:2px}.ev2 summary{cursor:pointer}.ev2 input{width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;background:#fff}.ev2-header{padding:16px 22px;border-top:4px solid var(--blue);border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap}.ev2-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:8px}.ev2-muted{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.ev2-badge{border-radius:5px;background:#edf3f7;padding:3px 8px;font-size:12px}.ev2 [data-status=failed],.ev2 [data-status=cancelled]{color:#a34037}.ev2 [data-status=succeeded]{color:#197051}.ev2 [data-status=interrupted]{color:#80551d}.ev2-summary{padding:18px 22px;border-bottom:1px solid var(--line)}.ev2-channels{display:grid;grid-template-columns:1fr 1fr;gap:22px}.ev2-channel{min-width:0}.ev2-value{margin:8px 0 12px}.ev2 pre{margin:7px 0;padding:11px;background:#f3f6f8;border:1px solid var(--line);border-radius:5px;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,monospace;max-height:460px;overflow:auto}.ev2 .ev2-text{font:14px/1.7 inherit}.ev2-nav{padding:12px 22px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--line)}.ev2-workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,36%);min-height:420px}.ev2-workspace[data-detail-open=false]{grid-template-columns:1fr}.ev2-main{min-width:0;padding:16px 20px}.ev2-detail{min-width:0;border-left:1px solid var(--line);padding:18px;max-height:850px;overflow:auto}.ev2-detail-title{display:flex;justify-content:space-between;gap:12px;align-items:start}.ev2-list{display:grid;gap:7px;margin-top:12px}.ev2-call{width:100%;display:grid;gap:3px;border-left:3px solid transparent!important}.ev2-call[aria-pressed=true]{border-left-color:var(--blue)!important}.ev2-call small{color:var(--muted);overflow-wrap:anywhere}.ev2-pager{display:flex;justify-content:space-between;align-items:center;margin-top:10px}.ev2-flow{height:480px;position:relative;border:1px solid var(--line);border-radius:7px;background:#fafcfd;overflow:hidden;margin-top:12px;touch-action:none}.ev2-flow svg{display:block;width:100%;height:100%}.ev2-flow-controls{position:absolute;right:8px;bottom:8px;display:flex;gap:5px}.ev2-flow button{padding:5px 9px}.ev2-flow [role=button]{cursor:pointer}.ev2-flow [data-selected=true] rect{stroke:#2758c7;stroke-width:3;fill:#eef4ff}.ev2-flow [data-edge-id]{cursor:pointer}.ev2-attachments{padding:16px 22px;border-top:1px solid var(--line)}.ev2-attachments>details{margin:8px 0}.ev2-issue{border-left:3px solid #c08b33;background:#fff8e8;padding:8px 12px;margin-top:10px}.ev2-table{border-collapse:collapse;width:100%;font-size:12px;margin-top:8px}.ev2-table th,.ev2-table td{padding:6px;text-align:left;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.ev2-root-identity{max-width:100%;overflow-wrap:anywhere}.ev2-detail section{margin-top:18px}.ev2-event-note{border-left:3px solid #d5dfe7;padding-left:10px;margin:8px 0}.ev2-mobile-scope{max-width:100%}
@container(max-width:700px){.ev2-workspace,.ev2-channels{grid-template-columns:1fr}.ev2-detail{border-left:0;border-top:1px solid var(--line);max-height:none}.ev2-header,.ev2-summary,.ev2-main,.ev2-detail,.ev2-nav,.ev2-attachments{padding:14px}.ev2-flow{height:380px}}
`;

function errorFrom(diagnostics) {
  const error = new TypeError("Invalid RunRecord v2");
  error.name = "EinoViewerError";
  error.code = diagnostics[0]?.code || "viewer.invalid_input";
  error.diagnostics = diagnostics;
  return error;
}
const textValue = (value) => typeof value === "string" ? value : JSON.stringify(value, null, 2);
const entityCollections = { definition: "definitions", invocation: "nodes", event: "events", content: "contents", usage: "usage", annotation: "annotations", relation: "relations", sourceRecord: "sourceRecords" };
const MAX_FLOW_NODES = 2000, MAX_FLOW_EDGES = 5000;
const endpointKey = (reference) => JSON.stringify([reference.kind, reference.id]);

/** Native saved v2 reader shared by workbench, embed and portable entry points. */
export function createRunViewerV2(container, input, options = {}) {
  if (!container?.ownerDocument || typeof container.replaceChildren !== "function") throw errorFrom([{ code: "viewer.invalid_container", message: "Expected an Element container.", severity: "error", path: "root" }]);
  if (options.locale !== undefined && !["en", "zh"].includes(options.locale)) throw errorFrom([{ code: "viewer.invalid_locale", message: "Expected locale en or zh.", severity: "error", path: "root" }]);
  const dom = container.ownerDocument;
  const pageSize = Number.isInteger(options.pageSize) ? Math.min(200, Math.max(1, options.pageSize)) : 30;
  let locale = options.locale || "en", current, explanation, root, destroyed = false, unregister, state, refs;
  let originalJSON = "", indexes, definitionsByParent, callsByDefinition, edgesByEndpoint, relationsByEndpoint, scopeCache;
  function indexRecord() {
    indexes = Object.assign(Object.create(null), Object.fromEntries(Object.entries(entityCollections).map(([kind, collection]) => [kind, new Map((current[collection] || []).map((value) => [value.id, value]))])));
    indexes.run = new Map([[current.run.id, current.run]]);
    definitionsByParent = new Map(); callsByDefinition = new Map(); edgesByEndpoint = new Map(); relationsByEndpoint = new Map(); scopeCache = new Map();
    const append = (index, key, value) => { if (!index.has(key)) index.set(key, []); index.get(key).push(value); };
    for (const definition of current.definitions) {
      append(definitionsByParent, definition.parentId || null, definition);
      for (const edge of definition.edges || []) {
        const entry = { scope: definition, edge };
        append(edgesByEndpoint, edge.from, entry);
        if (edge.to !== edge.from) append(edgesByEndpoint, edge.to, entry);
      }
    }
    for (const node of current.nodes) if (node.definitionId) append(callsByDefinition, node.definitionId, node);
    for (const relation of current.relations) {
      append(relationsByEndpoint, endpointKey(relation.from), relation);
      if (endpointKey(relation.to) !== endpointKey(relation.from)) append(relationsByEndpoint, endpointKey(relation.to), relation);
    }
  }
  function scopeReading() {
    if (!scopeCache.has(state.scopeId)) {
      const ids = invocationScopeV2(current, state.scopeId) || new Set();
      // Deep chains must not retain one descendant Set for every visited scope.
      if (scopeCache.size >= 4) scopeCache.delete(scopeCache.keys().next().value);
      scopeCache.set(state.scopeId, { ids, nodes: state.scopeId === null ? current.nodes : current.nodes.filter((node) => ids.has(node.id)) });
    }
    return scopeCache.get(state.scopeId);
  }
  function assertActive() { if (destroyed) throw errorFrom([{ code: "viewer.destroyed", path: "root", message: "The viewer was destroyed.", severity: "error" }]); }
  function el(tag, className = "", text) {
    const result = dom.createElement(tag);
    result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }
  function button(text, action, className = "") {
    const value = el("button", className, text); value.type = "button";
    value.addEventListener("click", () => { if (!destroyed) action(); }); return value;
  }
  function entity(kind, id) { return indexes[kind]?.get(id); }
  function status(value) { return labels[locale].status[value] || value; }
  function duration(timing) { return timing.durationMs !== undefined ? `${timing.durationMs} ms · ${timing.basis}` : labels[locale].unknown; }
  function rawDetails(value, label = labels[locale].raw) {
    const details = el("details"); details.append(el("summary", "ev2-muted", label), el("pre", "", JSON.stringify(value, null, 2))); return details;
  }
  function headingSection(title) { const section = el("section"); section.append(el("h3", "", title)); return section; }
  function pagedRows(section, key, entries, row) {
    const list = el("div", "ev2-list"), pager = el("div", "ev2-pager");
    const render = () => {
      const page = Math.min(state.collectionPages[key] || 0, Math.max(0, Math.ceil(entries.length / pageSize) - 1));
      state.collectionPages[key] = page;
      list.replaceChildren();
      for (const entry of entries.slice(page * pageSize, (page + 1) * pageSize)) list.append(row(entry));
      pager.replaceChildren();
      if (entries.length > pageSize) {
        const previous = button(labels[locale].previous, () => { state.collectionPages[key] = page - 1; render(); });
        const next = button(labels[locale].next, () => { state.collectionPages[key] = page + 1; render(); });
        previous.disabled = page === 0; next.disabled = (page + 1) * pageSize >= entries.length;
        previous.dataset.collectionPrevious = key; next.dataset.collectionNext = key;
        pager.append(previous, el("span", "ev2-muted", `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, entries.length)} / ${entries.length}`), next);
      }
    };
    render(); section.append(list, pager);
  }
  function sourceControl(kind, id) { return button(labels[locale].source, () => selectEntity({ kind, id }), "ev2-muted"); }
  function valueBlock(content) {
    const t = labels[locale], reading = contentReadingV2(content), box = el("div", "ev2-value");
    box.dataset.contentId = content.id; box.dataset.availability = reading.availability;
    const flags = [content.role, reading.completeness !== "complete" ? `${t.partial} · ${reading.completeness}` : undefined,
      reading.redacted ? t.redacted : undefined, reading.truncated ? t.truncated : undefined, content.provenance !== "observed" ? content.provenance : undefined].filter(Boolean);
    box.append(el("p", "ev2-muted", flags.join(" · ")));
    if (reading.availability === "inline") {
      let presented = reading.value;
      // The generic message is a presentation only; the exact typed object remains below.
      const message = content.schemaRef === "urn:eino:run:2#/$defs/Message" ? reading.value : undefined;
      if (message?.parts) {
        box.append(el("p", "ev2-muted", message.role));
        presented = message.parts.map((part) => part.kind === "text" ? part.text : `[${part.contentRef}]`).join("\n");
      }
      const text = textValue(presented), display = presented === "" ? t.empty : presented === null ? t.null : text;
      const pre = el("pre", typeof presented === "string" ? "ev2-text" : "", display);
      pre.dataset.runValue = ""; pre.tabIndex = 0;
      if (text.length > 1400) {
        const preview = el("pre", "", text.slice(0, 1000) + "…"); preview.dataset.valuePreview = "";
        const complete = el("details"); complete.append(el("summary", "", t.expand), pre); box.append(preview, complete);
      } else box.append(pre);
      const copy = button(t.copy, async () => {
        const clipboard = dom.defaultView?.navigator?.clipboard;
        try { if (!clipboard?.writeText) throw new Error(); await clipboard.writeText(textValue(reading.value)); copy.textContent = t.copied; }
        catch { copy.textContent = t.unavailable; pre.focus?.(); }
      });
      copy.dataset.copyContent = content.id; box.append(copy);
      if (message?.parts) {
        for (const part of message.parts.filter((entry) => entry.kind === "content")) box.append(button(part.contentRef, () => selectEntity({ kind: "content", id: part.contentRef })));
        for (const id of message.toolRequestEventIds || []) box.append(button(id, () => selectEntity({ kind: "event", id })));
      }
    } else if (reading.availability === "missing") box.append(el("p", "ev2-issue", `${t.missing}: ${reading.reason}`));
    else box.append(el("p", "ev2-issue", t.reference), el("pre", "", JSON.stringify({ key: reading.key, sha256: reading.sha256, byteLength: reading.byteLength }, null, 2)));
    box.append(sourceControl("content", content.id));
    return box;
  }
  function channels(inputValues, outputValues, wholeRun = false) {
    const t = labels[locale], row = el("div", "ev2-channels");
    for (const [direction, values, title] of [["output", outputValues, wholeRun ? t.final : t.output], ["input", inputValues, t.input]]) {
      const channel = headingSection(title); channel.className = "ev2-channel"; channel.dataset.runChannel = direction;
      for (const content of values) channel.append(valueBlock(content));
      if (!values.length) channel.append(el("p", "ev2-muted", t.unknown));
      row.append(channel);
    }
    return row;
  }
  function usageSection(usages) {
    const t = labels[locale], section = headingSection(t.usage);
    const table = el("table", "ev2-table"), header = el("tr");
    ["Model", "Input", "Output", "Total"].forEach((name) => header.append(el("th", "", name))); table.append(header);
    for (const usage of usages) {
      const row = el("tr"); row.dataset.usageId = usage.id;
      const model = el("td"); model.append(button(usage.model || t.unknownUsage, () => selectEntity({ kind: "usage", id: usage.id }))); row.append(model);
      for (const field of ["input", "output", "total"]) row.append(el("td", "", usage.tokens[field] === undefined ? t.unknownUsage : String(usage.tokens[field])));
      table.append(row);
    }
    section.append(table); return section;
  }
  function annotationsSection(annotations) {
    const section = headingSection(labels[locale].annotations);
    for (const annotation of annotations) {
      const details = rawDetails(annotation.payload, `${annotation.type} · v${annotation.schemaVersion}`);
      details.dataset.annotationId = annotation.id; details.append(sourceControl("annotation", annotation.id)); section.append(details);
    }
    return section;
  }
  function showSummary() {
    const t = labels[locale], node = entity("invocation", state.scopeId || current.run.rootInvocationId);
    refs.summary.replaceChildren(); refs.summary.dataset.runSummary = "";
    refs.summary.append(el("h3", "", state.scopeId ? `${t.local} · ${node?.name || state.scopeId}` : t.overall));
    const outcome = state.scopeId ? node?.status : current.run.status;
    const meta = el("div", "ev2-actions"), badge = el("span", "ev2-badge", current.run.mode === "definition" ? t.declared : status(outcome));
    badge.dataset.status = outcome; badge.dataset.runResult = outcome;
    meta.append(badge, el("span", "ev2-muted", `${t.duration} · ${duration(node?.timing || current.run.timing)}`)); refs.summary.append(meta);
    if (node?.error) refs.summary.append(el("p", "ev2-issue", node.error.message));
    refs.summary.append(channels(node?.input || [], node?.output || [], !state.scopeId));
    if (!state.scopeId && current.run.capture.issues.length) {
      const issue = headingSection(t.issues); issue.className = "ev2-issue";
      for (const entry of current.run.capture.issues) issue.append(el("p", "", entry.message)); refs.summary.append(issue);
    }
  }
  function visibleNodes() { return scopeReading().nodes; }
  function scopeForDefinition() {
    const scope = entity("invocation", state.scopeId);
    return state.definitionScopeId || scope?.definitionId || current.definitions.find((entry) => !entry.parentId && ["graph", "workflow"].includes(entry.kind))?.id;
  }
  function renderNavigation() {
    const t = labels[locale]; refs.nav.replaceChildren();
    const overall = button(t.overall, () => selectGroup(null)); overall.dataset.scopeRoot = ""; refs.nav.append(overall);
    const path = [], byId = indexes.invocation;
    let cursor = byId.get(state.scopeId);
    while (cursor) { path.push(cursor); cursor = cursor.parent.state === "known" ? byId.get(cursor.parent.invocationId) : undefined; }
    path.reverse();
    const scopeControl = (node) => { const control = button(node.name, () => selectGroup(node.id)); control.dataset.scopeId = node.id; return control; };
    if (path.length > 8) {
      const ancestors = el("details"); ancestors.append(el("summary", "", `${t.scope} · ${path.length}`));
      pagedRows(ancestors, `ancestors:${state.scopeId}`, path, scopeControl); refs.nav.append(ancestors);
      for (const node of path.slice(-2)) refs.nav.append(scopeControl(node));
    } else for (const node of path) refs.nav.append(scopeControl(node));
    if (state.scopeId || state.definitionScopeId) {
      const back = button(t.back, () => {
        if (state.definitionScopeId) { state.definitionScopeId = entity("definition", state.definitionScopeId)?.parentId || null; state.drawLarge = false; renderNavigation(); renderFlow(); }
        else { const scope = byId.get(state.scopeId); selectGroup(scope?.parent.state === "known" && scope.parent.invocationId !== current.run.rootInvocationId ? scope.parent.invocationId : null); }
      }); back.dataset.scopeBack = ""; refs.nav.append(back);
    }
    const groups = visibleNodes().filter((node) => node.children.length);
    const scopes = el("details", "ev2-mobile-scope"); scopes.append(el("summary", "", `${t.scope} · ${groups.length}`));
    pagedRows(scopes, `scopes:${state.scopeId}`, groups, (node) => {
      const control = button(`${node.name} · ${node.id}`, () => selectGroup(node.id)); control.dataset.selectScope = node.id; return control;
    });
    refs.nav.append(scopes);
  }
  function rows() {
    const nodes = visibleNodes().filter((node) => node.id !== (state.scopeId || current.run.rootInvocationId));
    const result = nodes.map((node) => ({ kind: "invocation", id: node.id, name: node.name, status: node.status, order: node.readingOrder, value: node }));
    if (current.kind === "agent") {
      const ids = scopeReading().ids;
      const dispatched = new Set(current.relations.filter((relation) => relation.type === "responds_to").map((relation) => relation.to.id));
      for (const event of current.events) {
        if (event.owner.kind === "invocation" && !ids.has(event.owner.id)) continue;
        if (event.type === "tool.requested" && !dispatched.has(event.id) || ["agent.message", "agent.transfer-requested"].includes(event.type)) result.push({ kind: "event", id: event.id, name: event.attributes?.toolName || event.attributes?.destinationAgent || event.type, status: event.type === "tool.requested" ? "requested" : "observed", order: event.sequence, value: event });
      }
    }
    return current.kind === "agent" ? result.sort((a, b) => a.order - b.order) : result;
  }
  function renderRows() {
    const t = labels[locale], query = state.query.toLocaleLowerCase();
    const entries = rows().filter((row) => `${row.name} ${row.id} ${row.status}`.toLocaleLowerCase().includes(query));
    state.page = Math.min(state.page, Math.max(0, Math.ceil(entries.length / pageSize) - 1));
    refs.list.replaceChildren();
    for (const row of entries.slice(state.page * pageSize, (state.page + 1) * pageSize)) {
      const node = row.value, control = button("", () => selectEntity({ kind: row.kind, id: row.id }), "ev2-call");
      control.dataset[row.kind === "event" ? "eventId" : "stepId"] = row.id;
      if (row.kind === "invocation") control.dataset.invocationId = row.id;
      if (current.kind === "agent") control.dataset.trajectoryRecord = row.id;
      control.setAttribute("aria-pressed", String(state.selected?.kind === row.kind && state.selected.id === row.id));
      control.append(el("span", "", row.name), el("small", "", [row.status === "requested" ? t.pending : status(row.status),
        row.kind === "invocation" ? duration(node.timing) : undefined,
        node.parent?.state === "unknown" ? `${t.unassigned}: ${node.parent.reason}` : undefined,
        row.id].filter(Boolean).join(" · ")));
      if (current.kind === "agent") {
        const values = row.kind === "invocation" ? [...node.output, ...node.input] : node.contentRefs.map((id) => entity("content", id));
        const content = values.find((entry) => entry.data.availability === "inline");
        if (content) {
          const value = content.data.value;
          const preview = content.schemaRef === "urn:eino:run:2#/$defs/Message" && value?.parts
            ? value.parts.map((part) => part.kind === "text" ? part.text : `[${part.contentRef}]`).join("\n") : textValue(value);
          const body = el("p", "ev2-muted", preview.length > 260 ? `${preview.slice(0, 260)}…` : preview);
          body.dataset.trajectoryPreview = content.id; control.append(body);
        }
      }
      refs.list.append(control);
    }
    if (!entries.length) refs.list.append(el("p", "ev2-muted", t.noCalls));
    refs.pager.replaceChildren();
    if (entries.length > pageSize) {
      const previous = button(t.previous, () => { state.page--; renderRows(); }), next = button(t.next, () => { state.page++; renderRows(); });
      previous.disabled = state.page === 0; next.disabled = (state.page + 1) * pageSize >= entries.length;
      refs.pager.append(previous, el("span", "ev2-muted", `${state.page * pageSize + 1}–${Math.min((state.page + 1) * pageSize, entries.length)} / ${entries.length}`), next);
    }
  }
  function svgElement(tag, attributes) {
    const node = dom.createElementNS ? dom.createElementNS("http://www.w3.org/2000/svg", tag) : el(tag);
    for (const [key, value] of Object.entries(attributes || {})) node.setAttribute(key, String(value));
    return node;
  }
  function renderFlow() {
    if (!refs.flow) return;
    const t = labels[locale], scopeId = scopeForDefinition();
    const scope = entity("definition", scopeId);
    const definitions = definitionsByParent.get(scopeId || null) || [];
    refs.flow.replaceChildren();
    refs.boundaries.replaceChildren(); refs.definitionList.replaceChildren();
    if (!definitions.length) { refs.flow.append(el("p", "ev2-muted", t.noDefinition)); return; }
    const ids = new Set(definitions.map((entry) => entry.id));
    const available = new Map();
    const addEdge = (entry) => available.set(JSON.stringify([entry.scope.id, entry.edge.id]), entry);
    for (const edge of scope?.edges || []) addEdge({ scope, edge });
    for (const definition of definitions) for (const entry of edgesByEndpoint.get(definition.id) || []) addEdge(entry);
    const local = [], boundary = [];
    for (const entry of available.values()) (ids.has(entry.edge.from) && ids.has(entry.edge.to) ? local : boundary).push(entry);
    const edges = local.map((entry) => entry.edge);
    function edgeList(entries, title, key) {
      const section = headingSection(`${title} · ${entries.length}`);
      pagedRows(section, key, entries, ({ scope: owner, edge }) => {
        const row = el("div", "ev2-event-note"); row.dataset.boundaryEdgeId = edge.id; row.dataset.edgeScopeId = owner.id;
        const control = button(`${edge.kind}: ${edge.from} → ${edge.to}`, () => showDefinitionEdge(owner, edge));
        control.dataset.inspectEdge = edge.id; row.append(control);
        for (const id of [edge.from, edge.to]) {
          const jump = button(`${entity("definition", id)?.name || id} · ${id}`, () => selectEntity({ kind: "definition", id }));
          jump.dataset.edgeEndpoint = id; row.append(jump);
        }
        return row;
      });
      refs.boundaries.append(section);
    }
    if (boundary.length) edgeList(boundary, t.boundaries, `boundary:${scopeId}:${state.scopeId}`);
    const exceedsBudget = definitions.length > MAX_FLOW_NODES || edges.length > MAX_FLOW_EDGES;
    if (definitions.length > 500 && !state.drawLarge || exceedsBudget) {
      refs.flow.append(el("p", "ev2-muted", `${t.definition} · ${definitions.length} · ${locale === "zh" ? "连线" : "Edges"} · ${edges.length}`));
      if (!exceedsBudget) refs.flow.append(button(`${t.flow} · ${definitions.length}`, () => { state.drawLarge = true; renderFlow(); }));
      else refs.flow.append(el("p", "ev2-issue", locale === "zh" ? `此范围超过绘图预算（${MAX_FLOW_NODES} 个节点 / ${MAX_FLOW_EDGES} 条连线）。下方可检索全部定义与读取连线。` : `This scope exceeds the drawing budget (${MAX_FLOW_NODES} nodes / ${MAX_FLOW_EDGES} edges). Search every definition and read its edges below.`));
      const directory = headingSection(`${t.definition} · ${definitions.length}`), query = el("input");
      query.type = "search"; query.dataset.definitionSearch = "";
      query.setAttribute("aria-label", locale === "zh" ? "查找定义" : "Find a definition");
      const key = `definitions:${scopeId}:${state.scopeId}`;
      query.value = state.definitionQueries[key] || "";
      const matches = el("div");
      const showDefinitions = () => {
        const search = query.value.toLocaleLowerCase();
        const entries = definitions.filter((definition) => `${definition.name} ${definition.id}`.toLocaleLowerCase().includes(search));
        matches.replaceChildren();
        pagedRows(matches, key, entries, (definition) => {
          const control = button(`${definition.name} · ${definition.id}`, () => selectEntity({ kind: "definition", id: definition.id }));
          control.dataset.definitionEntry = definition.id; return control;
        });
      };
      query.addEventListener("input", () => { state.definitionQueries[key] = query.value; state.collectionPages[key] = 0; showDefinitions(); });
      directory.append(query, matches); showDefinitions(); refs.definitionList.append(directory);
      if (local.length) edgeList(local, locale === "zh" ? "范围内连线" : "Scope edges", `edges:${scopeId}:${state.scopeId}`);
      return;
    }
    const incoming = new Set(), outgoing = new Map();
    for (const edge of edges) if (edge.kind !== "candidate") {
      incoming.add(edge.to);
      if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
      outgoing.get(edge.from).push(edge.to);
    }
    const levels = new Map(), queue = definitions.filter((node) => !incoming.has(node.id)).map((node) => node.id);
    if (!queue.length) queue.push(definitions[0].id);
    queue.forEach((id) => levels.set(id, 0));
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor];
      for (const target of outgoing.get(id) || []) if (!levels.has(target)) { levels.set(target, levels.get(id) + 1); queue.push(target); }
    }
    let fallback = 0;
    for (const definition of definitions) if (!levels.has(definition.id)) levels.set(definition.id, fallback++);
    const levelCounts = new Map(), positions = new Map();
    for (const definition of definitions) {
      const level = levels.get(definition.id), row = levelCounts.get(level) || 0;
      levelCounts.set(level, row + 1); positions.set(definition.id, { x: 125 + level * 245, y: 65 + row * 115 });
    }
    let maxLevel = 0, maxRows = 0;
    for (const level of levels.values()) maxLevel = Math.max(maxLevel, level);
    for (const count of levelCounts.values()) maxRows = Math.max(maxRows, count);
    const baseWidth = Math.max(650, 250 + maxLevel * 245), baseHeight = Math.max(340, 70 + maxRows * 115);
    const horizontal = ["LR", "RL"].includes(state.layout), reverse = ["RL", "BT"].includes(state.layout);
    const width = horizontal ? baseWidth : baseHeight, height = horizontal ? baseHeight : baseWidth;
    for (const [id, point] of positions) positions.set(id, horizontal
      ? { x: reverse ? baseWidth - point.x : point.x, y: point.y }
      : { x: point.y, y: reverse ? baseWidth - point.x : point.x });
    const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": `${t.definition}: ${scope?.name || current.run.scope}` });
    const viewport = svgElement("g"); svg.append(viewport);
    const viewportKey = JSON.stringify([scopeId, state.scopeId, state.layout]);
    let { zoom = 1, panX = 0, panY = 0 } = state.viewports[viewportKey] || {};
    const transform = () => {
      viewport.setAttribute("transform", `translate(${panX} ${panY}) scale(${zoom})`);
      state.viewports[viewportKey] = { zoom, panX, panY };
    };
    transform();
    for (const { scope: owner, edge } of local) {
      const a = positions.get(edge.from), b = positions.get(edge.to), direction = reverse ? -1 : 1;
      const forward = (horizontal ? b.x - a.x : b.y - a.y) * direction > 0;
      const self = edge.from === edge.to;
      const curve = self ? `M ${a.x+50} ${a.y-30} C ${a.x+125} ${a.y-95}, ${a.x-125} ${a.y-95}, ${a.x-50} ${a.y-30}` : horizontal
        ? forward ? `M ${a.x + 94 * direction} ${a.y} C ${a.x + 135 * direction} ${a.y}, ${b.x - 135 * direction} ${b.y}, ${b.x - 94 * direction} ${b.y}`
          : `M ${a.x} ${a.y - 28} C ${a.x} ${Math.min(a.y, b.y) - 75}, ${b.x} ${Math.min(a.y, b.y) - 75}, ${b.x} ${b.y - 28}`
        : forward ? `M ${a.x} ${a.y + 30 * direction} C ${a.x} ${a.y + 65 * direction}, ${b.x} ${b.y - 65 * direction}, ${b.x} ${b.y - 30 * direction}`
          : `M ${a.x - 94} ${a.y} C ${Math.min(a.x,b.x)-125} ${a.y}, ${Math.min(a.x,b.x)-125} ${b.y}, ${b.x-94} ${b.y}`;
      const edgeSelected = state.edge?.scopeId === owner.id && state.edge.id === edge.id;
      const path = svgElement("path", { d: curve, fill: "none", stroke: edgeSelected ? "#2758c7" : edge.kind === "data" ? "#7f96b0" : "#637789", "stroke-width": edgeSelected ? 4 : 2, "stroke-dasharray": edge.kind === "candidate" ? "5 4" : "none", tabindex: 0, role: "button", "data-edge-id": edge.id, "data-selected": edgeSelected, "aria-label": `${edge.kind}: ${edge.from} → ${edge.to}` });
      const select = () => showDefinitionEdge(owner, edge);
      path.addEventListener("click", select); path.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); select(); } });
      viewport.append(path);
      const end = self ? { x:a.x-50,y:a.y-30,dx:0,dy:1 } : horizontal ? forward ? { x: b.x-94*direction, y:b.y, dx:direction,dy:0 } : { x:b.x,y:b.y-28,dx:0,dy:1 }
        : forward ? { x:b.x,y:b.y-30*direction,dx:0,dy:direction } : { x:b.x-94,y:b.y,dx:1,dy:0 };
      viewport.append(svgElement("path", { d: `M ${end.x-7*end.dx-4*end.dy} ${end.y-7*end.dy+4*end.dx} L ${end.x} ${end.y} L ${end.x-7*end.dx+4*end.dy} ${end.y-7*end.dy-4*end.dx}`, fill: "none", stroke: "#637789", "stroke-width": 2 }));
    }
    const invocationIds = scopeReading().ids;
    for (const definition of definitions) {
      const point = positions.get(definition.id), calls = (callsByDefinition.get(definition.id) || []).filter((node) => invocationIds.has(node.id));
      const group = svgElement("g", { tabindex: 0, role: "button", "data-definition-id": definition.id, "data-selected": state.selected?.kind === "definition" && state.selected.id === definition.id, "aria-label": `${definition.name} · ${calls.length ? `${calls.length} ${t.calls}` : t.declared}` });
      const selected = () => selectEntity({ kind: "definition", id: definition.id });
      group.addEventListener("click", selected); group.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); selected(); } });
      group.append(svgElement("rect", { x: point.x - 94, y: point.y - 30, width: 188, height: 60, rx: 8, fill: "#fff", stroke: calls.some((call) => call.status === "failed") ? "#b5544a" : "#bac8d5", "stroke-width": 1.5 }));
      const title = svgElement("text", { x: point.x, y: point.y - 4, "text-anchor": "middle", "font-size": 12, fill: "#172536" }); title.textContent = definition.name.length > 26 ? definition.name.slice(0, 25) + "…" : definition.name;
      const subtitle = svgElement("text", { x: point.x, y: point.y + 15, "text-anchor": "middle", "font-size": 10, fill: "#586b7d" }); subtitle.textContent = calls.length ? `${calls.length} ${t.calls} · ${[...new Set(calls.map((call) => status(call.status)))].join(" / ")}` : t.declared;
      group.append(title, subtitle); viewport.append(group);
    }
    refs.flow.append(svg);
    const controls = el("div", "ev2-flow-controls");
    controls.append(button("−", () => { zoom = Math.max(.4, zoom / 1.2); transform(); }), button("+", () => { zoom = Math.min(3, zoom * 1.2); transform(); }), button("1:1", () => { zoom = 1; panX = panY = 0; transform(); })); refs.flow.append(controls);
    for (const [layout, text] of [["LR", "→"], ["RL", "←"], ["TB", "↓"], ["BT", "↑"]]) {
      const control = button(text, () => { state.layout = layout; renderFlow(); });
      control.dataset.layoutDirection = layout; control.setAttribute("aria-pressed", String(state.layout === layout));
      control.setAttribute("aria-label", `${locale === "zh" ? "布局方向" : "Layout direction"}: ${layout}`); controls.append(control);
    }
    let drag;
    svg.addEventListener("pointerdown", (event) => { if (event.target.closest?.("[role=button]")) return; drag = { x: event.clientX, y: event.clientY, panX, panY }; svg.setPointerCapture?.(event.pointerId); });
    svg.addEventListener("pointermove", (event) => { if (!drag) return; const ratio = width / Math.max(1, svg.getBoundingClientRect?.().width || width); panX = Math.max(-width * zoom + 150, Math.min(width - 150, drag.panX + (event.clientX - drag.x) * ratio)); panY = Math.max(-height * zoom + 80, Math.min(height - 80, drag.panY + (event.clientY - drag.y) * ratio)); transform(); });
    svg.addEventListener("pointerup", () => { drag = undefined; }); svg.addEventListener("pointercancel", () => { drag = undefined; });
  }
  function openDetail(title) {
    state.detailOpen = true; refs.detail.hidden = false; refs.workspace.dataset.detailOpen = "true";
    refs.detail.replaceChildren();
    const header = el("div", "ev2-detail-title"), close = button(labels[locale].close, () => { state.detailOpen = false; refs.detail.hidden = true; refs.workspace.dataset.detailOpen = "false"; });
    close.dataset.closeStep = ""; header.append(el("h2", "", title), close); refs.detail.append(header);
  }
  function showDefinitionEdge(scope, edge) {
    state.edge = { scopeId: scope.id, id: edge.id }; state.selected = null;
    openDetail(`${edge.kind}: ${edge.from} → ${edge.to}`);
    delete refs.detail.dataset.entityKind; delete refs.detail.dataset.entityId; delete refs.detail.dataset.stepId;
    refs.detail.dataset.edgeId = edge.id; refs.detail.dataset.edgeScopeId = scope.id;
    refs.detail.append(el("p", "ev2-muted", labels[locale].definition), rawDetails(edge));
    for (const id of [edge.from, edge.to]) refs.detail.append(button(`${entity("definition", id)?.name || id} · ${id}`, () => selectEntity({ kind: "definition", id })));
    renderFlow();
  }
  function relationsSection(kind, id) {
    const related = relationsByEndpoint.get(endpointKey({ kind, id })) || [];
    if (!related.length) return undefined;
    const section = headingSection(labels[locale].relations);
    pagedRows(section, `relations:${kind}:${id}`, related, (relation) => {
      const row = el("div", "ev2-event-note"); row.dataset.relationId = relation.id;
      row.append(el("p", "ev2-muted", relation.type));
      for (const endpoint of [relation.from, relation.to]) row.append(button(`${endpoint.kind} · ${endpoint.id}`, () => selectEntity(endpoint)));
      if (relation.evidenceEventId) row.append(sourceControl("event", relation.evidenceEventId)); return row;
    });
    return section;
  }
  function renderDetail() {
    const selected = state.selected; if (!selected) return;
    const value = entity(selected.kind, selected.id); if (!value) return;
    const t = labels[locale]; openDetail(value.name || value.type || value.role || selected.id);
    delete refs.detail.dataset.edgeId; delete refs.detail.dataset.edgeScopeId;
    refs.detail.dataset.entityKind = selected.kind; refs.detail.dataset.entityId = selected.id;
    delete refs.detail.dataset.stepId; if (selected.kind === "invocation") refs.detail.dataset.stepId = selected.id;
    refs.detail.append(el("p", "ev2-muted", selected.id));
    if (selected.kind === "invocation") {
      const outcome = el("p", "", `${status(value.status)} · ${t.duration}: ${duration(value.timing)}`); outcome.dataset.status = value.status; refs.detail.append(outcome);
      if (value.parent.state === "unknown") refs.detail.append(el("p", "ev2-issue", `${t.unassigned}: ${value.parent.reason}`));
      if (value.timing.startedAtMs !== undefined && value.timing.endedAtMs !== undefined && value.timing.endedAtMs < value.timing.startedAtMs) refs.detail.append(el("p", "ev2-issue", t.clock));
      if (value.error) refs.detail.append(el("p", "ev2-issue", value.error.message));
      if (value.children.length) { const enter = button(t.enter, () => selectGroup(value.id)); enter.dataset.enterScope = value.id; refs.detail.append(enter); }
      refs.detail.append(channels(value.input, value.output));
      if (value.metrics.length) refs.detail.append(rawDetails(value.metrics, "Metrics"));
      if (value.usage.length) refs.detail.append(usageSection(value.usage));
      if (value.annotations.length) refs.detail.append(annotationsSection(value.annotations));
      if (value.events.length) {
        const section = headingSection(t.events);
        pagedRows(section, `events:${value.id}`, value.events, (event) => button(`${event.sequence} · ${event.type}`, () => selectEntity({ kind: "event", id: event.id })));
        refs.detail.append(section);
      }
    } else if (selected.kind === "definition") {
      refs.detail.append(el("p", "ev2-muted", t.definition));
      const scopeIds = scopeReading().ids;
      const visits = (callsByDefinition.get(value.id) || []).filter((node) => scopeIds.has(node.id));
      pagedRows(refs.detail, `visits:${value.id}:${state.scopeId}`, visits, (node) => {
        const control = button(`${node.name} · ${node.id} · ${status(node.status)}`, () => selectEntity({ kind: "invocation", id: node.id }));
        control.dataset.definitionInvocation = node.id; return control;
      });
      if (!visits.length) refs.detail.append(el("p", "ev2-muted", t.declared));
      if (definitionsByParent.has(value.id)) {
        const enter = button(t.enter, () => { state.definitionScopeId = value.id; state.drawLarge = false; renderNavigation(); renderFlow(); }); enter.dataset.enterDefinition = value.id; refs.detail.append(enter);
      }
    } else if (selected.kind === "content") refs.detail.append(valueBlock(value));
    else if (selected.kind === "event") {
      refs.detail.append(el("p", "ev2-muted", `${value.sequence} · ${value.type}`));
      if (value.type === "tool.requested" && !current.relations.some((relation) => relation.type === "responds_to" && relation.to.id === value.id)) refs.detail.append(el("p", "ev2-issue", t.pending));
      if (value.owner.kind !== "unknown") refs.detail.append(button(value.owner.id, () => selectEntity(value.owner)));
      for (const id of value.contentRefs) refs.detail.append(valueBlock(entity("content", id)));
      for (const id of value.targetDefinitionIds || []) refs.detail.append(button(entity("definition", id)?.name || id, () => selectEntity({ kind: "definition", id })));
    } else if (selected.kind === "usage") refs.detail.append(usageSection([value]));
    else if (selected.kind === "annotation") refs.detail.append(el("pre", "", JSON.stringify(value.payload, null, 2)));
    const related = relationsSection(selected.kind, selected.id); if (related) refs.detail.append(related);
    refs.detail.append(rawDetails(selected.kind === "invocation" ? current.record.invocations.find((node) => node.id === selected.id) : value));
  }
  function selectEntity(reference, notify = true) {
    assertActive(); if (!reference || !entity(reference.kind, reference.id)) return false;
    const selected = entity(reference.kind, reference.id);
    const invocationId = reference.kind === "invocation" ? reference.id : reference.kind === "event" && selected.owner.kind === "invocation" ? selected.owner.id : undefined;
    if (state.scopeId && invocationId && !scopeReading().ids.has(invocationId)) {
      state.scopeId = null; state.definitionScopeId = null; state.drawLarge = false;
      state.mode = "steps"; refs.setMode?.(); showSummary(); renderNavigation(); renderFlow();
    }
    if (reference.kind === "definition" && selected.parentId !== scopeForDefinition() && selected.id !== scopeForDefinition()) {
      state.scopeId = null; state.definitionScopeId = selected.parentId || null; state.drawLarge = false;
      showSummary(); renderNavigation();
    }
    state.selected = { kind: reference.kind, id: reference.id }; state.edge = null;
    if (["invocation", "event"].includes(reference.kind)) {
      const entries = rows(), row = entries.find((entry) => entry.kind === reference.kind && entry.id === reference.id);
      if (row) {
        const matches = (entry) => `${entry.name} ${entry.id} ${entry.status}`.toLocaleLowerCase().includes(state.query.toLocaleLowerCase());
        if (!matches(row)) { state.query = ""; refs.query.value = ""; }
        const index = entries.filter(matches).findIndex((entry) => entry.kind === reference.kind && entry.id === reference.id);
        state.page = Math.floor(index / pageSize);
      }
    }
    renderDetail(); renderRows();
    if (reference.kind === "definition") renderFlow();
    if (notify) options.onEntityClick?.({ reference: { ...reference }, value: entity(reference.kind, reference.id) });
    if (notify && reference.kind === "invocation") options.onNodeClick?.({ id: reference.id, node: entity(reference.kind, reference.id) });
    return true;
  }
  function selectStep(id) { return selectEntity({ kind: "invocation", id }, false); }
  function selectEvidence(index) { assertActive(); return Number.isInteger(index) && current.events[index] ? selectEntity({ kind: "event", id: current.events[index].id }, false) : false; }
  function selectGroup(id) {
    assertActive(); if (id !== null && !entity("invocation", id)) return false;
    state.scopeId = id; state.definitionScopeId = null; state.page = 0; state.selected = null; state.edge = null; state.drawLarge = false; state.detailOpen = false;
    refs.detail.hidden = true; refs.workspace.dataset.detailOpen = "false";
    showSummary(); renderNavigation(); renderRows(); renderFlow(); return true;
  }
  function attachments() {
    const t = labels[locale], section = el("section", "ev2-attachments");
    for (const [kind, name, collection] of [["content", t.content, current.contents], ["usage", t.usage, current.usage], ["annotation", t.annotations, current.annotations], ["event", t.events, current.events], ["relation", t.relations, current.relations], ["sourceRecord", t.source, current.sourceRecords || []]]) {
      if (!collection.length) continue;
      const details = el("details"); details.dataset.entityCollection = kind; details.append(el("summary", "", `${name} · ${collection.length}`));
      pagedRows(details, `attachments:${kind}`, collection, (entry) => button(`${entry.name || entry.type || entry.role || entry.model || entry.format || kind} · ${entry.id}`, () => selectEntity({ kind, id: entry.id })));
      section.append(details);
    }
    const raw = el("details"); raw.append(el("summary", "", t.original));
    let loaded = false;
    refs.loadOriginal = () => { if (raw.open && !loaded) { loaded = true; const pre = el("pre", "", originalJSON); pre.dataset.originalRecord = ""; raw.append(pre); } };
    raw.addEventListener("toggle", refs.loadOriginal); section.append(raw);
    return section;
  }
  function scrollTargets() { return [root, refs.detail, refs.main, refs.list, ...root.querySelectorAll("pre")]; }
  function captureReading() {
    return { ...state, selected: state.selected ? { ...state.selected } : null, edge: state.edge ? { ...state.edge } : null,
      viewports: Object.fromEntries(Object.entries(state.viewports).map(([key, value]) => [key, { ...value }])),
      collectionPages: { ...state.collectionPages }, definitionQueries: { ...state.definitionQueries },
      detailOpen: !refs.detail.hidden, folds: Array.from(root.querySelectorAll("details"), (node) => Boolean(node.open)),
      scroll: scrollTargets().map((node) => ({ top: node.scrollTop || 0, left: node.scrollLeft || 0 })),
      windowScroll: { top: dom.defaultView?.scrollY || 0, left: dom.defaultView?.scrollX || 0 },
    };
  }
  function restoreReading(saved) {
    if (!saved) return;
    state.detailOpen = saved.detailOpen !== false;
    refs.detail.hidden = !state.detailOpen; refs.workspace.dataset.detailOpen = String(state.detailOpen);
    if (saved.folds) Array.from(root.querySelectorAll("details")).forEach((node, index) => { node.open = Boolean(saved.folds[index]); });
    // Setting details.open dispatches a later toggle event. Materialize an open
    // original record now so both its scroll and its neighbours keep their keys.
    refs.loadOriginal?.();
    if (saved.scroll) scrollTargets().forEach((node, index) => { node.scrollTop = saved.scroll[index]?.top || 0; node.scrollLeft = saved.scroll[index]?.left || 0; });
    if (saved.windowScroll) dom.defaultView?.scrollTo?.(saved.windowScroll.left, saved.windowScroll.top);
  }
  function render(saved) {
    const t = labels[locale]; root?.remove(); root = el("section", "eino-run-viewer ev2"); root.lang = locale;
    root.dataset.einoRunViewer = current.kind; root.dataset.recordVersion = "2";
    root.dataset.runV2 = ""; root.dataset.protocolVersion = "2";
    root.append(el("style", "", style));
    const sourceName = current.run.source === "application" ? locale === "zh" ? "应用运行" : "Application" : current.run.source === "agent" ? "Agent" : current.run.source === "workflow" ? "Workflow" : "Graph";
    const header = el("header", "ev2-header"); header.append(el("h2", "", `${sourceName} · ${t.title}`));
    const identity = el("details", "ev2-root-identity"); identity.append(el("summary", "ev2-muted", current.run.scope), el("p", "ev2-muted", current.run.id));
    const capture = el("span", "ev2-badge", current.run.capture.state === "complete" ? t.complete : t.partial); capture.dataset.runCapture = current.run.capture.state; identity.append(capture); header.append(identity); root.append(header);
    refs = { summary: el("section", "ev2-summary"), nav: el("nav", "ev2-nav"), workspace: el("div", "ev2-workspace"), main: el("main", "ev2-main"), detail: el("aside", "ev2-detail"), list: el("div", "ev2-list"), pager: el("div", "ev2-pager") };
    refs.workspace.dataset.readingWorkspace = ""; refs.workspace.dataset.detailOpen = "false";
    refs.detail.dataset.stepDetail = ""; refs.detail.dataset.stepPanel = ""; refs.detail.hidden = true;
    refs.main.dataset.readingMain = "";
    root.append(refs.summary, refs.nav, refs.workspace); refs.workspace.append(refs.main, refs.detail);
    const tabs = el("div", "ev2-actions"), callsHost = el("section"), flowHost = el("section");
    const query = el("input"); refs.query = query; query.type = "search"; query.placeholder = t.search; query.setAttribute("aria-label", t.search); query.value = state.query; query.dataset.stepSearch = "";
    query.addEventListener("input", () => { state.query = query.value; state.page = 0; renderRows(); });
    callsHost.append(query, refs.list, refs.pager); refs.list.dataset[current.kind === "agent" ? "agentTrajectory" : "stepList"] = "";
    if (current.kind !== "agent") {
      refs.flow = el("div", "ev2-flow"); refs.flow.dataset.scopeDiagram = "";
      refs.definitionList = el("div"); refs.boundaries = el("div");
      refs.definitionList.dataset.definitionDirectory = ""; refs.boundaries.dataset.definitionEdges = "";
      flowHost.append(el("p", "ev2-muted", t.definition), refs.flow, refs.definitionList, refs.boundaries);
      for (const [mode, name] of [["flow", t.flow], ["steps", t.steps]]) {
        const control = button(name, () => { state.mode = mode; setMode(); }); control.dataset.readingMode = mode; tabs.append(control);
      }
      function setMode() {
        callsHost.hidden = state.mode !== "steps"; flowHost.hidden = state.mode !== "flow";
        for (const child of tabs.children) child.setAttribute("aria-pressed", String(child.dataset.readingMode === state.mode));
      }
      refs.setMode = setMode; setMode(); refs.main.append(tabs, flowHost, callsHost);
    } else refs.main.append(callsHost);
    root.append(attachments()); container.replaceChildren(root);
    showSummary(); renderNavigation(); renderRows(); renderFlow();
    if (saved?.edge) {
      const scope = current.definitions.find((entry) => entry.id === saved.edge.scopeId);
      const edge = scope?.edges?.find((entry) => entry.id === saved.edge.id);
      if (edge) showDefinitionEdge(scope, edge);
    } else if (saved?.selected) { state.selected = saved.selected; renderDetail(); }
    else if (current.kind === "agent") {
      const first = rows()[0]; if (first) { state.selected = { kind: first.kind, id: first.id }; renderRows(); renderDetail(); }
    }
    restoreReading(saved);
  }
  function update(value) {
    assertActive(); const projected = projectRunRecordV2Document(value, options);
    if (!projected.ok) throw errorFrom(projected.diagnostics);
    const json = JSON.stringify(projected.document.record, null, 2);
    current = projected.document; indexRecord(); explanation = explainRunRecordV2(current); originalJSON = json;
    state = { scopeId: null, definitionScopeId: null, selected: null, edge: null, query: "", page: 0, mode: current.kind === "workflow" ? "flow" : "steps", layout: "LR", viewports: Object.create(null), drawLarge: false, detailOpen: false, collectionPages: Object.create(null), definitionQueries: Object.create(null) };
    render();
  }
  update(input);
  const viewer = Object.freeze({
    get kind() { return current.kind; }, get document() { return current; }, get explanation() { return explanation; },
    get selectedStepId() { return state.selected?.kind === "invocation" ? state.selected.id : null; },
    get selectedGroupId() { return state.scopeId; },
    get selectedEnvelopeIndex() { return state.selected?.kind === "event" ? current.events.findIndex((event) => event.id === state.selected.id) : null; },
    get selectedEntity() { return state.selected ? { ...state.selected } : null; },
    selectStep, selectGroup, selectEvidence, selectEntity(reference) { return selectEntity(reference, false); }, update,
    destroy() { if (destroyed) return; destroyed = true; unregister?.(); root?.remove(); },
  });
  unregister = registerRunViewerState(viewer, {
    capture: captureReading,
    inspect: () => ({ schemaVersion: 2, kind: current.kind, runId: current.run.id, invocationCount: current.nodes.length, definitionCount: current.definitions.length, selectedEntity: state.selected, scopeId: state.scopeId }),
    setLocale(value) {
      assertActive(); if (!["en", "zh"].includes(value)) throw errorFrom([{ code: "viewer.invalid_locale", path: "root", message: "Expected locale en or zh.", severity: "error" }]);
      if (locale === value) return; const saved = captureReading(); locale = value; render(saved);
    },
  });
  return viewer;
}
