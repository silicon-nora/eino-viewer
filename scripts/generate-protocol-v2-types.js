import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// The schema is authoritative. This generator deliberately fails on unsupported
// schema shapes rather than silently weakening a newly introduced contract.
const root = new URL("../", import.meta.url);
const schema = JSON.parse(await readFile(new URL("protocol/v2/run-record.schema.json", root), "utf8"));
const check = process.argv.includes("--check");
const reference = (value) => value.$ref?.replace(/^#\/\$defs\//, "");

function tsType(value, indent = "") {
  if (value.$ref) return reference(value);
  if (Object.hasOwn(value, "const")) return JSON.stringify(value.const);
  if (value.enum) return value.enum.map((item) => JSON.stringify(item)).join(" | ");
  if (value.oneOf || value.anyOf) return (value.oneOf || value.anyOf).map((item) => tsType(item, indent)).join(" | ");
  if (Array.isArray(value.type)) return value.type.map((type) => tsType({ ...value, type }, indent)).join(" | ");
  switch (value.type) {
    case "null": return "null";
    case "boolean": return "boolean";
    case "string": return "string";
    case "integer":
    case "number": return "number";
    case "array": return `ReadonlyArray<${tsType(value.items, indent)}>`;
    case "object": {
      if (!value.properties) {
        if (!value.additionalProperties || value.additionalProperties === true) throw new Error("Unbounded object schema");
        return `{ readonly [key: string]: ${tsType(value.additionalProperties, indent)} }`;
      }
      const required = new Set(value.required || []);
      return `{\n${Object.entries(value.properties).map(([name, item]) => `${indent}  readonly ${name}${required.has(name) ? "" : "?"}: ${tsType(item, `${indent}  `)};`).join("\n")}\n${indent}}`;
    }
    default: throw new Error(`Unsupported TypeScript schema: ${JSON.stringify(value)}`);
  }
}

const goInitialisms = { id: "ID", ids: "IDs", io: "IO", json: "JSON", sha256: "SHA256" };
function goName(value) {
  const words = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^a-zA-Z0-9]+/);
  return words.map((word) => goInitialisms[word.toLowerCase()] || word[0].toUpperCase() + word.slice(1)).join("");
}

function combinedObject(value) {
  if (!(value.oneOf || value.anyOf)) return value;
  const variants = value.oneOf || value.anyOf;
  if (!variants.every((item) => item.type === "object")) return null;
  const properties = {};
  for (const item of variants) {
    for (const [key, property] of Object.entries(item.properties)) {
      if (!properties[key]) properties[key] = property;
      else if (JSON.stringify(properties[key]) !== JSON.stringify(property)) {
        const previous = properties[key];
        if ((Object.hasOwn(previous, "const") || previous.enum) && (Object.hasOwn(property, "const") || property.enum)) {
          properties[key] = { type: "string", enum: [...new Set([...(previous.enum || [previous.const]), ...(property.enum || [property.const])])] };
        } else throw new Error(`Unsupported union field: ${key}`);
      }
    }
  }
  return { type: "object", properties, required: Object.keys(properties).filter((key) => variants.every((item) => item.required?.includes(key))) };
}

function goType(value, named = false) {
  if (value.$ref) return reference(value);
  if (Object.hasOwn(value, "const")) {
    return typeof value.const === "number" ? "json.Number" : typeof value.const === "boolean" ? "bool" : "string";
  }
  if (Array.isArray(value.type)) return "json.RawMessage";
  const object = combinedObject(value);
  if (!object) throw new Error(`Unsupported Go union: ${JSON.stringify(value)}`);
  value = object;
  switch (value.type) {
    case "boolean": return "bool";
    case "string": return "string";
    case "integer": return "json.Number";
    case "number": return "json.Number";
    case "array": return `[]${goType(value.items)}`;
    case "object": {
      if (!value.properties) return `map[string]${goType(value.additionalProperties)}`;
      if (!named) throw new Error("An inline struct requires a named definition");
      const required = new Set(value.required || []);
      return `struct {\n${Object.entries(value.properties).map(([name, item]) => {
        const optional = !required.has(name);
        let type = goType(item);
        // RawMessage's nonempty bytes preserve explicit JSON null, while nil
        // means absent. A pointer would collapse those two observations.
        if (optional && type !== "JsonValue" && type !== "json.RawMessage") type = `*${type}`;
        const detail = item.enum ? ` // ${item.enum.join(" | ")}` : Object.hasOwn(item, "const") ? ` // Must equal ${JSON.stringify(item.const)}.` : "";
        return `\t${goName(name)} ${type} \`json:"${name}${optional ? ",omitempty" : ""}"\`${detail}`;
      }).join("\n")}\n}`;
    }
    default: throw new Error(`Unsupported Go schema: ${JSON.stringify(value)}`);
  }
}

const ts = [
  "// Code generated by scripts/generate-protocol-v2-types.js. DO NOT EDIT.",
  "/** Structural types only. Validate with the JSON Schema and semantic validator before use. */",
  `export type RunRecord = ${tsType(schema)};`,
  ...Object.entries(schema.$defs).map(([name, value]) => `export type ${name} = ${tsType(value)};`),
  "",
].join("\n\n").trimEnd() + "\n";

const goDefinitions = Object.entries(schema.$defs).map(([name, value]) => {
  if (name === "JsonValue") return "// JsonValue preserves arbitrary JSON, including explicit null and numeric precision.\ntype JsonValue = json.RawMessage";
  if (name === "JsonObject") return "type JsonObject map[string]JsonValue";
  if (name === "Number") return "// Number retains the original JSON numeric spelling; contract bounds are checked separately.\ntype Number = json.Number";
  if (value.type === "integer") return `// ${name} preserves numeric spelling (including integer-valued exponents); validate bounds separately.\ntype ${name} = json.Number`;
  const note = value.oneOf ? "// This tagged union must be checked by the authoritative schema and semantic validator.\n" : "";
  return `${note}type ${name} ${goType(value, true)}`;
});
const go = execFileSync("gofmt", { input: [
  "// Code generated by scripts/generate-protocol-v2-types.js. DO NOT EDIT.",
  "// Package protocolv2 provides lossless wire types, not a replacement for JSON Schema or semantic validation.",
  "package protocolv2",
  'import "encoding/json"',
  `type RunRecord ${goType(schema, true)}`,
  ...goDefinitions,
  "",
].join("\n\n"), encoding: "utf8" });

for (const [path, contents] of [["protocol/v2/types.d.ts", ts], ["integrations/go/protocolv2/types.go", go]]) {
  const url = new URL(path, root);
  if (check) {
    const current = await readFile(url, "utf8");
    if (current !== contents) throw new Error(`${path} differs from the schema; run node scripts/generate-protocol-v2-types.js`);
  } else await writeFile(url, contents);
  console.log(`${check ? "Checked" : "Generated"} ${fileURLToPath(url)}`);
}
