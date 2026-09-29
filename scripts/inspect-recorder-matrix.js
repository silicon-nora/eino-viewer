import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assessRecorderMatrix } from "./recorder-matrix.js";

const cases = assessRecorderMatrix();
const errors = cases.flatMap((entry) => entry.findings.filter(({ severity }) => severity === "error"));
const limitations = cases.flatMap((entry) => entry.findings.filter(({ severity }) => severity === "limitation"));
const directory = fileURLToPath(new URL("../.artifacts/recorder-matrix/", import.meta.url));
mkdirSync(directory, { recursive: true });
const result = { schemaVersion: 1, captureAccepted: cases.every(({ accepted }) => accepted), displayFidelity: errors.length ? "needs-work" : limitations.length ? "passed-with-limitations" : "passed", cases };
writeFileSync(`${directory}assessment.json`, `${JSON.stringify(result, null, 2)}\n`);
const lines = [
  "# Real Recorder static-display assessment", "",
  `Capture/transport: ${result.captureAccepted ? "accepted" : "rejected"}. Static display fidelity: **${result.displayFidelity}**.`, "",
  "Passing transport tests does not mean a truthful or complete display. Known limitations and mismatches are listed below.", "",
  "| Scenario | Run result | Capture | Evidence | Display findings |", "| --- | --- | --- | --- | --- |",
  ...cases.map((entry) => `| ${entry.id} | ${entry.completion?.outcome ?? "not recorded"} | ${entry.completion?.capture ?? "not recorded"} | ${entry.evidenceCount} | ${entry.findings.map(({ code }) => code).join(", ") || "none detected"} |`),
  "", "## Findings", "",
  ...cases.flatMap((entry) => entry.findings.map((finding) => `- ${entry.id} / ${finding.severity} / ${finding.code}${finding.affectedViews ? ` [${finding.affectedViews.join(", ")}]` : ""}: ${finding.detail}`)),
  "", "Scope: real local Eino runs, deterministic model doubles, no paid provider calls. A clean result here is not a claim of exhaustive coverage.", "",
];
writeFileSync(`${directory}assessment.md`, lines.join("\n"));
console.log(lines.join("\n"));
console.log(`Report: ${directory}assessment.json`);
// Normal mode is an assessment tool. Strict mode is an explicit fidelity
// gate; it fails on known mismatches instead of silently treating them as passed.
if (!result.captureAccepted || (process.argv.includes("--strict") && errors.length)) process.exitCode = 1;
