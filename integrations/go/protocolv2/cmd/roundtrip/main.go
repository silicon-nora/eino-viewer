// Command roundtrip reads one normalized v2 record from stdin and emits its Go
// wire representation. It is a fidelity check, not a semantic validator.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/silicon-nora/eino-viewer/integrations/go/protocolv2"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	decoder := json.NewDecoder(os.Stdin)
	decoder.DisallowUnknownFields()
	var record protocolv2.RunRecord
	if err := decoder.Decode(&record); err != nil {
		return err
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return fmt.Errorf("expected exactly one JSON record")
		}
		return err
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(record)
}
