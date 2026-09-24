// Package store is Leadsheet's index in Postgres: sheets, ratings,
// favorites and profiles folded from the network, plus OAuth and browser
// sessions.
package store

import (
	"context"
	"embed"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	migratepgx "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/jazware/leadsheet.fm/pkg/store/dbq"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// ErrNotFound is returned when a row doesn't exist.
var ErrNotFound = errors.New("not found")

// Store wraps the Postgres pool for all leadsheet persistence. Queries
// live in queries.sql; `just sqlc` generates package dbq from them.
type Store struct {
	db *pgxpool.Pool
	q  *dbq.Queries
}

// Open connects to Postgres at dsn and applies pending migrations.
func Open(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connecting to postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connecting to postgres: %w", err)
	}
	if err := migrateUp(pool); err != nil {
		pool.Close()
		return nil, fmt.Errorf("migrating database: %w", err)
	}
	return &Store{db: pool, q: dbq.New(pool)}, nil
}

func (s *Store) Close() {
	s.db.Close()
}

func migrateUp(pool *pgxpool.Pool) error {
	src, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		return err
	}
	db := stdlib.OpenDBFromPool(pool)
	driver, err := migratepgx.WithInstance(db, &migratepgx.Config{})
	if err != nil {
		db.Close()
		return err
	}
	m, err := migrate.NewWithInstance("iofs", src, "pgx5", driver)
	if err != nil {
		driver.Close()
		return err
	}
	// Closing releases the connection the driver holds; the pool can't
	// close until it's back.
	defer m.Close()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}
	return nil
}

// tx runs fn with queries bound to one transaction.
func (s *Store) tx(ctx context.Context, fn func(*dbq.Queries) error) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error { return fn(s.q.WithTx(tx)) })
}

// noRows maps "no row" to ErrNotFound.
func noRows(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
