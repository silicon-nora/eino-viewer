// Reading-layout layer. The source-appropriate path or Agent trajectory owns
// the center; navigation and selected detail remain quiet supporting columns.
export const readingStyles = `
.eino-run-viewer{--erv-ink:#172536;--erv-muted:#526275;--erv-line:#D8E0E8;--erv-paper:#fff;--erv-ice:#F3F6FA;--erv-blue:#2758c7;border-radius:10px;font-size:14px}
.eino-run-viewer .erv-header{padding:14px 20px;border-top:3px solid var(--erv-blue)}
.eino-run-viewer h2{font-size:22px;line-height:1.35}.eino-run-viewer .erv-header h2{font-size:24px}
.eino-run-viewer .erv-muted,.eino-run-viewer .erv-eyebrow,.eino-run-viewer .erv-step small,.eino-run-viewer .erv-value-label,.eino-run-viewer .erv-evidence-link,.eino-run-viewer .erv-step-path,.eino-run-viewer .erv-group-children>summary{font-size:12px}
.eino-run-viewer pre{font-size:13px;line-height:1.6}.eino-run-viewer .erv-prose{font-size:14px;line-height:1.6}
.eino-run-viewer .erv-value-preview{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:6;max-height:9.6em;overflow:hidden}.eino-run-viewer .erv-prose.erv-value-preview{max-height:9.6em}
.eino-run-viewer .erv-preview-frame{margin-top:8px;padding:12px;border:1px solid var(--erv-line);border-radius:6px;background:var(--erv-ice);min-width:0}
.eino-run-viewer .erv-preview-frame>pre.erv-value-preview{margin:0;padding:0;border:0;border-radius:0;background:transparent;max-height:9.6em}
.eino-run-viewer .erv-summary{padding:14px 20px}.eino-run-viewer .erv-summary .erv-channels{gap:18px}
.eino-run-viewer .erv-global-summary{border-bottom:1px solid var(--erv-line)}
.eino-run-viewer .erv-global-summary>summary{padding:10px 20px;color:var(--erv-muted);font-size:12px}
.eino-run-viewer .erv-global-summary[data-local=false]>summary{display:none}
.eino-run-viewer .erv-global-summary .erv-summary{border-bottom:0}
.eino-run-viewer .erv-context{padding:10px 20px;background:var(--erv-paper)}
.eino-run-viewer .erv-breadcrumbs{margin-top:6px}.eino-run-viewer .erv-local-result{margin-top:10px;padding:12px 14px;background:var(--erv-ice)}
.eino-run-viewer .erv-body,.eino-run-viewer .erv-body[data-detail-open=false]{display:grid;grid-template-columns:minmax(0,1fr);align-items:start}
.eino-run-viewer .erv-reading-main{grid-row:1;min-width:0}.eino-run-viewer .erv-diagram{padding:14px;min-width:0;border-top:0}
.eino-run-viewer .erv-steps{grid-row:2;padding:14px;border-top:1px solid var(--erv-line);min-width:0}
.eino-run-viewer .erv-detail-panel{grid-row:3;min-width:0;border:0;border-top:1px solid var(--erv-line);background:var(--erv-paper)}
.eino-run-viewer .erv-detail-panel:not([open]){display:none}
.eino-run-viewer .erv-detail-panel>summary{display:none}
.eino-run-viewer .erv-detail{padding:14px;min-width:0}
.eino-run-viewer .erv-detail-header{display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:8px}
.eino-run-viewer .erv-detail-name{min-width:0}
.eino-run-viewer .erv-detail-header h2{font-size:18px}.eino-run-viewer .erv-detail-header button{flex-shrink:0;font-size:12px}
.eino-run-viewer .erv-detail .erv-channels{display:grid;grid-template-columns:1fr;gap:18px;margin-top:14px}
.eino-run-viewer .erv-list,.eino-run-viewer .erv-body[data-detail-open=false] .erv-list{display:grid;grid-template-columns:1fr;max-height:420px;overflow:auto;padding:3px;margin-top:10px}
.eino-run-viewer .erv-step{padding:8px 10px;font-size:14px}.eino-run-viewer .erv-step small{line-height:1.5}
.eino-run-viewer .erv-step-name{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:1.5}
.eino-run-viewer .erv-step-identity{display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;max-width:100%;font-family:ui-monospace,monospace}
.eino-run-viewer .erv-detail-header h2{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
.eino-run-viewer .erv-heading-fact{display:block;font:500 12px/1.6 "Avenir Next","PingFang SC",system-ui,sans-serif;color:var(--erv-muted);margin-top:4px}
.eino-run-viewer .erv-identity-value{margin-top:10px;font-size:12px;min-width:0}.eino-run-viewer .erv-identity-value>summary{color:var(--erv-muted);font-weight:500}
.eino-run-viewer .erv-identity-value .erv-prose{font:13px/1.6 ui-monospace,"SFMono-Regular",monospace}
.eino-run-viewer .erv-search-row{display:flex;align-items:center;gap:5px}.eino-run-viewer .erv-search-row input{min-width:0}.eino-run-viewer .erv-search-row button{font-size:12px;flex-shrink:0}
.eino-run-viewer .erv-search-label{font-size:12px}.eino-run-viewer .erv-filter-label{font-size:12px}
.eino-run-viewer .erv-steps>[data-group-directory]{margin-bottom:18px;font-size:12px}
.eino-run-viewer .erv-graph{height:420px;min-width:0}.eino-run-viewer .erv-graph[data-deferred=true],.eino-run-viewer .erv-graph[data-empty=true]{height:auto;min-height:180px;display:grid;place-content:center;gap:12px;text-align:center}
.eino-run-viewer .erv-graph svg text{font-size:13px;fill:var(--erv-ink)}
.eino-run-viewer .erv-value-actions{position:relative;gap:8px;min-height:32px;padding-bottom:18px}
.eino-run-viewer .erv-feedback,.eino-run-viewer .erv-feedback:empty{display:block;position:absolute;left:0;bottom:0;max-width:100%;font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.eino-run-viewer .erv-raw{padding:14px 20px}.eino-run-viewer .erv-value{margin-top:8px}.eino-run-viewer .erv-value-preview{margin-top:8px}
@container (min-width:768px){
 .eino-run-viewer .erv-body,.eino-run-viewer .erv-body[data-detail-open=false]{grid-template-columns:220px minmax(0,1fr)}
 .eino-run-viewer .erv-steps{grid-column:1;grid-row:1 / span 2;border-top:0;border-right:1px solid var(--erv-line)}
 .eino-run-viewer .erv-reading-main{grid-column:2;grid-row:1}.eino-run-viewer .erv-detail-panel{grid-column:2;grid-row:2;border-top:1px solid var(--erv-line)}
 .eino-run-viewer .erv-list,.eino-run-viewer .erv-body[data-detail-open=false] .erv-list{max-height:600px}
 .eino-run-viewer .erv-graph{height:500px}
}
@container (min-width:1200px){
 .eino-run-viewer .erv-body{grid-template-columns:240px minmax(0,1fr) 320px}
 .eino-run-viewer .erv-body[data-detail-open=false]{grid-template-columns:240px minmax(0,1fr)}
 .eino-run-viewer .erv-steps{grid-row:1}.eino-run-viewer .erv-detail-panel{grid-column:3;grid-row:1;border-top:0;border-left:1px solid var(--erv-line);max-height:760px;overflow:auto}
 .eino-run-viewer .erv-graph{height:560px}
}
@container (max-width:767px){
 .eino-run-viewer .erv-channels{grid-template-columns:1fr}.eino-run-viewer .erv-summary>.erv-channels>[data-run-channel=input]{padding:12px 0 0;border-left:0;border-top:1px solid var(--erv-line)}
 .eino-run-viewer .erv-header,.eino-run-viewer .erv-summary,.eino-run-viewer .erv-context,.eino-run-viewer .erv-raw{padding-left:14px;padding-right:14px}
 .eino-run-viewer .erv-evidence-controls{grid-template-columns:1fr}.eino-run-viewer .erv-graph{height:360px}
}
`;
