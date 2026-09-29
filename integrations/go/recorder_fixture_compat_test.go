package einoworkflowsnapshot

import (
	"encoding/json"
	"reflect"
	"testing"
)

// Legacy goldens keep all source facts. Only additive, successful safe-capture
// annotations may be absent in a historical envelope. Omission/changed values,
// diagnoses, event identities, and multiplicities are never normalized away.
func recorderFixtureSafetyCompatibility(t *testing.T, actual, expected RunRecord) RunRecord {
	t.Helper()
	cloned, err := cloneRunRecord(actual)
	if err != nil {
		t.Fatal(err)
	}
	for index, envelope := range cloned.Evidence {
		for _, golden := range expected.Evidence {
			left, right := envelope, golden
			left.Metadata = nil
			right.Metadata = nil
			left.ObservedAtMS = nil
			right.ObservedAtMS = nil
			left.Payload = canonicalRecorderJSON(t, left.Payload)
			right.Payload = canonicalRecorderJSON(t, right.Payload)
			if !reflect.DeepEqual(left, right) {
				continue
			}
			var metadata, expectedMetadata map[string]any
			if len(envelope.Metadata) > 0 {
				if err := json.Unmarshal(envelope.Metadata, &metadata); err != nil {
					t.Fatal(err)
				}
			}
			if len(golden.Metadata) > 0 {
				if err := json.Unmarshal(golden.Metadata, &expectedMetadata); err != nil {
					t.Fatal(err)
				}
			}
			if _, exists := expectedMetadata["capture"]; !exists {
				if capture, ok := metadata["capture"].(map[string]any); ok && capture["status"] == "captured" && len(capture) <= 2 {
					if len(capture) == 1 || capture["redacted"] == true {
						delete(metadata, "capture")
					}
				}
			}
			if _, exists := expectedMetadata["io"]; !exists {
				if scope, ok := metadata["io"].(map[string]any); ok && len(scope) == 1 && scope["scope"] == "node" {
					delete(metadata, "io")
				}
			}
			if len(metadata) == 0 {
				cloned.Evidence[index].Metadata = nil
			} else {
				cloned.Evidence[index].Metadata, _ = json.Marshal(metadata)
			}
			break
		}
	}
	return cloned
}

func canonicalRecorderJSON(t *testing.T, value json.RawMessage) json.RawMessage {
	t.Helper()
	if len(value) == 0 {
		return nil
	}
	var decoded any
	if err := json.Unmarshal(value, &decoded); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(decoded)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

// This form preserves the complete evidence ordering and observation times.
func orderedRecorderFixtureEqual(t *testing.T, actual RunRecord, encodedExpected []byte) bool {
	t.Helper()
	var expected RunRecord
	if err := json.Unmarshal(encodedExpected, &expected); err != nil {
		t.Fatal(err)
	}
	actual = recorderFixtureSafetyCompatibility(t, actual, expected)
	for _, record := range []*RunRecord{&actual, &expected} {
		for index := range record.Evidence {
			record.Evidence[index].Payload = canonicalRecorderJSON(t, record.Evidence[index].Payload)
			record.Evidence[index].Metadata = canonicalRecorderJSON(t, record.Evidence[index].Metadata)
		}
	}
	return reflect.DeepEqual(actual, expected)
}

func TestRecorderFixtureCompatibilityPreservesEvidence(t *testing.T) {
	expected := RunRecord{Evidence: []Envelope{
		{Kind: ComponentIOKind, Payload: json.RawMessage(`{"body":"first"}`)},
		{Kind: ComponentIOKind, Payload: json.RawMessage(`{"body":"second"}`)},
	}}
	encoded, err := json.Marshal(expected)
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"additive-captured", "omitted", "changed-body", "reordered", "duplicate"} {
		t.Run(scenario, func(t *testing.T) {
			actual, cloneErr := cloneRunRecord(expected)
			if cloneErr != nil {
				t.Fatal(cloneErr)
			}
			switch scenario {
			case "additive-captured":
				actual.Evidence[0].Metadata = json.RawMessage(`{"capture":{"status":"captured"},"io":{"scope":"node"}}`)
			case "omitted":
				actual.Evidence[0].Metadata = json.RawMessage(`{"capture":{"status":"omitted","reason":"unsupported_value"}}`)
			case "changed-body":
				actual.Evidence[0].Payload = json.RawMessage(`{"body":"changed"}`)
			case "reordered":
				actual.Evidence[0], actual.Evidence[1] = actual.Evidence[1], actual.Evidence[0]
			case "duplicate":
				actual.Evidence = append(actual.Evidence, actual.Evidence[0])
			}
			if orderedRecorderFixtureEqual(t, actual, encoded) != (scenario == "additive-captured") {
				t.Fatal("comparison hid source evidence changes or rejected additive capture annotation")
			}
		})
	}
}
