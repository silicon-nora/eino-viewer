package einoworkflowsnapshot

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const EinoRunRecordSchemaVersion = 1

type RunSource string

const (
	RunSourceAgent    RunSource = "agent"
	RunSourceGraph    RunSource = "graph"
	RunSourceWorkflow RunSource = "workflow"
)

var ErrInvalidRunRecord = errors.New("eino run record: invalid record")

// RunRecord is the single portable product artifact shared by Agent, Graph,
// and Workflow Recorders. Evidence remains lossless and independently
// versioned; the Viewer derives the useful run path and node details.
type RunRecord struct {
	SchemaVersion int          `json:"schemaVersion"`
	RunID         string       `json:"runId"`
	Source        RunSource    `json:"source"`
	Evidence      []Envelope   `json:"evidence"`
	Diagnostics   []Diagnostic `json:"diagnostics,omitempty"`
	Metadata      JSONMap      `json:"metadata,omitempty"`
}

// NewRunRecord validates and defensively copies one run's evidence.
func NewRunRecord(runID string, source RunSource, evidence []Envelope, diagnostics []Diagnostic, metadata JSONMap) (RunRecord, error) {
	if strings.TrimSpace(runID) == "" {
		return RunRecord{}, fmt.Errorf("%w: runId must be non-empty", ErrInvalidRunRecord)
	}
	if source != RunSourceAgent && source != RunSourceGraph && source != RunSourceWorkflow {
		return RunRecord{}, fmt.Errorf("%w: unsupported source %q", ErrInvalidRunRecord, source)
	}
	if len(evidence) == 0 {
		return RunRecord{}, fmt.Errorf("%w: evidence must not be empty", ErrInvalidRunRecord)
	}
	for index, envelope := range evidence {
		if err := ValidateEnvelope(envelope); err != nil {
			return RunRecord{}, fmt.Errorf("%w: evidence[%d]: %v", ErrInvalidRunRecord, index, err)
		}
		if envelope.Correlation["runId"] != runID {
			return RunRecord{}, fmt.Errorf(
				"%w: evidence[%d] runId %q does not match %q",
				ErrInvalidRunRecord,
				index,
				envelope.Correlation["runId"],
				runID,
			)
		}
	}
	if err := validateRunLifecycleSequence(evidence); err != nil {
		return RunRecord{}, fmt.Errorf("%w: %v", ErrInvalidRunRecord, err)
	}
	record := RunRecord{
		SchemaVersion: EinoRunRecordSchemaVersion,
		RunID:         runID,
		Source:        source,
		Evidence:      evidence,
		Diagnostics:   diagnostics,
		Metadata:      metadata,
	}
	return cloneRunRecord(record)
}

// ValidateRunRecord checks a decoded RunRecord and its one-run invariant.
func ValidateRunRecord(record RunRecord) error {
	if record.SchemaVersion != EinoRunRecordSchemaVersion {
		return fmt.Errorf("%w: unsupported schemaVersion %d", ErrInvalidRunRecord, record.SchemaVersion)
	}
	_, err := NewRunRecord(record.RunID, record.Source, record.Evidence, record.Diagnostics, record.Metadata)
	return err
}

// MarshalRunRecord serializes a validated portable record.
func MarshalRunRecord(record RunRecord) ([]byte, error) {
	if err := ValidateRunRecord(record); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		return nil, fmt.Errorf("eino run record: marshal: %w", err)
	}
	return encoded, nil
}

func cloneRunRecord(record RunRecord) (RunRecord, error) {
	encoded, err := json.Marshal(record)
	if err != nil {
		return RunRecord{}, fmt.Errorf("%w: JSON projection: %v", ErrInvalidRunRecord, err)
	}
	var cloned RunRecord
	if err := json.Unmarshal(encoded, &cloned); err != nil {
		return RunRecord{}, fmt.Errorf("%w: JSON clone: %v", ErrInvalidRunRecord, err)
	}
	return cloned, nil
}

func recorderRunRecord(runID string, source RunSource, envelopes []Envelope, diagnostics []Diagnostic, captureErr error) (RunRecord, error) {
	record, err := NewRunRecord(runID, source, envelopes, diagnostics, nil)
	if err != nil {
		return RunRecord{}, err
	}
	return record, captureErr
}

// RunRecord returns one ready-to-view Agent run artifact.
func (recorder *AgentRecorder) RunRecord() (RunRecord, error) {
	envelopes, diagnostics, err := recorder.Envelopes()
	return recorderRunRecord(recorder.runID, RunSourceAgent, envelopes, diagnostics, err)
}

// RunRecord returns one ready-to-view Graph run artifact.
func (recorder *GraphRecorder) RunRecord() (RunRecord, error) {
	envelopes, diagnostics, err := recorder.Envelopes()
	return recorderRunRecord(recorder.runID, RunSourceGraph, envelopes, diagnostics, err)
}

// RunRecord returns one ready-to-view Workflow run artifact.
func (recorder *WorkflowRecorder) RunRecord() (RunRecord, error) {
	envelopes, diagnostics, err := recorder.Envelopes()
	return recorderRunRecord(recorder.runID, RunSourceWorkflow, envelopes, diagnostics, err)
}
