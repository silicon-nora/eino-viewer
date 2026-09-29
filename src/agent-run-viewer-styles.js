// Agent records have one reading surface in every host. Keep these rules local
// to that surface: host navigation and Graph / Workflow layouts stay separate.
export const agentReaderStyles = `
.eino-agent-reader.eino-run-viewer {
  box-sizing: border-box;
  --ink: #172536;
  --ink-soft: #526275;
  --line: #d8e0e8;
  --line-strong: #91a3b4;
  --paper: #fff;
  --ice: #f3f6fa;
  --blue: #2758c7;
  --blue-deep: #183b8f;
  --cyan: #087d90;
  --danger: #c24f4a;
  --body: "Avenir Next", "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, -apple-system, sans-serif;
  --mono: "SFMono-Regular", "Cascadia Code", "Roboto Mono", ui-monospace, monospace;
  display: flex;
  flex-direction: column;
  min-width: 0;
  width: 100%;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  color: var(--ink);
  font: 14px/1.5 var(--body);
  font-synthesis: none;
  overflow: visible;
  container: eino-agent-reader / inline-size;
  color-scheme: light;
}
.eino-agent-reader *, .eino-agent-reader *::before, .eino-agent-reader *::after { box-sizing: border-box; }
.eino-agent-reader [hidden] { display: none !important; }
.eino-agent-reader :is(h2,h3,h4,p,ol,ul) { margin: 0; }
.eino-agent-reader :is(h2,h3,h4,strong) { color: var(--ink); }
.eino-agent-reader :is(button,input,select,textarea) { font: inherit; }
.eino-agent-reader button { max-width: 100%; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink); text-align: left; overflow-wrap: anywhere; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.eino-agent-reader button:hover:not(:disabled) { border-color: var(--blue); background: #eef3fd; }
.eino-agent-reader button:active:not(:disabled) { background: #e3ebfc; }
.eino-agent-reader button:disabled { color: var(--ink-soft); background: var(--ice); opacity: .6; cursor: not-allowed; }
.eino-agent-reader :is(button,input,select,textarea,summary,a,[tabindex]):focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }
.eino-agent-reader summary { cursor: pointer; overflow-wrap: anywhere; }
.eino-agent-reader :is(pre,code) { font-family: var(--mono); }
.eino-agent-reader pre { min-width: 0; max-width: 100%; max-height: none; margin: 8px 0; padding: 10px 12px; border: 0; border-radius: 4px; background: var(--ice); color: var(--ink); font: 13px/1.7 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; overflow: visible; }
.eino-agent-reader .agent-reader-header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; min-width: 0; padding: 16px 24px; border-bottom: 1px solid var(--line); border-radius: 12px 12px 0 0; }
.eino-agent-reader .agent-reader-header h2 { flex: 1 1 220px; min-width: 0; font: 650 16px/1.5 var(--body); overflow-wrap: anywhere; }
.eino-agent-reader .agent-run-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; color: var(--ink-soft); font: 12px/1.5 var(--body); }
.eino-agent-reader .agent-run-exception { padding: 4px 8px; border-color: #e4cbb0; border-radius: 4px; background: #fff8ed; color: #80521c; font: 600 12px/1.5 var(--body); }
.eino-agent-reader .agent-run-exception[data-agent-outcome="failed"] { border-color: #efd4d1; background: #fff4f1; color: #a1302b; }
.eino-agent-reader .agent-run-exception:hover:not(:disabled) { text-decoration: underline; }
.eino-agent-reader .run-duration, .eino-agent-reader .step-duration { color: var(--ink-soft); font: 12px/1.5 var(--mono); }
.eino-agent-reader .agent-reader-layout { display: grid; grid-template-columns: minmax(0, 1fr); align-content: stretch; align-items: stretch; flex: 1; min-width: 0; min-height: 0; }
.eino-agent-reader .agent-reader-main { display: block; grid-column: 1; grid-row: 1; min-width: 0; width: auto; max-width: none; margin: 0; padding: 24px; background: var(--paper); }
.eino-agent-reader .agent-reader-detail { grid-column: 1; grid-row: 2; align-self: stretch; min-width: 0; padding: 16px; border: 0; border-top: 1px solid var(--line); background: var(--paper); color: var(--ink); }
.eino-agent-reader .agent-reader-detail-content { min-width: 0; }
.eino-agent-reader .agent-reader-detail > header { display: flex; align-items: start; gap: 8px; padding-bottom: 12px; }
.eino-agent-reader .agent-reader-detail > header h2 { font: 650 14px/1.5 var(--body); }
.eino-agent-reader .agent-detail-heading { margin: 0; padding: 0 0 12px; font: 650 14px/1.5 var(--body); }
.eino-agent-reader .scope-breadcrumbs, .eino-agent-reader .hierarchy-breadcrumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; min-width: 0; margin: 0 0 16px; }
.eino-agent-reader .scope-breadcrumbs button, .eino-agent-reader .hierarchy-breadcrumbs button { padding: 5px 7px; font: 12px/1.5 var(--body); }
.eino-agent-reader .scope-breadcrumbs button + button::before, .eino-agent-reader .hierarchy-breadcrumbs button + button::before { content: "› "; color: var(--cyan); }
.eino-agent-reader .scope-breadcrumbs [aria-current], .eino-agent-reader .hierarchy-breadcrumbs [aria-current] { color: var(--blue-deep); border-color: var(--blue); }
.eino-agent-reader .agent-global-summary { min-width: 0; margin-bottom: 16px; border-bottom: 1px solid var(--line); }
.eino-agent-reader .agent-global-summary > summary { padding-bottom: 12px; color: var(--ink-soft); font: 13px/1.5 var(--body); }
.eino-agent-reader .agent-global-summary:not([open]) > :not(summary) { display: none; }
.eino-agent-reader .agent-reading-content { display: block; min-width: 0; padding: 0; margin: 0; border: 0; background: transparent; }
.eino-agent-reader .agent-reading-content > .scope-result-heading, .eino-agent-reader .agent-reading-content > .scope-result-state { margin: 0 0 12px; }
.eino-agent-reader .scope-result-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: start; gap: 10px; }
.eino-agent-reader .scope-result-heading h2 { font: 650 16px/1.5 var(--body); overflow-wrap: anywhere; }
.eino-agent-reader .scope-result-heading small, .eino-agent-reader .scope-result-hint, .eino-agent-reader .scope-path-note { color: var(--ink-soft); font: 12px/1.6 var(--body); }
.eino-agent-reader .scope-result-state { font: 650 13px/1.5 var(--body); }
.eino-agent-reader .scope-result-state[data-scope-result="failed"] { color: #a1302b; }
.eino-agent-reader .scope-result-state[data-scope-result="success"] { color: #14684f; }
.eino-agent-reader .trajectory-view { width: 100%; max-width: none; min-width: 0; margin: 0; }
.eino-agent-reader .trajectory-turn + .trajectory-turn { margin-top: 25px; }
.eino-agent-reader .trajectory-turn > h3 { margin: 0 0 9px; color: var(--ink-soft); font: 600 13px/1.5 var(--body); letter-spacing: 0; text-transform: none; }
.eino-agent-reader .trajectory-scope { display: block; margin-bottom: 6px; color: var(--ink-soft); font: 500 12px/1.5 var(--body); overflow-wrap: anywhere; }
.eino-agent-reader .trajectory-list { display: grid; clear: both; gap: 7px; margin: 0; padding: 0; list-style: none; }
.eino-agent-reader .trajectory-list > li { min-width: 0; margin-inline-start: min(calc(var(--trajectory-depth, 0) * var(--trajectory-indent-step, 28px)), 30%); }
.eino-agent-reader .trajectory-record { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 4px 12px; width: 100%; min-height: 76px; padding: 12px; border: 1px solid transparent; border-radius: 6px; background: #f7f9fc; color: var(--ink); text-align: left; transition: border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease; }
.eino-agent-reader .trajectory-record:hover:not(:disabled) { border-color: var(--line); background: #eef3fd; }
.eino-agent-reader .trajectory-record.linked { border-color: transparent; box-shadow: inset 3px 0 var(--cyan); }
.eino-agent-reader .trajectory-record.selected:not(:disabled) { border-color: var(--blue); background: #eef3fd; box-shadow: inset 3px 0 var(--blue); }
.eino-agent-reader .trajectory-record.failed { border-color: #efd4d1; background: #fff4f1; }
.eino-agent-reader .trajectory-sequence { display: block; grid-column: 1; grid-row: 1 / 3; align-self: start; padding-top: 3px; color: var(--ink-soft); font: 500 12px/1.5 var(--mono); }
.eino-agent-reader .trajectory-identity { display: grid; grid-column: 2; grid-row: 1; gap: 4px; min-width: 0; }
.eino-agent-reader .trajectory-identity strong { overflow: hidden; font: 650 14px/1.5 var(--body); text-overflow: ellipsis; white-space: nowrap; }
.eino-agent-reader .trajectory-identity small { color: var(--ink-soft); font: 12px/1.5 var(--body); overflow-wrap: anywhere; text-transform: none; }
.eino-agent-reader .trajectory-status { grid-column: 3; grid-row: 1; align-self: start; max-width: 140px; color: var(--ink-soft); font: 500 12px/1.5 var(--body); white-space: normal; text-transform: none; }
.eino-agent-reader .trajectory-status.failed { color: var(--danger); }
.eino-agent-reader .trajectory-status:is(.running,.incomplete,.cancelled) { color: #8a5419; }
.eino-agent-reader .trajectory-summary { display: -webkit-box; grid-column: 2 / -1; grid-row: 2; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; color: var(--ink-soft); font: 400 14px/1.65 var(--body); text-overflow: ellipsis; white-space: normal; overflow-wrap: anywhere; }
.eino-agent-reader .agent-boundary-row { border-radius: 6px; background: #f7f9fc; cursor: pointer; }
.eino-agent-reader .agent-boundary-row:hover { background: #eef3fd; box-shadow: inset 0 0 0 1px var(--line); }
.eino-agent-reader .agent-boundary-row:has(> .trajectory-record.linked) { box-shadow: inset 0 0 0 1px #087d9094, inset 3px 0 var(--cyan); }
.eino-agent-reader .agent-boundary-row:has(> .trajectory-record.selected) { background: #eef3fd; box-shadow: inset 0 0 0 1px var(--blue), inset 3px 0 var(--blue); }
.eino-agent-reader .agent-boundary-row > .trajectory-record, .eino-agent-reader .agent-boundary-row > .trajectory-record:is(:hover,.selected,.linked):not(:disabled) { min-height: 44px; border-color: transparent; background: transparent; box-shadow: none; }
.eino-agent-reader .agent-boundary-row:has(> .trajectory-record:focus-visible) { outline: 2px solid var(--blue); outline-offset: 3px; }
.eino-agent-reader .agent-boundary-row > .trajectory-record:focus-visible { outline: none; }
.eino-agent-reader .run-result-channel { min-width: 0; }
.eino-agent-reader .run-result-channel.input { border: 0; padding: 0; }
.eino-agent-reader .run-result-channel h3, .eino-agent-reader .run-result-issue h3 { margin: 0 0 7px; color: var(--ink-soft); font: 700 12px/1.4 var(--body); }
.eino-agent-reader .run-result-item + .run-result-item { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line); }
.eino-agent-reader .run-result-value { display: block; min-width: 0; max-width: 100%; max-height: none; margin: 8px 0; padding: 0; border: 0; background: transparent; overflow: visible; overflow-wrap: anywhere; white-space: pre-wrap; color: var(--ink); font: 500 14px/1.7 var(--body); }
.eino-agent-reader .run-result-value.structured-value { padding: 10px 12px; border-radius: 4px; background: var(--ice); font: 13px/1.7 var(--mono); }
.eino-agent-reader .run-result-preview { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 6; max-height: none; margin: 8px 0; padding: 0; border: 0; overflow: hidden; overflow-wrap: anywhere; white-space: pre-wrap; color: var(--ink); font: 500 14px/1.7 var(--body); }
.eino-agent-reader .run-result-preview.structured-value { padding: 10px 12px; border-radius: 4px; background: var(--ice); font: 13px/1.7 var(--mono); }
.eino-agent-reader :is(.run-result-item,.business-value):has(> .run-result-expanded[open]) > .run-result-preview { display: none; }
.eino-agent-reader .run-result-expanded > summary { padding: 6px 0; color: var(--blue); font: 500 12px/1.5 var(--body); }
.eino-agent-reader .run-result-expanded > .run-result-value { max-height: none; overflow: visible; }
.eino-agent-reader .run-result-channel.output > .run-result-item > .run-result-value:not(.structured-value) { font-size: 14px; line-height: 1.65; }
.eino-agent-reader .agent-reading-content .run-result-channel.agent-inline-value { padding: 0 16px 12px 52px; margin: 0; border: 0; }
.eino-agent-reader .agent-inline-value > :is(summary,h3) { display: none; }
.eino-agent-reader .agent-inline-value .run-result-value { cursor: text; }
.eino-agent-reader .agent-inline-value .run-copy-value { margin-top: 8px; }
.eino-agent-reader .agent-reading-content > .agent-boundary-value.input { margin: 0 0 24px; padding: 0; }
.eino-agent-reader .agent-boundary-value, .eino-agent-reader .agent-reading-content > :is(.run-result-issues,.run-issue-disclosure) { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line); }
.eino-agent-reader .agent-recorded-input { margin-bottom: 24px; padding: 16px; border-radius: 6px; background: #f7f9fc; }
.eino-agent-reader .agent-recorded-input > h3 { margin: 0 0 12px; font: 650 14px/1.5 var(--body); }
.eino-agent-reader button.run-copy-value { min-width: 100px; min-height: 32px; max-width: 100%; padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--blue); font: 600 12px/1.5 var(--body); text-align: center; white-space: normal; }
.eino-agent-reader button.run-copy-value:hover:not(:disabled) { color: var(--blue-deep); border-color: var(--blue); background: #eef3fd; }
.eino-agent-reader .agent-copy-actions { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 12px; min-width: 0; }
.eino-agent-reader .agent-copy-feedback { display: inline-block; flex: 0 0 76px; min-height: 18px; color: var(--ink-soft); font: 12px/1.5 var(--body); }
.eino-agent-reader .agent-selected-evidence { min-width: 0; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line); }
.eino-agent-reader .agent-selected-evidence h3 { margin: 0 0 8px; font: 650 14px/1.5 var(--body); }
.eino-agent-reader .business-value-expanded { min-width: 0; margin-top: 12px; }
.eino-agent-reader .business-value-expanded > summary { padding: 6px 0; color: var(--ink-soft); font: 500 12px/1.5 var(--body); }
.eino-agent-reader .run-value-state, .eino-agent-reader .business-value-state, .eino-agent-reader .run-channel-note { display: block; color: var(--ink-soft); font: 12px/1.5 var(--body); overflow-wrap: anywhere; }
.eino-agent-reader .run-result-issues { display: grid; gap: 12px; min-width: 0; margin: 0 0 12px; }
.eino-agent-reader .run-result-issue { min-width: 0; padding: 12px; border-left: 2px solid var(--danger); border-radius: 6px; background: #fff4f1; }
.eino-agent-reader .run-result-issue[data-recovered="true"], .eino-agent-reader .run-result-issue[data-run-issue="interruption"] { border-left-color: #c77a23; background: #fff9ef; }
.eino-agent-reader .run-issue-disclosure { color: var(--danger); font: 650 12px/1.6 var(--body); }
.eino-agent-reader .issue-locate { padding: 6px 10px; font: 600 12px/1.5 var(--body); }
.eino-agent-reader .node-detail { min-width: 0; min-height: 180px; max-height: none; overflow: visible; border: 0; border-radius: 8px; background: var(--paper); color: var(--ink); }
.eino-agent-reader .node-detail-content { min-width: 0; padding: 8px 0; }
.eino-agent-reader .node-detail-hero { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px 12px; padding-bottom: 15px; border-bottom: 1px solid var(--line); }
.eino-agent-reader .node-detail-hero small { grid-column: 1 / -1; color: var(--ink-soft); font: 700 12px/1.2 var(--mono); letter-spacing: normal; text-transform: uppercase; }
.eino-agent-reader .node-detail-hero h3 { margin: 0; color: var(--ink); font: 700 16px/1.25 var(--body); overflow-wrap: anywhere; }
.eino-agent-reader .node-detail-hero .step-state { margin: 10px 0 0; color: var(--ink-soft); font: 650 12px/1.5 var(--body); }
.eino-agent-reader .node-detail .step-state.failed, .eino-agent-reader .node-error { color: #a1302b; }
.eino-agent-reader .node-detail .step-state:is(.cancelled,.incomplete) { color: #80521c; }
.eino-agent-reader .trajectory-detail-values { display: grid; gap: 9px; min-width: 0; margin-top: 14px; }
.eino-agent-reader .trajectory-detail-value { min-width: 0; padding: 11px 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--ice); }
.eino-agent-reader .trajectory-detail-value > small { display: block; margin-bottom: 6px; color: var(--ink-soft); font: 700 12px/1.3 var(--mono); letter-spacing: normal; text-transform: uppercase; }
.eino-agent-reader .trajectory-detail-value > p { margin: 0; color: var(--ink); font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.eino-agent-reader .business-content { min-width: 0; }
.eino-agent-reader .business-value { min-width: 0; margin: 10px 0; }
.eino-agent-reader .business-value .run-result-value { color: var(--ink); font: 14px/1.75 var(--body); }
.eino-agent-reader .business-value pre.run-result-value { font: 13px/1.7 var(--mono); }
.eino-agent-reader .business-value .structured-value { background: var(--ice); }
.eino-agent-reader .agent-step-scope { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin: 8px 0 16px; padding: 0; border: 0; color: var(--ink-soft); }
.eino-agent-reader .agent-scope-label { flex: 0 0 auto; font: 12px/1.6 var(--body); }
.eino-agent-reader .agent-scope-call { display: flex; flex: 1 1 180px; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; min-width: 0; }
.eino-agent-reader .agent-scope-path { min-width: 0; overflow-wrap: anywhere; font: 12px/1.6 var(--body); }
.eino-agent-reader .agent-step-scope .agent-scope-action { display: inline; flex: 0 1 auto; width: auto; max-width: 100%; min-height: 0; padding: 0; border: 0; border-radius: 2px; background: transparent; color: var(--blue); text-align: left; font: 500 12px/1.6 var(--body); text-decoration: underline; text-underline-offset: 3px; }
.eino-agent-reader .agent-step-scope .agent-scope-action:hover { background: #eef3fd; }
.eino-agent-reader .explanation-channel { min-width: 0; padding-top: 13px; border-top: 1px solid var(--line); }
.eino-agent-reader .explanation-channel > h4 { margin: 0 0 8px; color: var(--ink-soft); font: 700 12px/1.4 var(--body); }
.eino-agent-reader .explanation-value { min-width: 0; margin-top: 8px; padding: 11px 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--ice); }
.eino-agent-reader .search-empty, .eino-agent-reader .agent-reader-empty { padding: 16px 0; color: var(--ink-soft); font: 14px/1.6 var(--body); overflow-wrap: anywhere; }
@container eino-agent-reader (min-width: 1200px) {
  .eino-agent-reader .agent-reader-layout:has(> .agent-reader-detail:not([hidden])) { grid-template-columns: minmax(0, 1fr) 320px; }
  .eino-agent-reader .agent-reader-detail { grid-column: 2; grid-row: 1; border-top: 0; border-left: 1px solid var(--line); }
  .eino-agent-reader .agent-reader-detail > .agent-reader-detail-content { position: sticky; top: 16px; }
}
@container eino-agent-reader (max-width: 767px) {
  .eino-agent-reader .agent-reader-header { padding: 12px 16px; }
  .eino-agent-reader .agent-reader-main { padding: 16px; }
  .eino-agent-reader .trajectory-list { --trajectory-indent-step: 12px; }
  .eino-agent-reader .trajectory-record { grid-template-columns: 20px minmax(0, 1fr) auto; gap: 4px 8px; padding: 10px 8px; }
  .eino-agent-reader .agent-reading-content .run-result-channel.agent-inline-value { padding: 0 12px 12px 36px; }
}
@media (prefers-reduced-motion: reduce) {
  .eino-agent-reader *, .eino-agent-reader *::before, .eino-agent-reader *::after { scroll-behavior: auto !important; transition: none !important; }
}
`;
