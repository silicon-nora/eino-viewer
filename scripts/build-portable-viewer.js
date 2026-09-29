import { build } from "vite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, ".artifacts/portable");

// This bootstrap is bundled as code, never with user data or example records.
function bootstrap(createEinoRunViewer, parseRecordJSON, assertRecordFileSize, inputFailureSummary, setRunViewerLocale) {
  const ui = {
    host: document.querySelector("#viewer"), file: document.querySelector("#record-file"),
    text: document.querySelector("#record-json"), apply: document.querySelector("#apply-record"),
    download: document.querySelector("#download-record"), status: document.querySelector("#import-status"),
    drop: document.querySelector("#drop-record"), locale: document.querySelector("#locale"),
    editor: document.querySelector("#import-editor"), editorLabel: document.querySelector("#import-editor-label"),
    shell: document.querySelector(".portable-shell"), errorDetails: document.querySelector("#import-error"), errorText: document.querySelector("#import-error-text"),
  };
  let viewer;
  let acceptedText;
  let acceptedInput;
  let acceptedName = "run-record.json";
  let revision = 0;
  let importState = { kind: "ready", error: false, detail: "" };
  const messages = {
    zh: { ready: "也可拖放 JSON 文件", opened: "已打开", rejected: "未打开新记录；当前结果已保留。", failed: "无法打开记录。", reading: "正在读取…", copied: "已导出原始记录。", file: "选择 JSON 文件", paste: "粘贴 JSON", open: "打开记录", replace: "更换记录", apply: "打开记录", download: "导出原始记录", title: "Eino 结果阅读器", privacy: "导出包含原始数据，请检查私密信息。", invalid: "请选择一个 JSON 文件。", errorDetails: "错误详情", language: "语言" },
    en: { ready: "You can also drop a JSON file", opened: "Opened", rejected: "The new record was not opened; the current result is unchanged.", failed: "Unable to open record.", reading: "Reading…", copied: "Original record exported.", file: "Choose JSON file", paste: "Paste JSON", open: "Open record", replace: "Change record", apply: "Open record", download: "Export original record", title: "Eino result reader", privacy: "Exports include the original data. Check for private information.", invalid: "Choose one JSON file.", errorDetails: "Error details", language: "Language" },
  };
  const copy = () => messages[ui.locale.value];
  function renderStatus({ preserveDisclosure = false } = {}) {
    const previousOpen = ui.errorDetails.open;
    const { kind, error, detail, diagnostics } = importState;
    const message = kind === "failure"
      ? inputFailureSummary(diagnostics, ui.locale.value, acceptedText !== undefined) || (acceptedText === undefined ? copy().failed : copy().rejected)
      : kind === "opened" ? `${copy().opened} · ${acceptedName}` : copy()[kind];
    ui.status.textContent = message;
    ui.status.title = message;
    ui.status.dataset.error = String(error);
    ui.errorDetails.hidden = !detail;
    ui.errorDetails.open = preserveDisclosure ? previousOpen : false;
    ui.errorText.textContent = detail;
  }
  function status(kind, error = false, detail = "", diagnostics) {
    importState = { kind, error, detail, diagnostics };
    renderStatus();
  }
  function apply(text, name, request = ++revision) {
    if (request !== revision) return false;
    try {
      const input = parseRecordJSON(text);
      if (viewer) viewer.update(input);
      else viewer = createEinoRunViewer(ui.host, input, { locale: ui.locale.value });
      acceptedText = text;
      acceptedInput = input;
      acceptedName = name || "run-record.json";
      ui.download.disabled = false;
      status("opened");
      ui.host.hidden = false;
      ui.shell.dataset.recordLoaded = "true";
      ui.editor.open = false;
      ui.editorLabel.textContent = copy().replace;
      // The import form has just folded. Keep keyboard focus in the accepted
      // result, without a scroll jump or changing any evidence selection.
      ui.host.querySelector("[data-run-title]")?.focus({ preventScroll: true });
      return true;
    } catch (error) {
      status("failure", true, error.diagnostics?.map((item) => `${item.path}: ${item.message}`).join("\n") || error.message, error.diagnostics);
      return false;
    }
  }
  async function importFile(file) {
    if (!file) return;
    const request = ++revision;
    status("reading");
    try {
      assertRecordFileSize(file.size);
      const text = await file.text();
      if (request !== revision) return;
      if (apply(text, file.name, request)) ui.text.value = text;
    } catch (error) { if (request === revision) status("failure", true, error.message, error.diagnostics); }
  }
  ui.file.addEventListener("change", () => {
    const file = ui.file.files?.[0];
    ui.file.value = "";
    importFile(file);
  });
  ui.apply.addEventListener("click", () => apply(ui.text.value, "run-record.json"));
  ui.drop.addEventListener("dragover", (event) => { event.preventDefault(); });
  ui.drop.addEventListener("drop", (event) => {
    event.preventDefault();
    // Every attempt supersedes an earlier asynchronous file read, including an
    // attempt rejected before reading a file.
    revision += 1;
    if (event.dataTransfer?.files.length !== 1) { status("invalid", true); return; }
    importFile(event.dataTransfer.files[0]);
  });
  ui.download.addEventListener("click", () => {
    if (acceptedText === undefined) return;
    const url = URL.createObjectURL(new Blob([acceptedText], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = acceptedName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
    document.body.append(link);
    link.click();
    link.remove();
    // Give the browser a turn to acquire the download before releasing the URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status("copied");
  });
  function translate() {
    document.documentElement.lang = ui.locale.value;
    for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = copy()[element.dataset.i18n];
    ui.editorLabel.textContent = acceptedText === undefined ? copy().open : copy().replace;
    if (acceptedInput !== undefined) {
      setRunViewerLocale(viewer, ui.locale.value);
    }
    renderStatus({ preserveDisclosure: true });
  }
  ui.locale.addEventListener("change", translate);
  translate();
}

const virtualEntry = "\0eino-portable-entry";
const entryPath = resolve(root, "__eino_portable_entry__.js");
const result = await build({
  configFile: false,
  logLevel: "warn",
  plugins: [{
    name: "eino-portable-entry",
    resolveId(id) { if (id === entryPath) return virtualEntry; },
    load(id) {
      if (id === virtualEntry) return `import { createEinoRunViewer } from ${JSON.stringify(resolve(root, "src/run-viewer.js"))};\nimport { parseRecordJSON, assertRecordFileSize, inputFailureSummary } from ${JSON.stringify(resolve(root, "src/record-input.js"))};\nimport { setRunViewerLocale } from ${JSON.stringify(resolve(root, "src/run-viewer-state.js"))};\n(${bootstrap.toString()})(createEinoRunViewer, parseRecordJSON, assertRecordFileSize, inputFailureSummary, setRunViewerLocale);`;
    },
  }],
  build: {
    write: false, target: "es2022", minify: true, sourcemap: false,
    lib: { entry: entryPath, name: "EinoPortableViewer", formats: ["iife"] },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const chunks = (Array.isArray(result) ? result.flatMap((item) => item.output) : result.output);
if (chunks.some((chunk) => chunk.type !== "chunk") || chunks.length !== 1 || chunks[0].imports.length || chunks[0].dynamicImports.length) {
  throw new Error("Portable viewer must contain exactly one self-contained JavaScript bundle.");
}
const javascript = chunks[0].code.replace(/<\/script/gi, "<\\/script");
const scriptHash = createHash("sha256").update(javascript).digest("base64");
const rendererCSS = readFileSync(resolve(root, "node_modules/eino-workflow-dag/dist/eino-workflow-dag.css"), "utf8");
const notices = ["LICENSE", "THIRD_PARTY_NOTICES.md"].map((name) => readFileSync(resolve(root, name), "utf8"));
notices.push(readFileSync(resolve(root, "node_modules/eino-workflow-dag/LICENSE"), "utf8"));
notices.push(readFileSync(resolve(root, "node_modules/eino-workflow-dag/THIRD_PARTY_NOTICES.md"), "utf8"));
notices.push(`Cytoscape.js (bundled dependency)\n\n${readFileSync(resolve(root, "node_modules/cytoscape/LICENSE"), "utf8")}`);
const licenseText = notices.join("\n\n---\n\n");
const escapedLicenses = licenseText.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Eino · Static result viewer</title><style>
*{box-sizing:border-box}body{margin:0;color:#172536;background:#eef4f7;font:14px/1.55 "Avenir Next","PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif}.portable-shell{max-width:1300px;margin:0 auto;padding:20px 24px 40px}.portable-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px}.portable-header h1{font:700 28px/1.15 "Avenir Next Condensed","DIN Alternate","Arial Narrow",sans-serif;margin:4px 0 8px}.portable-header p{margin:6px 0}.portable-header>label{font-size:12px;flex-shrink:0}.brand{font:600 11px/1.4 ui-monospace,monospace;letter-spacing:.12em;color:#2758c7}.muted{color:#526275}button,select,textarea,input{font:inherit}button,select{border:1px solid #91a3b4;background:white;color:#172536;border-radius:6px;padding:8px 12px;cursor:pointer}button:disabled{opacity:.5;cursor:default}:is(button,select,textarea,input,summary):focus-visible{outline:3px solid #2758c770;outline-offset:3px}summary{cursor:pointer}#drop-record{background:#fff;border:1px solid #cfd9e2;border-radius:10px;padding:16px;margin-bottom:16px}.import-tools{display:flex;gap:16px;align-items:flex-start}.import-tools>details{flex:1;min-width:0}.import-tools>button{font-size:12px;flex-shrink:0}.import-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:16px}.import-row label{display:grid;gap:6px;min-width:0}#import-editor>summary{font-weight:650;padding:6px 0}#import-editor p{font-size:12px}input[type=file]{max-width:100%}.paste-label{display:block;margin-top:16px;color:#526275;font-size:12px}textarea{display:block;width:100%;min-height:120px;margin:6px 0 10px;resize:vertical;border:1px solid #cfd9e2;border-radius:6px;padding:10px;font:12px/1.6 ui-monospace,monospace}#import-status{font-size:12px;overflow-wrap:anywhere;margin:8px 0 0}#import-status[data-error=true]{color:#983d38}.primary{background:#2758c7;color:#fff;border-color:#2758c7}[hidden]{display:none!important}footer{margin-top:18px;font-size:12px;color:#526275}footer details{margin-top:12px}.portable-shell[data-record-loaded=true] .brand,.portable-shell[data-record-loaded=true] [data-i18n=subtitle]{display:none}.portable-shell[data-record-loaded=true] .portable-header{align-items:center;margin-bottom:12px}.portable-shell[data-record-loaded=true] .portable-header h1{font-size:24px;margin:0}.portable-shell[data-record-loaded=true] #drop-record{padding:10px 14px;margin-bottom:12px}.portable-shell[data-record-loaded=true] #import-status[data-error=false]{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:600px){.portable-shell{padding:14px 12px}.portable-header h1{font-size:26px}.portable-shell[data-record-loaded=true] .portable-header h1{font-size:24px}.portable-header>label{display:grid;gap:2px}.portable-header select{padding:5px 8px}.import-tools{gap:8px}.import-tools>button{padding:7px 8px}}
.portable-header{align-items:center;margin-bottom:12px}.portable-header h1{font-size:24px;margin:0}#drop-record{padding:10px 14px;margin-bottom:12px}.import-row{margin-top:10px}#paste-editor>summary{margin-top:12px}#import-error{margin-top:8px;font-size:12px;color:#983d38}#import-error pre{max-height:200px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,monospace}
body{background:#F3F6FA}.portable-shell textarea,#import-error pre{font-size:13px}button,select,textarea,#drop-record{border-color:#D8E0E8}
${rendererCSS}
</style></head><body><main class="portable-shell"><header class="portable-header"><h1 data-i18n="title"></h1><label><span data-i18n="language"></span> <select id="locale"><option value="zh">中文</option><option value="en">English</option></select></label></header>
<section id="drop-record" aria-label="Import saved record"><div class="import-tools"><details id="import-editor" open><summary id="import-editor-label"></summary><div class="import-row"><label><span data-i18n="file"></span> <input id="record-file" type="file" accept=".json,application/json"></label></div><details id="paste-editor"><summary class="paste-label" data-i18n="paste"></summary><textarea id="record-json" aria-label="JSON record" spellcheck="false"></textarea><button id="apply-record" class="primary" data-i18n="apply"></button></details></details><button id="download-record" disabled data-i18n="download"></button></div><p id="import-status" role="status" aria-live="polite"></p><details id="import-error" hidden><summary data-i18n="errorDetails"></summary><pre id="import-error-text"></pre></details></section>
<div id="viewer" hidden></div><footer><p data-i18n="privacy"></p><details><summary>Open-source licenses</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapedLicenses}</pre></details></footer></main><script>${javascript}</script></body></html>`;
mkdirSync(output, { recursive: true });
const path = resolve(output, "eino-viewer.html");
writeFileSync(path, html);
// Also provide a text copy; the same notices are embedded in the portable HTML.
writeFileSync(resolve(output, "LICENSES.txt"), licenseText);
console.log(`OK: offline viewer ${path} (${Buffer.byteLength(html)} bytes); open the HTML directly, without a server.`);
