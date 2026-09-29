import {
  createEinoDAGEnvelope,
  createEinoDAGViewRegistry,
  projectEinoDAGEnvelopes,
  buildExecutionDAG,
  createExecutionDAGBuilder,
  buildExecutionTrajectory,
  createExecutionTrajectoryBuilder,
  EinoViewerError,
  createEinoRunViewer,
  createRunInspectionIndex,
  executionDAGToWorkflowSnapshot,
  explainEino,
  explainEinoEnvelope,
  explainExecutionDAG,
  type ExecutionDAG,
  type ExecutionDAGNodeStatus,
  type EinoExplanation,
  type EinoRunSummary,
  type AgentEventEnvelope,
  type EinoDAGViewResult,
} from "../src/index.js";

const agent: AgentEventEnvelope = createEinoDAGEnvelope({
  kind: "agent.event",
  kindVersion: 1,
  payload: { agentName: "assistant" },
});
const result: EinoDAGViewResult = createEinoDAGViewRegistry([]).project(agent);
projectEinoDAGEnvelopes([agent]).byRun;
const execution = buildExecutionDAG([agent]);
if (execution.ok) {
  const dag: ExecutionDAG = execution.dag;
  executionDAGToWorkflowSnapshot(dag);
  const explained = explainExecutionDAG(dag, [agent], { locale: "en" });
  if (explained.ok) {
    const explanation: EinoExplanation = explained.explanation;
    explanation.nodes[0]?.input.items[0]?.evidenceEnvelopeIndexes;
    const summary: EinoRunSummary = explanation.run;
    summary.output.items[0]?.availability;
    summary.issues[0]?.evidenceEnvelopeIndexes;
    summary.capture.status;
  }
}
const trajectory = buildExecutionTrajectory([agent]);
if (trajectory.ok) trajectory.trajectory.records[0]?.evidence;
explainEino([agent], { locale: "zh" });
explainEinoEnvelope(agent, { envelopeIndex: 0 });
createExecutionDAGBuilder().append(agent);
createExecutionTrajectoryBuilder().append(agent);
const viewerError: EinoViewerError = new EinoViewerError("viewer.sample", "sample");
viewerError.diagnostics;
void result;
const incompleteStep: ExecutionDAGNodeStatus = "incomplete";
const cancelledStep: ExecutionDAGNodeStatus = "cancelled";
void incompleteStep;
void cancelledStep;
const completeViewer = createEinoRunViewer(document.createElement("div"), {}, { locale: "zh", pageSize: 25,
  onNodeClick({ id, node }) { void id; void node; },
  onEvidenceClick({ envelopeIndex, envelope }) { void envelopeIndex; void envelope; },
});
completeViewer.selectStep("node-1");
completeViewer.selectEvidence(0);
completeViewer.update({});
completeViewer.destroy();
const inspection = createRunInspectionIndex(completeViewer.explanation, completeViewer.document.evidence);
inspection.searchSteps("tool", { issuesOnly: true, offset: 50 }).items[0]?.timing.durationMs;
inspection.searchEvidence("component.io", { scope: "unassigned" }).items[0]?.nodeIds;
