// Package metrics holds Leadsheet's Prometheus metrics: HTTP, ingest,
// writes, sign-ins and share cards as counters, plus topline usage and
// database gauges read from Postgres (see Collector).
package metrics

import (
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	HTTPRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "leadsheet_http_requests_total",
		Help: "HTTP requests by route pattern, method and status.",
	}, []string{"route", "method", "status"})
	HTTPDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "leadsheet_http_request_duration_seconds",
		Help:    "HTTP request latency by route pattern and method.",
		Buckets: []float64{.001, .0025, .005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5},
	}, []string{"route", "method"})

	FirehoseEvents = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "leadsheet_firehose_events_total",
		Help: "Jetstream events handled, by kind (commit/account/identity), collection and operation.",
	}, []string{"kind", "collection", "op"})
	FirehoseLastEvent = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "leadsheet_firehose_last_event_timestamp_seconds",
		Help: "Jetstream time of the newest event handled.",
	})
	FirehoseReconnects = promauto.NewCounter(prometheus.CounterOpts{
		Name: "leadsheet_firehose_reconnects_total",
		Help: "Times the Jetstream connection ended and was retried.",
	})

	RecordsIndexed = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "leadsheet_records_indexed_total",
		Help: "Records put into or removed from the index, by collection, operation and result (ok/invalid/error).",
	}, []string{"collection", "op", "result"})
	BackfillRepos = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "leadsheet_backfill_repos_total",
		Help: "Repos backfilled, by result.",
	}, []string{"result"})
	ProfilesResolved = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "leadsheet_profiles_resolved_total",
		Help: "Profile resolutions, by result (ok/no_handle).",
	}, []string{"result"})

	PDSWrites = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "leadsheet_pds_writes_total",
		Help: "Writes to users' PDSes, by collection, operation and result.",
	}, []string{"collection", "op", "result"})
	Logins = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "leadsheet_logins_total",
		Help: "Sign-in steps: started, start_failed, completed, callback_failed, logout.",
	}, []string{"step"})
	OGCards = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "leadsheet_og_cards_total",
		Help: "Share-card requests, by where the image came from (stored/rendered).",
	}, []string{"source"})
	CleanupDeleted = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "leadsheet_cleanup_deleted_total",
		Help: "Rows removed by the hourly cleanup, by kind.",
	}, []string{"kind"})
)

// Middleware counts and times requests by Echo route pattern (so
// /sheet/:actor/:rkey is one series, not one per sheet).
func Middleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()
			err := next(c)
			route := c.Path()
			if route == "" {
				route = "unmatched"
			}
			status := c.Response().Status
			if err != nil {
				if he, ok := err.(*echo.HTTPError); ok {
					status = he.Code
				} else {
					status = 500
				}
			}
			method := c.Request().Method
			HTTPRequests.WithLabelValues(route, method, strconv.Itoa(status)).Inc()
			HTTPDuration.WithLabelValues(route, method).Observe(time.Since(start).Seconds())
			return err
		}
	}
}

// Result is "ok" for a nil error, else "error".
func Result(err error) string {
	if err != nil {
		return "error"
	}
	return "ok"
}
