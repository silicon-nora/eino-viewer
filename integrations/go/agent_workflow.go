package einoworkflowsnapshot

import (
	"errors"
	"fmt"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/schema"
)

var (
	ErrNilAgentInput = errors.New("eino workflow snapshot: agent input is nil")
	ErrEmptyAgentRun = errors.New("eino workflow snapshot: agent run has no events")
)

// AgentWorkflowOptions names the run and optionally overrides node labels.
// Empty label fields keep source-backed kind and role labels.
type AgentWorkflowOptions struct {
	RunID        string
	WorkflowName string
	InputName    string
	DecisionName string
	ToolName     string
	AnswerName   string
	OutputName   string
}

// ProjectAgentRunToWorkflow projects one observed ADK Agent run into a user-visible
// WorkflowSnapshot. Agent events remain source evidence; only user input, actual
// tool calls, failures, and the assistant output become workflow nodes.
func ProjectAgentRunToWorkflow(input *schema.Message, events []*adk.AgentEvent, options AgentWorkflowOptions) (Snapshot, error) {
	if input == nil {
		return Snapshot{}, ErrNilAgentInput
	}
	if len(events) == 0 {
		return Snapshot{}, ErrEmptyAgentRun
	}
	runID := options.RunID
	if runID == "" {
		runID = "agent-run"
	}
	workflowName := options.WorkflowName
	if workflowName == "" {
		workflowName = "Agent execution"
	}
	inputName := optionLabel(options.InputName, fmt.Sprintf("schema.Message · %s", input.Role))
	outputName := options.OutputName
	if outputName == "" {
		outputName = options.AnswerName
	}
	outputName = optionLabel(outputName, fmt.Sprintf("schema.Message · %s", schema.Assistant))

	nodes := []Node{{
		ID:        "user-input",
		Name:      inputName,
		Component: "schema.Message",
		Kind:      NodeKindIO,
		Metadata:  JSONMap{"role": string(input.Role)},
	}}
	executions := []NodeExecution{{Path: []string{"user-input"}, Status: NodeStatusSuccess}}
	edges := []Edge{{From: "start", To: "user-input", Channels: []string{"control", "data"}}}
	frontier := []string{"user-input"}
	nodeIndexByID := map[string]int{"user-input": 0}
	toolNodeByCallID := map[string]int{}
	pendingEventIndexes := []int{}
	finalEventIndexes := []int{}
	toolSequence := 0
	failed := false
	connectFrontier := func(target string) {
		for _, source := range frontier {
			edges = append(edges, Edge{From: source, To: target, Channels: []string{"control", "data"}})
		}
	}
	attachEvidence := func(nodeIDs []string, eventIndexes []int) {
		if len(eventIndexes) == 0 {
			return
		}
		for _, nodeID := range nodeIDs {
			nodeIndex, ok := nodeIndexByID[nodeID]
			if !ok {
				continue
			}
			metadata := nodes[nodeIndex].Metadata
			indexes, _ := metadata["sourceEventIndexes"].([]int)
			metadata["sourceEventIndexes"] = append(indexes, eventIndexes...)
		}
	}

	for index, event := range events {
		if event == nil {
			return Snapshot{}, fmt.Errorf("agent event %d is nil", index)
		}
		sequence := index + 1
		if event.Err != nil {
			id := fmt.Sprintf("agent-error-%d", sequence)
			evidenceIndexes := append(append([]int{}, pendingEventIndexes...), sequence)
			nodes = append(nodes, Node{
				ID:        id,
				Name:      "Agent error",
				Component: "adk.AgentEvent",
				Kind:      NodeKindCPU,
				Metadata:  JSONMap{"sourceEventIndexes": evidenceIndexes},
			})
			connectFrontier(id)
			executions = append(executions, NodeExecution{Path: []string{id}, Status: NodeStatusFailed, ErrorMessage: event.Err.Error()})
			frontier = []string{id}
			failed = true
			break
		}
		if event.Output == nil || event.Output.MessageOutput == nil || event.Output.MessageOutput.Message == nil {
			pendingEventIndexes = append(pendingEventIndexes, sequence)
			continue
		}
		message := event.Output.MessageOutput.Message
		if len(message.ToolCalls) > 0 {
			nextFrontier := make([]string, 0, len(message.ToolCalls))
			for callIndex, call := range message.ToolCalls {
				toolSequence++
				name := call.Function.Name
				if name == "" {
					name = "tool"
				}
				callID := call.ID
				if callID == "" {
					callID = fmt.Sprintf("event-%d-call-%d", sequence, callIndex+1)
				}
				id := fmt.Sprintf("tool-call-%d", toolSequence)
				label := name
				if options.ToolName != "" {
					label = options.ToolName
				}
				if options.DecisionName != "" {
					label = fmt.Sprintf("%s · %s", options.DecisionName, name)
				}
				evidenceIndexes := append(append([]int{}, pendingEventIndexes...), sequence)
				nodes = append(nodes, Node{
					ID:        id,
					Name:      label,
					Component: "components.Tool",
					Kind:      NodeKindCPU,
					Metadata: JSONMap{
						"sourceEventIndexes": evidenceIndexes,
						"role":               string(message.Role),
						"toolName":           name,
						"toolCallId":         callID,
						"argumentsJson":      call.Function.Arguments,
					},
				})
				connectFrontier(id)
				executions = append(executions, NodeExecution{Path: []string{id}, Status: NodeStatusSuccess})
				nodeIndexByID[id] = len(nodes) - 1
				toolNodeByCallID[callID] = len(nodes) - 1
				nextFrontier = append(nextFrontier, id)
			}
			frontier = nextFrontier
			pendingEventIndexes = nil
			continue
		}
		if message.Role == schema.Tool {
			if nodeIndex, ok := toolNodeByCallID[message.ToolCallID]; ok {
				metadata := nodes[nodeIndex].Metadata
				indexes, _ := metadata["sourceEventIndexes"].([]int)
				metadata["sourceEventIndexes"] = append(indexes, sequence)
				metadata["resultRole"] = string(message.Role)
			} else {
				pendingEventIndexes = append(pendingEventIndexes, sequence)
			}
			continue
		}
		if message.Role == schema.Assistant {
			finalEventIndexes = append(finalEventIndexes, pendingEventIndexes...)
			finalEventIndexes = append(finalEventIndexes, sequence)
			pendingEventIndexes = nil
		}
	}

	if !failed && len(finalEventIndexes) > 0 {
		nodes = append(nodes, Node{
			ID:        "final-output",
			Name:      outputName,
			Component: "schema.Message",
			Kind:      NodeKindIO,
			Metadata: JSONMap{
				"role":               string(schema.Assistant),
				"sourceEventIndexes": finalEventIndexes,
			},
		})
		nodeIndexByID["final-output"] = len(nodes) - 1
		connectFrontier("final-output")
		edges = append(edges, Edge{From: "final-output", To: "end", Channels: []string{"control", "data"}})
		executions = append(executions, NodeExecution{Path: []string{"final-output"}, Status: NodeStatusSuccess})
	} else {
		if !failed {
			attachEvidence(frontier, pendingEventIndexes)
		}
		for _, source := range frontier {
			edges = append(edges, Edge{From: source, To: "end", Channels: []string{"control"}})
		}
	}

	return Snapshot{
		SchemaVersion: SchemaVersion,
		Workflow: Graph{
			Name:  workflowName,
			Nodes: nodes,
			Edges: edges,
			Metadata: JSONMap{
				"projection":  "agent-run-workflow",
				"sourceRunId": runID,
				"eventCount":  len(events),
			},
		},
		Execution: &Execution{ID: runID, Nodes: executions},
		Metadata: JSONMap{
			"projection": "agent-run-workflow",
			"source":     "adk.AgentEvent",
		},
	}, nil
}

func optionLabel(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
