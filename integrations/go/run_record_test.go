package einoworkflowsnapshot

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func TestRunRecordIsOneValidatedDefensiveArtifact(t *testing.T) {
	envelope, _, err := NewEnvelope("schema.message", 1, map[string]any{
		"role": "user", "content": "hello",
	}, EnvelopeOptions{Correlation: map[string]string{"runId": "run-1"}})
	if err != nil {
		t.Fatal(err)
	}
	record, err := NewRunRecord("run-1", RunSourceAgent, []Envelope{envelope}, []Diagnostic{{
		Severity: "warning", Code: "capture.partial", Path: "evidence", Message: "partial",
	}}, JSONMap{"environment": "test"})
	if err != nil {
		t.Fatal(err)
	}
	if record.SchemaVersion != 1 || record.Source != RunSourceAgent || len(record.Evidence) != 1 {
		t.Fatalf("unexpected RunRecord: %#v", record)
	}
	record.Evidence[0].Correlation["runId"] = "mutated"
	record.Metadata["environment"] = "mutated"
	if envelope.Correlation["runId"] != "run-1" {
		t.Fatal("RunRecord retained caller-owned evidence")
	}

	valid, err := NewRunRecord("run-1", RunSourceAgent, []Envelope{envelope}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := MarshalRunRecord(valid)
	if err != nil {
		t.Fatal(err)
	}
	var decoded RunRecord
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(decoded, valid) {
		t.Fatalf("RunRecord JSON changed the record: %#v", decoded)
	}
}

func TestRunRecordRejectsMixedAndInvalidRuns(t *testing.T) {
	envelope, _, err := NewEnvelope("schema.message", 1, map[string]any{
		"role": "user", "content": "hello",
	}, EnvelopeOptions{Correlation: map[string]string{"runId": "another-run"}})
	if err != nil {
		t.Fatal(err)
	}
	for name, test := range map[string]struct {
		runID    string
		source   RunSource
		evidence []Envelope
	}{
		"empty run":   {"", RunSourceAgent, []Envelope{envelope}},
		"bad source":  {"another-run", "trace", []Envelope{envelope}},
		"no evidence": {"another-run", RunSourceAgent, nil},
		"mixed run":   {"run-1", RunSourceAgent, []Envelope{envelope}},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := NewRunRecord(test.runID, test.source, test.evidence, nil, nil)
			if !errors.Is(err, ErrInvalidRunRecord) {
				t.Fatalf("error = %v, want ErrInvalidRunRecord", err)
			}
		})
	}
}

func TestRunRecordLifecycleValidationMatchesViewer(t *testing.T) {
	options := EnvelopeOptions{Correlation: map[string]string{"runId": "run-lifecycle-validation"}}
	makeEnvelope := func(kind string, version int, payload any) Envelope {
		t.Helper()
		envelope, _, err := NewEnvelope(kind, version, payload, options)
		if err != nil {
			t.Fatal(err)
		}
		return envelope
	}
	start := makeEnvelope(RunLifecycleKind, 1, map[string]any{"state": "started"})
	end := makeEnvelope(RunLifecycleKind, 1, map[string]any{"state": "ended", "outcome": "success", "capture": "complete"})
	for name, evidence := range map[string][]Envelope{
		"unsupported version": {makeEnvelope(RunLifecycleKind, 2, map[string]any{"state": "started"})},
		"array payload":       {makeEnvelope(RunLifecycleKind, 1, []string{"started"})},
		"null payload":        {makeEnvelope(RunLifecycleKind, 1, nil)},
		"unknown state":       {makeEnvelope(RunLifecycleKind, 1, map[string]any{"state": "done"})},
		"missing outcome":     {makeEnvelope(RunLifecycleKind, 1, map[string]any{"state": "ended", "capture": "complete"})},
		"missing capture":     {makeEnvelope(RunLifecycleKind, 1, map[string]any{"state": "ended", "outcome": "success"})},
		"invalid outcome":     {makeEnvelope(RunLifecycleKind, 1, map[string]any{"state": "ended", "outcome": "other", "capture": "complete"})},
		"null capture":        {makeEnvelope(RunLifecycleKind, 1, map[string]any{"state": "ended", "outcome": "success", "capture": nil})},
		"unknown field":       {makeEnvelope(RunLifecycleKind, 1, map[string]any{"state": "started", "extra": true})},
		"outcome on started":  {makeEnvelope(RunLifecycleKind, 1, map[string]any{"state": "started", "outcome": ""})},
		"duplicate start":     {start, start},
		"duplicate end":       {end, end},
		"start after end":     {end, start},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := NewRunRecord(options.Correlation["runId"], RunSourceAgent, evidence, nil, nil); !errors.Is(err, ErrInvalidRunRecord) {
				t.Fatalf("NewRunRecord accepted invalid lifecycle: %v", err)
			}
			record := RunRecord{SchemaVersion: 1, RunID: options.Correlation["runId"], Source: RunSourceAgent, Evidence: evidence}
			if err := ValidateRunRecord(record); !errors.Is(err, ErrInvalidRunRecord) {
				t.Fatalf("ValidateRunRecord accepted invalid lifecycle: %v", err)
			}
			if _, err := MarshalRunRecord(record); !errors.Is(err, ErrInvalidRunRecord) {
				t.Fatalf("MarshalRunRecord accepted invalid lifecycle: %v", err)
			}
		})
	}
	for _, kind := range []string{AgentEventKind, CallbackEventKind, ComponentIOKind, "schema.message", "schema.agentic_message", "workflow.snapshot"} {
		if _, err := NewRunRecord(options.Correlation["runId"], RunSourceAgent, []Envelope{end, makeEnvelope(kind, 1, map[string]any{})}, nil, nil); !errors.Is(err, ErrInvalidRunRecord) {
			t.Fatalf("accepted %s after recorded end: %v", kind, err)
		}
	}
	for _, evidence := range [][]Envelope{
		{start}, {end}, {start, end},
		{end, makeEnvelope("schema.tool", 1, map[string]any{})},
		{end, makeEnvelope("compose.graph", 1, map[string]any{})},
		{end, makeEnvelope("custom.metadata", 1, map[string]any{})},
	} {
		if _, err := NewRunRecord(options.Correlation["runId"], RunSourceAgent, evidence, nil, nil); err != nil {
			t.Fatalf("rejected valid partial/static evidence: %v", err)
		}
	}
}
