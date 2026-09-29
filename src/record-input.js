import { JSON_INPUT_LIMITS, findJSONValueIssues } from "./json-value.js";

// Private input boundary shared by the workbench and portable reader. Numeric
// checks happen on tokens before JSON.parse can discard their original digits.
function rejected(code, message, offset) {
  const error = new TypeError(message);
  error.code = code;
  error.diagnostics = [{ severity: "error", code, path: offset === undefined ? "JSON" : `JSON (character ${offset + 1})`, message }];
  return error;
}

export function assertRecordFileSize(bytes) {
  if (bytes > JSON_INPUT_LIMITS.maxBytes) {
    throw rejected("max_bytes_exceeded", "Record exceeds the 64 MiB input limit. The current record has not been changed.");
  }
}

export function inputFailureSummary(diagnostics, locale, hasAcceptedRecord = false) {
  const reasons = {
    unsafe_integer: ["Integer exceeds the exact range", "整数超出精确范围"],
    number_precision_loss: ["Number would lose precision", "数字精度无法保留"],
    non_json_number: ["Number is outside the supported range", "数字超出支持范围"],
    max_depth_exceeded: ["Record is nested too deeply", "记录嵌套过深"],
    max_values_exceeded: ["Record contains too many values", "记录内容数量过多"],
    max_bytes_exceeded: ["Record exceeds 64 MiB", "记录超过 64 MiB 限制"],
  };
  const code = diagnostics?.[0]?.code?.split(".").at(-1);
  const reason = reasons[code]?.[locale === "zh" ? 1 : 0];
  if (!reason) return undefined;
  return locale === "zh" ? `${reason}；${hasAcceptedRecord ? "当前结果已保留" : "记录未打开"}。`
    : `${reason}; ${hasAcceptedRecord ? "the current result is unchanged" : "the record was not opened"}.`;
}

function checkTextSize(text) {
  assertRecordFileSize(text.length);
  // Every UTF-16 code unit occupies at most three UTF-8 bytes. Count only when
  // necessary and stop at the bound, without allocating another file-size buffer.
  if (text.length * 3 <= JSON_INPUT_LIMITS.maxBytes) return;
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    assertRecordFileSize(bytes);
  }
}

function decimalIdentity(token) {
  const [, sign, integer, fraction = "", exponent = "0"] = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  const digits = `${integer}${fraction}`.replace(/^0+/, "");
  if (!digits) return "0";
  const significant = digits.replace(/0+$/, "");
  return `${sign}${significant}e${Number(exponent) - fraction.length + digits.length - significant.length}`;
}

export function parseRecordJSON(text) {
  if (typeof text !== "string") throw rejected("invalid_json", "Expected JSON text.");
  checkTextSize(text);
  const numberToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      // Numbers and brackets inside strings (including escaped quotes) are data.
      for (index += 1; index < text.length; index += 1) {
        if (text[index] === "\\") index += 1;
        else if (text[index] === '"') break;
      }
    } else if (char === "{" || char === "[") {
      depth += 1;
      if (depth > JSON_INPUT_LIMITS.maxDepth + 1) throw rejected("max_depth_exceeded", `Record exceeds the ${JSON_INPUT_LIMITS.maxDepth}-level nesting limit.`, index);
    } else if (char === "}" || char === "]") depth -= 1;
    else if (char === "-" || char >= "0" && char <= "9") {
      numberToken.lastIndex = index;
      const match = numberToken.exec(text);
      if (!match) continue; // JSON.parse supplies the syntax diagnostic.
      const token = match[0];
      const value = Number(token);
      if (!Number.isFinite(value)) throw rejected("non_json_number", "Number is outside the supported finite range.", index);
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        throw rejected("unsafe_integer", "Integer exceeds the exact supported range (-9007199254740991 to 9007199254740991). Its original digits were not changed or converted to text.", index);
      }
      // Equivalent decimal/exponent spellings are accepted. Extra significant
      // digits or underflow must not be silently discarded on import/format.
      if (decimalIdentity(token) !== decimalIdentity(JSON.stringify(value))) {
        throw rejected("number_precision_loss", "Number cannot retain its recorded decimal value. Its original digits were not changed or converted to text.", index);
      }
      index = numberToken.lastIndex - 1;
    }
  }
  let input;
  try { input = JSON.parse(text); }
  catch (error) { throw rejected("invalid_json", error.message); }
  const issues = findJSONValueIssues(input);
  if (issues.length) {
    const error = rejected(issues[0].code, issues[0].message);
    error.diagnostics = issues.map((issue) => ({ severity: "error", ...issue }));
    throw error;
  }
  return input;
}
