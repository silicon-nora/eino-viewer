// Package einoworkflowsnapshot records Eino Agent, Graph, and Workflow runs and
// projects them into JSON-safe documents consumed by eino-viewer.
package einoworkflowsnapshot

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/cloudwego/eino/compose"
)

const SchemaVersion = 1

var (
	ErrNilGraphInfo       = errors.New("eino workflow snapshot: GraphInfo is nil")
	ErrRecursiveGraphInfo = errors.New("eino workflow snapshot: recursive GraphInfo")
	ErrInvalidNodeKind    = errors.New("eino workflow snapshot: invalid node kind")
)

// Snapshot is the schema-versioned document accepted by eino-workflow-dag.
type Snapshot struct {
	SchemaVersion int        `json:"schemaVersion"`
	Workflow      Graph      `json:"workflow"`
	Execution     *Execution `json:"execution,omitempty"`
	Metadata      JSONMap    `json:"metadata,omitempty"`
}

type JSONMap map[string]any

type Graph struct {
	Name     string   `json:"name,omitempty"`
	Nodes    []Node   `json:"nodes"`
	Edges    []Edge   `json:"edges"`
	Branches []Branch `json:"branches,omitempty"`
	Metadata JSONMap  `json:"metadata,omitempty"`
}

type Node struct {
	ID        string   `json:"id"`
	Name      string   `json:"name,omitempty"`
	Component string   `json:"component,omitempty"`
	Kind      NodeKind `json:"kind,omitempty"`
	Workflow  *Graph   `json:"workflow,omitempty"`
	Metadata  JSONMap  `json:"metadata,omitempty"`
}

// NodeKind is a stable visual-semantic category for a workflow node.
type NodeKind string

const (
	NodeKindLLM    NodeKind = "llm"
	NodeKindIO     NodeKind = "io"
	NodeKindCPU    NodeKind = "cpu"
	NodeKindBranch NodeKind = "branch"
	NodeKindMerge  NodeKind = "merge"
	NodeKindGraph  NodeKind = "graph"
)

// NodeKindResolver maps an Eino node path to an application-known node kind.
// The path contains IDs from the root graph through the current node. Returning
// false leaves kind absent so the renderer can fall back to component mapping.
type NodeKindResolver func(path []string, node compose.GraphNodeInfo) (kind NodeKind, ok bool)

// ProjectOptions configures projection of optional protocol fields.
type ProjectOptions struct {
	ResolveNodeKind NodeKindResolver
}

type Edge struct {
	From     string         `json:"from"`
	To       string         `json:"to"`
	Channels []string       `json:"channels"`
	Mappings []FieldMapping `json:"mappings,omitempty"`
	Metadata JSONMap        `json:"metadata,omitempty"`
}

type FieldMapping struct {
	FromPath []string `json:"fromPath"`
	ToPath   []string `json:"toPath"`
	Metadata JSONMap  `json:"metadata,omitempty"`
}

type Branch struct {
	From     string   `json:"from"`
	Targets  []string `json:"targets"`
	Metadata JSONMap  `json:"metadata,omitempty"`
}

type Execution struct {
	ID           string          `json:"id,omitempty"`
	StartedAtMS  *int64          `json:"startedAtMs,omitempty"`
	FinishedAtMS *int64          `json:"finishedAtMs,omitempty"`
	DurationMS   *float64        `json:"durationMs,omitempty"`
	Nodes        []NodeExecution `json:"nodes,omitempty"`
	Metadata     JSONMap         `json:"metadata,omitempty"`
}

// NodeStatus is a final node execution outcome in EinoWorkflowSnapshot.
type NodeStatus string

const (
	NodeStatusSuccess NodeStatus = "success"
	NodeStatusFailed  NodeStatus = "failed"
	NodeStatusSkipped NodeStatus = "skipped"
)

type NodeExecution struct {
	Path         []string   `json:"path"`
	Status       NodeStatus `json:"status"`
	StartedAtMS  *int64     `json:"startedAtMs,omitempty"`
	FinishedAtMS *int64     `json:"finishedAtMs,omitempty"`
	DurationMS   *float64   `json:"durationMs"`
	Metrics      JSONMap    `json:"metrics,omitempty"`
	ErrorMessage string     `json:"errorMessage,omitempty"`
}

// Project creates a deterministic topology snapshot from Eino's GraphInfo.
// Execution and application metadata can be attached to the returned value.
func Project(info *compose.GraphInfo) (Snapshot, error) {
	return project(info, ProjectOptions{}, false)
}

// ProjectWithOptions creates a schema version 1 snapshot with optional node
// kinds. Nested workflows are always kind "graph"; ResolveNodeKind supplies
// kinds for all other nodes.
func ProjectWithOptions(info *compose.GraphInfo, options ProjectOptions) (Snapshot, error) {
	return project(info, options, true)
}

// Marshal projects GraphInfo and serializes the result as JSON.
func Marshal(info *compose.GraphInfo) ([]byte, error) {
	snapshot, err := Project(info)
	if err != nil {
		return nil, err
	}
	return json.Marshal(snapshot)
}

// MarshalWithOptions projects optional node kinds and serializes the snapshot.
func MarshalWithOptions(info *compose.GraphInfo, options ProjectOptions) ([]byte, error) {
	snapshot, err := ProjectWithOptions(info, options)
	if err != nil {
		return nil, err
	}
	return json.Marshal(snapshot)
}

func project(info *compose.GraphInfo, options ProjectOptions, includeKind bool) (Snapshot, error) {
	if info == nil {
		return Snapshot{}, ErrNilGraphInfo
	}

	workflow, err := projectGraph(
		info,
		make(map[*compose.GraphInfo]bool),
		nil,
		options,
		includeKind,
	)
	if err != nil {
		return Snapshot{}, err
	}

	return Snapshot{SchemaVersion: SchemaVersion, Workflow: workflow}, nil
}

func projectGraph(
	info *compose.GraphInfo,
	visiting map[*compose.GraphInfo]bool,
	prefix []string,
	options ProjectOptions,
	includeKind bool,
) (Graph, error) {
	if info == nil {
		return Graph{}, ErrNilGraphInfo
	}
	if visiting[info] {
		return Graph{}, ErrRecursiveGraphInfo
	}
	visiting[info] = true
	defer delete(visiting, info)

	graph := Graph{
		Name:  info.Name,
		Nodes: make([]Node, 0, len(info.Nodes)),
		Edges: make([]Edge, 0),
	}

	nodeIDs := sortedMapKeys(info.Nodes)
	for _, id := range nodeIDs {
		nodeInfo := info.Nodes[id]
		path := append(append([]string(nil), prefix...), id)
		node := Node{
			ID:        id,
			Name:      nodeInfo.Name,
			Component: fmt.Sprint(nodeInfo.Component),
		}
		if nodeInfo.GraphInfo != nil {
			if includeKind {
				node.Kind = NodeKindGraph
			}
			nested, err := projectGraph(nodeInfo.GraphInfo, visiting, path, options, includeKind)
			if err != nil {
				return Graph{}, fmt.Errorf("node %q: %w", id, err)
			}
			node.Workflow = &nested
		} else if includeKind && options.ResolveNodeKind != nil {
			kind, ok := options.ResolveNodeKind(append([]string(nil), path...), nodeInfo)
			if ok {
				if !validNodeKind(kind) || kind == NodeKindGraph {
					encodedPath, _ := json.Marshal(path)
					return Graph{}, fmt.Errorf("%w at node path %s: %q", ErrInvalidNodeKind, encodedPath, kind)
				}
				node.Kind = kind
			}
		}
		graph.Nodes = append(graph.Nodes, node)
	}

	type pair struct{ from, to string }
	edges := make(map[pair]*Edge)
	addChannel := func(from, to, channel string) {
		key := pair{from: from, to: to}
		edge := edges[key]
		if edge == nil {
			edge = &Edge{From: from, To: to, Channels: make([]string, 0, 2)}
			edges[key] = edge
		}
		for _, existing := range edge.Channels {
			if existing == channel {
				return
			}
		}
		edge.Channels = append(edge.Channels, channel)
	}

	projectDependencies(info.Edges, "control", addChannel)
	projectDependencies(info.DataEdges, "data", addChannel)

	for _, target := range nodeIDs {
		nodeInfo := info.Nodes[target]
		for _, mapping := range nodeInfo.Mappings {
			if mapping == nil || mapping.FromNodeKey() == "" {
				continue
			}
			key := pair{from: mapping.FromNodeKey(), to: target}
			edge := edges[key]
			if edge == nil || !contains(edge.Channels, "data") {
				return Graph{}, fmt.Errorf(
					"node %q has a field mapping from %q without a data edge",
					target,
					mapping.FromNodeKey(),
				)
			}
			edge.Mappings = append(edge.Mappings, FieldMapping{
				FromPath: clonePath(mapping.FromPath()),
				ToPath:   clonePath(mapping.ToPath()),
			})
		}
	}

	keys := make([]pair, 0, len(edges))
	for key := range edges {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].from != keys[j].from {
			return keys[i].from < keys[j].from
		}
		return keys[i].to < keys[j].to
	})
	for _, key := range keys {
		edge := edges[key]
		sort.Slice(edge.Mappings, func(i, j int) bool {
			left := strings.Join(edge.Mappings[i].FromPath, "\x00") + "\x01" + strings.Join(edge.Mappings[i].ToPath, "\x00")
			right := strings.Join(edge.Mappings[j].FromPath, "\x00") + "\x01" + strings.Join(edge.Mappings[j].ToPath, "\x00")
			return left < right
		})
		graph.Edges = append(graph.Edges, *edge)
	}

	for _, from := range sortedMapKeys(info.Branches) {
		branches := info.Branches[from]
		for index := range branches {
			targetMap := branches[index].GetEndNode()
			targets := sortedMapKeys(targetMap)
			graph.Branches = append(graph.Branches, Branch{From: from, Targets: targets})
		}
	}
	sort.SliceStable(graph.Branches, func(i, j int) bool {
		if graph.Branches[i].From != graph.Branches[j].From {
			return graph.Branches[i].From < graph.Branches[j].From
		}
		return strings.Join(graph.Branches[i].Targets, "\x00") < strings.Join(graph.Branches[j].Targets, "\x00")
	})

	return graph, nil
}

func validNodeKind(kind NodeKind) bool {
	switch kind {
	case NodeKindLLM, NodeKindIO, NodeKindCPU, NodeKindBranch, NodeKindMerge, NodeKindGraph:
		return true
	default:
		return false
	}
}

func projectDependencies(dependencies map[string][]string, channel string, add func(string, string, string)) {
	for _, from := range sortedMapKeys(dependencies) {
		toValues := append([]string(nil), dependencies[from]...)
		sort.Strings(toValues)
		for _, to := range toValues {
			add(from, to, channel)
		}
	}
}

func clonePath(path compose.FieldPath) []string {
	return append([]string{}, path...)
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func sortedMapKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
