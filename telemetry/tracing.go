package telemetry

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/urfave/cli/v2"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.19.0"
)

var CLIFlagTracingSampleRatio = &cli.Float64Flag{
	Name:    "tracing-sample-ratio",
	Usage:   "tracing sample ratio (0.0 to 1.0)",
	Value:   1.0,
	EnvVars: []string{"TRACING_SAMPLE_RATIO"},
}

var CLIFlagServiceName = &cli.StringFlag{
	Name:    "service-name",
	Usage:   "service name for tracing",
	Value:   "service",
	EnvVars: []string{"SERVICE_NAME"},
}

type Tracing struct {
	serviceName  string
	sampleRatio  float64
	exporter     sdktrace.SpanExporter
	provider     *sdktrace.TracerProvider
	shutdownFunc func(context.Context) error
}

func StartTracing(cctx *cli.Context, opts ...TracingOption) (func(context.Context) error, error) {
	logger := slog.Default().With("component", "telemetry")
	ctx := context.Background()

	t := &Tracing{
		serviceName: cctx.String("service-name"),
		sampleRatio: cctx.Float64("tracing-sample-ratio"),
	}

	for _, opt := range opts {
		opt(t)
	}

	if t.exporter == nil {
		client := otlptracehttp.NewClient()
		exporter, err := otlptrace.New(ctx, client)
		if err != nil {
			return nil, fmt.Errorf("creating OTLP trace exporter: %w", err)
		}
		t.exporter = exporter
	}

	t.provider = newTraceProvider(t.exporter, t.serviceName, t.sampleRatio)
	otel.SetTracerProvider(t.provider)

	t.shutdownFunc = t.provider.Shutdown

	logger.Info("started tracing", "service", t.serviceName, "sample_ratio", t.sampleRatio)

	return t.shutdownFunc, nil
}

func newTraceProvider(exp sdktrace.SpanExporter, serviceName string, sampleRatio float64) *sdktrace.TracerProvider {
	// Ensure default SDK resources and the required service name are set.
	r := resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceName(serviceName),
	)

	// ParentBased wraps the ratio sampler so that child spans inherit their
	// parent's sampling decision. Without this, library code (e.g. indigo)
	// that creates spans via the global tracer gets sampled independently,
	// generating millions of unwanted spans.
	sampler := sdktrace.ParentBased(sdktrace.TraceIDRatioBased(sampleRatio))

	return sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sampler),
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(r),
	)
}

// TracingOption is a functional option for configuring the Tracing.
type TracingOption func(*Tracing)

// WithServiceName sets the service name for tracing.
// Defaults to "service" or whatever is set in the CLI flag.
func WithServiceName(name string) TracingOption {
	return func(t *Tracing) {
		t.serviceName = name
	}
}

// WithSampleRatio sets the sample ratio for tracing.
// Defaults to 1.0 or whatever is set in the CLI flag.
func WithSampleRatio(ratio float64) TracingOption {
	return func(t *Tracing) {
		t.sampleRatio = ratio
	}
}

// WithExporter sets a custom span exporter for tracing.
func WithExporter(exporter sdktrace.SpanExporter) TracingOption {
	return func(t *Tracing) {
		t.exporter = exporter
	}
}
