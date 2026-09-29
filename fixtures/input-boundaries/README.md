# Recorder input-boundary records

These two files come from actual non-streaming Eino Graph invocations and the
default GraphRecorder. The graph echoes its input without changing values or
types. The model provider, network and external services are not used.

They are independent of the 28-scenario Recorder matrix. They test the JSON
input boundary between Go's exact integer serialization and JavaScript's number
representation, not additional business-scenario coverage.

- `graph-safe-integers.json` contains signed and unsigned numeric values within
  JavaScript's safe integer range, including both signed boundaries and zero.
  It also contains strings spelling the full signed/unsigned 64-bit limits;
  these are text, not numbers to be parsed or rewritten.
- `graph-unsafe-integers.json` contains the exact `int64` minimum/maximum,
  `uint64` maximum, and positive/negative integers beyond JavaScript's safe
  range. Go execution and capture succeed. A viewer without lossless numeric
  support must reject this input explicitly rather than show rounded values or
  convert source numbers into strings. Matching string fields remain strings.

The numeric token assertions use `json.RawMessage`, not a `float64` round trip.
Every field is checked in all four bodies: root input/output and node
input/output. Ordinary tests compare complete fixture bytes and never rewrite
them. No existing matrix record is modified.

From `integrations/go`:

```sh
go test -run '^TestGraphRecorderNumericFidelity$' -count=1 .
```

To deliberately regenerate only these two records, then review the JSON:

```sh
UPDATE_FIXTURES=1 go test -run '^TestGraphRecorderNumericFidelity$' -count=1 .
```

If the default Go cache is not writable, set
`GOCACHE=/private/tmp/eino-viewer-go-cache` for this command.
