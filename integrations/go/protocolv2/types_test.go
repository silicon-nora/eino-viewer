package protocolv2

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// These tests assert lossless representation of valid wire data. They do not
// replace the schema and cross-reference validation performed by JavaScript.
func decodedJSON(t *testing.T, data []byte) interface{} {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value interface{}
	if err := decoder.Decode(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func roundTrip(t *testing.T, data []byte, target interface{}) []byte {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(target)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(decodedJSON(t, data), decodedJSON(t, encoded)) {
		t.Fatalf("round trip changed JSON\nbefore: %s\nafter:  %s", data, encoded)
	}
	return encoded
}

func TestAllContractFixturesRoundTrip(t *testing.T) {
	paths, err := filepath.Glob("../../../protocol/v2/fixtures/*.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Fatal("no v2 contract fixtures found")
	}
	for _, path := range paths {
		t.Run(filepath.Base(path), func(t *testing.T) {
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var record RunRecord
			roundTrip(t, data, &record)
		})
	}
}

func TestExplicitNullAndMissingContentRemainDistinct(t *testing.T) {
	for _, data := range []string{
		`{"availability":"inline","value":null}`,
		`{"availability":"inline","value":""}`,
		`{"availability":"inline","value":[]}`,
		`{"availability":"inline","value":{}}`,
		`{"availability":"inline","value":false}`,
		`{"availability":"inline","value":0}`,
		`{"availability":"missing","reason":"not collected"}`,
		`{"availability":"reference","key":"empty-content","sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","byteLength":0}`,
	} {
		t.Run(data, func(t *testing.T) {
			var content ContentData
			roundTrip(t, []byte(data), &content)
			if content.Availability == "inline" && content.Value == nil {
				t.Fatal("present inline value collapsed to absent")
			}
		})
	}
}

func TestKnownZeroAndUnknownCountsRemainDistinct(t *testing.T) {
	var timing Timing
	roundTrip(t, []byte(`{"basis":"source","startedAtMs":0,"endedAtMs":0,"durationMs":0}`), &timing)
	if timing.StartedAtMs == nil || timing.EndedAtMs == nil || timing.DurationMs == nil {
		t.Fatal("known zero time became unknown")
	}
	var counts TokenCounts
	roundTrip(t, []byte(`{"input":0,"total":9007199254740991,"inputCached":0}`), &counts)
	if counts.Input == nil || counts.InputCached == nil || counts.Output != nil {
		t.Fatal("known zero and unknown token counts were conflated")
	}
}

func TestIntegerValuedJSONNumericSpellingsRoundTrip(t *testing.T) {
	var counts TokenCounts
	roundTrip(t, []byte(`{"input":0.0,"output":1e3,"total":1.000e3,"inputCached":-0}`), &counts)
	var annotation Annotation
	roundTrip(t, []byte(`{"id":"a","owner":{"kind":"run","id":"r"},"type":"another-app.unregistered","schemaVersion":1e0,"payload":null}`), &annotation)
}

func TestOptionalEmptyValuesAndUnknownOwnershipRoundTrip(t *testing.T) {
	var definition Definition
	roundTrip(t, []byte(`{"id":"d","kind":"node","name":"","key":"","path":[],"edges":[],"component":"","semanticKind":"","revision":""}`), &definition)
	var event Event
	roundTrip(t, []byte(`{"id":"event","sequence":0,"type":"custom.event","owner":{"kind":"unknown","reason":"ambiguous same-name scopes"},"contentRefs":[],"atMs":0,"targetDefinitionIds":[],"attributes":{}}`), &event)
	for _, data := range []string{`{"state":"root"}`, `{"state":"known","invocationId":"parent"}`, `{"state":"unknown","reason":"not observed"}`} {
		var parent Parent
		roundTrip(t, []byte(data), &parent)
	}
}

func TestUnregisteredBusinessPayloadAndNumbersRemainLossless(t *testing.T) {
	var annotation Annotation
	roundTrip(t, []byte(`{"id":"a","owner":{"kind":"run","id":"run"},"type":"another-app.unregistered","schemaVersion":1,"payload":{"int":9007199254740991,"fraction":0.12345678901234567890123456789,"nested":{"nullable":null,"items":[{},[],true,false]},"user_profile":{"name":"Ada"}}}`), &annotation)
	var metric Metric
	roundTrip(t, []byte(`{"name":"business.ratio","value":0.12345678901234567890123456789,"unit":""}`), &metric)
	var source SourceRecord
	roundTrip(t, []byte(`{"id":"s","owner":{"kind":"unknown","reason":"unknown source"},"format":"provider.custom","version":"","payload":{"value":9007199254740991,"nothing":null}}`), &source)
}
