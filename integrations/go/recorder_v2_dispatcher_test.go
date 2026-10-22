package einoworkflowsnapshot

import (
	"context"
	"errors"
	"testing"

	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/components"
	"github.com/cloudwego/eino/schema"
)

// The probe forwards Needed to the actual wrapper while observing what the
// real Eino dispatcher selects. It does not implement its own filter policy.
type nativeV2DispatcherProbe struct {
	callbacks.Handler
	checked, dispatched [5]int
}

func (p *nativeV2DispatcherProbe) Needed(ctx context.Context, info *callbacks.RunInfo, timing callbacks.CallbackTiming) bool {
	p.checked[timing]++
	return p.Handler.(callbacks.TimingChecker).Needed(ctx, info, timing)
}
func (p *nativeV2DispatcherProbe) OnStart(ctx context.Context, info *callbacks.RunInfo, input callbacks.CallbackInput) context.Context {
	p.dispatched[callbacks.TimingOnStart]++
	return p.Handler.OnStart(ctx, info, input)
}
func (p *nativeV2DispatcherProbe) OnEnd(ctx context.Context, info *callbacks.RunInfo, output callbacks.CallbackOutput) context.Context {
	p.dispatched[callbacks.TimingOnEnd]++
	return p.Handler.OnEnd(ctx, info, output)
}
func (p *nativeV2DispatcherProbe) OnError(ctx context.Context, info *callbacks.RunInfo, err error) context.Context {
	p.dispatched[callbacks.TimingOnError]++
	return p.Handler.OnError(ctx, info, err)
}
func (p *nativeV2DispatcherProbe) OnStartWithStreamInput(ctx context.Context, info *callbacks.RunInfo, input *schema.StreamReader[callbacks.CallbackInput]) context.Context {
	p.dispatched[callbacks.TimingOnStartWithStreamInput]++
	return p.Handler.OnStartWithStreamInput(ctx, info, input)
}
func (p *nativeV2DispatcherProbe) OnEndWithStreamOutput(ctx context.Context, info *callbacks.RunInfo, output *schema.StreamReader[callbacks.CallbackOutput]) context.Context {
	p.dispatched[callbacks.TimingOnEndWithStreamOutput]++
	return p.Handler.OnEndWithStreamOutput(ctx, info, output)
}

func TestNativeV2DispatcherFiltersBeforeStreamCopy(t *testing.T) {
	for _, component := range []components.Component{components.ComponentOfChatModel, "AgenticModel"} {
		for _, withLegacy := range []bool{false, true} {
			name := string(component) + "/native-only"
			if withLegacy {
				name = string(component) + "/legacy"
			}
			t.Run(name, func(t *testing.T) {
				recorder := newNativeV2("dispatcher-filter", "application", EnvelopeOptions{}, false)
				legacyCalls := 0
				builder := callbacks.NewHandlerBuilder()
				if withLegacy {
					builder.OnStartFn(func(ctx context.Context, _ *callbacks.RunInfo, _ callbacks.CallbackInput) context.Context {
						legacyCalls++
						return ctx
					}).OnEndFn(func(ctx context.Context, _ *callbacks.RunInfo, _ callbacks.CallbackOutput) context.Context {
						legacyCalls++
						return ctx
					}).OnErrorFn(func(ctx context.Context, _ *callbacks.RunInfo, _ error) context.Context { legacyCalls++; return ctx }).OnStartWithStreamInputFn(func(ctx context.Context, _ *callbacks.RunInfo, input *schema.StreamReader[callbacks.CallbackInput]) context.Context {
						legacyCalls++
						input.Close()
						return ctx
					}).OnEndWithStreamOutputFn(func(ctx context.Context, _ *callbacks.RunInfo, output *schema.StreamReader[callbacks.CallbackOutput]) context.Context {
						legacyCalls++
						output.Close()
						return ctx
					})
				}
				wrapped := recorder.wrap(builder.Build())
				if _, ok := wrapped.(callbacks.TimingChecker); !ok {
					t.Fatal("native wrapper does not expose Eino TimingChecker")
				}
				probe := &nativeV2DispatcherProbe{Handler: wrapped}
				info := &callbacks.RunInfo{Component: component, Name: "manual-model"}
				newContext := func() context.Context {
					return callbacks.InitCallbacks(SkipChatModelCallbacks(context.Background()), info, probe)
				}
				callbacks.OnStart(newContext(), "input")
				callbacks.OnEnd(newContext(), "output")
				callbacks.OnError(newContext(), errors.New("provider-error"))
				input := schema.StreamReaderFromArray([]string{"input-chunk"})
				_, nextInput := callbacks.OnStartWithStreamInput(newContext(), input)
				if (nextInput == input) == withLegacy {
					t.Fatal("stream input copy did not follow the dispatcher's Needed decision")
				}
				value, err := nextInput.Recv()
				if err != nil || value != "input-chunk" {
					t.Fatalf("application stream input changed: %q %v", value, err)
				}
				nextInput.Close()
				output := schema.StreamReaderFromArray([]string{"output-chunk"})
				_, nextOutput := callbacks.OnEndWithStreamOutput(newContext(), output)
				if (nextOutput == output) == withLegacy {
					t.Fatal("stream output copy did not follow the dispatcher's Needed decision")
				}
				value, err = nextOutput.Recv()
				if err != nil || value != "output-chunk" {
					t.Fatalf("application stream output changed: %q %v", value, err)
				}
				nextOutput.Close()
				for timing, checked := range probe.checked {
					if checked != 1 {
						t.Fatalf("Eino did not consult Needed exactly once for timing %d: %d", timing, checked)
					}
					wantDispatched := 0
					if withLegacy {
						wantDispatched = 1
					}
					if probe.dispatched[timing] != wantDispatched {
						t.Fatalf("timing %d dispatched %d times, want %d", timing, probe.dispatched[timing], wantDispatched)
					}
				}
				wantLegacy := 0
				if withLegacy {
					wantLegacy = 5
				}
				if legacyCalls != wantLegacy {
					t.Fatalf("legacy handler called %d times, want %d", legacyCalls, wantLegacy)
				}
				if len(recorder.record.Invocations) != 0 || len(recorder.record.Events) != 0 || len(recorder.record.Usage) != 0 {
					t.Fatal("marked model dispatch still recorded native facts")
				}
			})
		}
	}
}
