# Real Recorder static-result fixtures

These thirty-two Run Records come from real Eino APIs: thirty-one actual runs and one
compile-only Workflow. Agent model responses are deterministic doubles; the
Runner, tools, native cancellation/interruption, Graph/Workflow execution and
Recorder are real. No external model service is called.

`manifest.json` lists expected source and whole-run completion facts. The Go
tests separately verify actual tool/node call counts and original results.
Do not fill missing business I/O using fixture metadata or invented events.

## Check

From the repository root:

```sh
npm run test:recorder-matrix
npm run inspect:recorder-matrix -- --strict
npm run test:browser -- --workers=3
```

The first command checks real recordings against these fixtures, validates
transport and known semantic regressions, and writes an assessment. The strict
command checks the four repaired display defects plus root summaries and exact
Graph body ownership. The original two metadata-only Graph fixtures still
report missing I/O; the new eight Graph and two Workflow fixtures cover safe
root/body capture, values, limits and redaction. Historical JSON is not repaired
by inventing missing content.
Browser tests cover import plus targeted Workflow failure, Agent cancellation,
and interruption semantics in Path/Trajectory/details/Raw. See the
[results](../../docs/RECORDER_MATRIX_RESULTS.md) and
[roadmap](../../docs/STATIC_RESULT_ROADMAP.md) before interpreting a green test.

Generated assessment JSON/Markdown, browser observations and selected Chromium
screenshots are local outputs under `.artifacts/recorder-matrix/`.

## Deliberately regenerate

Ordinary tests do not rewrite fixtures. To regenerate only these new fixtures,
run the relevant command from `integrations/go`, then review the resulting JSON:

```sh
WRITE_STATIC_AGENT_FIXTURES=1 go test -run TestStaticAgentRecorderMatrix -count=1 .
WRITE_STATIC_GRAPH_WORKFLOW_FIXTURES=1 go test -run TestStaticGraphWorkflowMatrix -count=1 .
WRITE_GRAPH_IO_FIXTURES=1 go test -run 'TestGraphIOSafeRecorderMatrix|TestWorkflowRootIORecorderMatrix' -count=1 .
WRITE_COMPLEX_RECORDER_FIXTURES=1 go test -run TestComplexAgentRecorderMatrix -count=1 .
WRITE_NESTED_RECORDER_FIXTURES=1 go test -run TestNestedAgentRecorderMatrix -count=1 .
WRITE_NESTED_RECORDER_FIXTURES=1 go test -run '^TestDeepNestedAgentRecorderMatrix$' -count=1 .
WRITE_GRAPH_LOOP_FIXTURES=1 go test -run '^TestGraphLoopRecorderMatrix$' -count=1 .
WRITE_PARALLEL_WORKFLOW_FIXTURES=1 go test -run '^TestParallelWorkflowRecorderMatrix' -count=1 .
```

Goldens retain the actual payload, correlation and event order. Comparison
copies normalize observation timestamps and compare envelope content without
requiring a fixed global callback order. Agent comparisons also normalize
generated message IDs, random UUIDs and opaque interrupt checkpoints. The
checkpoint must be present and valid base64; its internal structure is not a
cross-version contract and the viewer must not execute it.
Diagnostics are compared as a multiset of complete values: only arrival order
is ignored, while duplicate counts and all diagnostic fields remain checked.
The new I/O fixtures use a deterministic clock and sequential execution, so
their full serialized bytes, identities, values and diagnostics are checked.
New safe runtime metadata is checked separately from historical fixtures. JSON
object member order may differ after safe copying, but bodies, identities,
duplicate counts and within-invocation order remain covered. The two complex
Agent fixtures additionally compare actual dispatch IDs with each component
input, output and Agent tool-result event, including deliberately reversed
parallel completion order.

Four nested Agent-as-tool fixtures cover distinct parent/child answers, parallel
same-name child calls with reused inner tool IDs, a failed child with a successful
parent fallback, and failure propagated to the root. Component addresses prove
invocation identity; forwarded child AgentEvent name paths do not always do so.
Ambiguous events remain unassigned, and derived partial-record tests must not
reassign them after an entire sibling's component evidence disappears.
Parallel fixtures use an independent real ChatModelAgent instance per logical
child invocation: a separately reproducible shared-instance upstream race and
its exact scope are documented in the iteration 4 acceptance, not hidden by
claiming that Recorder fixes Eino's own concurrency behavior.

Two further three-level fixtures use `coordinator → worker → worker` with the
same `shared-depth-call` tool ID at all levels. Their complete callback addresses
keep the identically named Agents and repeated IDs distinct. One run produces
three different final answers. The other records an original leaf lookup error
and its AgentTool propagation, then uses the middle Agent's real Tool middleware
to supply a handled result and a middle final answer; the parent later succeeds.
Neither the failed lookup nor the failed leaf Agent gains a successful component
output or a final answer. Only the middle AgentTool interaction has a later,
same-scope handled tool-result event. The assessment therefore checks local
recovery from exact source boundaries, not from the whole-run outcome, and
rejects changed flags, cross-level borrowing, ambiguous paths and reordered
result/error evidence. The deep test's generation command writes only its two
new fixtures; the previous twenty-six are unchanged.

Separate guards check run boundaries and each invocation's input→output or
start→end/error order in both real outputs and golden files. Deliberately
reordered copies must fail these guards; ignoring unrelated callback order
does not permit an individual invocation to finish before it starts.

Four complex Graph/Workflow records extend the matrix from twenty-eight to
thirty-two. The two Graph records execute a multi-node route-revision loop:
three evaluations and two revisions finish successfully, or the second
evaluation fails while earlier visits retain their own values. A declared
fallback is never called. Callback identity, ordered visit boundaries and every
root/node I/O body are checked against actual business calls.

The two Workflow records execute `prepare → slow / fast → join → finish`.
Channels ensure both branches start and the fast branch's Recorder callback
finishes before the slow branch ends. Successful joins map distinct branch
outputs to their own fields; a slow-branch failure leaves the fast branch
successful and never calls join/finish. No sleep-based scheduling is used.
Golden comparison tolerates unrelated sibling input arrival order, while an
independent causal checker validates both actual and saved records. Four
reordered copies must fail it. The original twenty-eight fixtures are unchanged;
the two numeric-boundary fixtures remain separate from this business matrix.

If the default Go cache is not writable, set
`GOCACHE=/private/tmp/eino-viewer-go-cache` for local checks. Compatibility was
checked on Eino v0.9.19 and v0.9.0; temporary compatibility modfiles do not change
the main module dependencies.
