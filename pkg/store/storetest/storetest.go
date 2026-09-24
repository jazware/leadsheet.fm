// Package storetest gives tests a store backed by a fresh Postgres
// database, created on the server at LEADSHEET_TEST_DATABASE_URL (`just
// test` starts one) and dropped when the test ends.
package storetest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jazware/leadsheet.fm/pkg/store"
)

const envVar = "LEADSHEET_TEST_DATABASE_URL"

func New(t *testing.T) *store.Store {
	t.Helper()
	admin := os.Getenv(envVar)
	if admin == "" {
		t.Skipf("%s not set; run `just test` to start a throwaway Postgres", envVar)
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		t.Fatalf("connecting to test postgres: %v", err)
	}
	defer conn.Close(ctx)

	buf := make([]byte, 6)
	rand.Read(buf)
	name := "leadsheet_test_" + hex.EncodeToString(buf)
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatalf("creating test database: %v", err)
	}
	t.Cleanup(func() {
		c, err := pgx.Connect(context.Background(), admin)
		if err != nil {
			return
		}
		defer c.Close(context.Background())
		c.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
	})

	u, err := url.Parse(admin)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	st, err := store.Open(ctx, u.String())
	if err != nil {
		t.Fatalf("opening test store: %v", err)
	}
	t.Cleanup(st.Close)
	return st
}
