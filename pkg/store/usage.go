package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jazware/leadsheet.fm/pkg/store/dbq"
)

// Usage is the index's topline numbers, for metrics.
type Usage struct {
	dbq.UsageStatsRow
	SheetsByKind map[string]int64
}

func (s *Store) Usage(ctx context.Context) (*Usage, error) {
	row, err := s.q.UsageStats(ctx, time.Now().Add(-WebSessionTTL))
	if err != nil {
		return nil, err
	}
	kinds, err := s.q.SheetsByKind(ctx)
	if err != nil {
		return nil, err
	}
	u := &Usage{UsageStatsRow: row, SheetsByKind: map[string]int64{}}
	for _, k := range kinds {
		u.SheetsByKind[k.Kind] = k.N
	}
	return u, nil
}

// PoolStat reports the connection pool, for metrics.
func (s *Store) PoolStat() *pgxpool.Stat {
	return s.db.Stat()
}
