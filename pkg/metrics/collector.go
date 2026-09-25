package metrics

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jazware/leadsheet.fm/pkg/store"
	"github.com/prometheus/client_golang/prometheus"
)

// Collector exports topline usage and database gauges. Usage is counted
// in Postgres once a minute (Run), not per scrape; pool stats are live.
type Collector struct {
	logger *slog.Logger
	store  *store.Store

	mu        sync.Mutex
	usage     *store.Usage
	countedAt time.Time
}

func NewCollector(logger *slog.Logger, st *store.Store) *Collector {
	return &Collector{logger: logger, store: st}
}

const usageInterval = time.Minute

// Run refreshes the usage numbers until ctx is cancelled.
func (c *Collector) Run(ctx context.Context) {
	ticker := time.NewTicker(usageInterval)
	defer ticker.Stop()
	for {
		qctx, cancel := context.WithTimeout(ctx, 20*time.Second)
		u, err := c.store.Usage(qctx)
		cancel()
		if err != nil {
			if ctx.Err() == nil {
				c.logger.Warn("counting usage for metrics", "error", err)
			}
		} else {
			c.mu.Lock()
			c.usage, c.countedAt = u, time.Now()
			c.mu.Unlock()
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func desc(name, help string, labels ...string) *prometheus.Desc {
	return prometheus.NewDesc(name, help, labels, nil)
}

var (
	descSheets       = desc("leadsheet_sheets", "Sheets in the index.")
	descSheetsByKind = desc("leadsheet_sheets_by_kind", "Sheets in the index, by kind.", "kind")
	descAuthors      = desc("leadsheet_authors", "Accounts with at least one sheet.")
	descSheets24h    = desc("leadsheet_sheets_created_24h", "Sheets created in the last 24 hours.")
	descDrafts       = desc("leadsheet_drafts", "Unpublished sheets (drafts) in the index.")
	descRatings      = desc("leadsheet_ratings", "Rated sheets, counting each account's newest rating once.")
	descFavorites    = desc("leadsheet_favorites", "Saved sheets, counting each account and sheet once.")
	descAccounts     = desc("leadsheet_accounts", "Accounts known to the index (authors and people who've signed in).")
	descSignedIn     = desc("leadsheet_signed_in_accounts", "Accounts with an unexpired browser session.")
	descOGCards      = desc("leadsheet_og_cards_stored", "Share cards stored in Postgres.")
	descDBSize       = desc("leadsheet_db_size_bytes", "Size of the Postgres database.")
	descUsageAge     = desc("leadsheet_usage_age_seconds", "Seconds since the usage gauges were counted.")

	descPoolTotal    = desc("leadsheet_db_pool_conns", "Connections in the pool, by state.", "state")
	descPoolMax      = desc("leadsheet_db_pool_max_conns", "Pool size limit.")
	descPoolAcquires = desc("leadsheet_db_pool_acquires_total", "Connections acquired from the pool.")
	descPoolWaits    = desc("leadsheet_db_pool_empty_acquires_total", "Acquires that had to wait for a connection.")
	descPoolWaitTime = desc("leadsheet_db_pool_acquire_seconds_total", "Total time spent acquiring connections.")
)

func (c *Collector) Describe(ch chan<- *prometheus.Desc) {
	for _, d := range []*prometheus.Desc{descSheets, descSheetsByKind, descAuthors, descSheets24h, descDrafts, descRatings,
		descFavorites, descAccounts, descSignedIn, descOGCards, descDBSize, descUsageAge,
		descPoolTotal, descPoolMax, descPoolAcquires, descPoolWaits, descPoolWaitTime} {
		ch <- d
	}
}

func (c *Collector) Collect(ch chan<- prometheus.Metric) {
	gauge := func(d *prometheus.Desc, v float64, labels ...string) {
		ch <- prometheus.MustNewConstMetric(d, prometheus.GaugeValue, v, labels...)
	}
	c.mu.Lock()
	u, countedAt := c.usage, c.countedAt
	c.mu.Unlock()
	if u != nil {
		gauge(descUsageAge, time.Since(countedAt).Seconds())
		gauge(descSheets, float64(u.Sheets))
		gauge(descAuthors, float64(u.Authors))
		gauge(descSheets24h, float64(u.Sheets24h))
		gauge(descDrafts, float64(u.Drafts))
		gauge(descRatings, float64(u.Ratings))
		gauge(descFavorites, float64(u.Favorites))
		gauge(descAccounts, float64(u.Accounts))
		gauge(descSignedIn, float64(u.SignedInAccounts))
		gauge(descOGCards, float64(u.OgCards))
		gauge(descDBSize, float64(u.DbSizeBytes))
		for _, kind := range []string{"chords", "tab", "ukulele", "bass"} {
			gauge(descSheetsByKind, float64(u.SheetsByKind[kind]), kind)
		}
	}

	st := c.store.PoolStat()
	gauge(descPoolTotal, float64(st.AcquiredConns()), "acquired")
	gauge(descPoolTotal, float64(st.IdleConns()), "idle")
	gauge(descPoolTotal, float64(st.ConstructingConns()), "constructing")
	gauge(descPoolMax, float64(st.MaxConns()))
	ch <- prometheus.MustNewConstMetric(descPoolAcquires, prometheus.CounterValue, float64(st.AcquireCount()))
	ch <- prometheus.MustNewConstMetric(descPoolWaits, prometheus.CounterValue, float64(st.EmptyAcquireCount()))
	ch <- prometheus.MustNewConstMetric(descPoolWaitTime, prometheus.CounterValue, st.AcquireDuration().Seconds())
}
