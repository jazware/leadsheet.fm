package store_test

import (
	"context"
	"net/url"
	"testing"
	"time"

	. "github.com/jazware/leadsheet.fm/pkg/store"
	"github.com/jazware/leadsheet.fm/pkg/store/storetest"
)

// The password argument (LEADSHEET_DATABASE_PASSWORD[_FILE]) replaces the
// one in the connection string.
func TestOpenPasswordOverride(t *testing.T) {
	u, err := url.Parse(storetest.URL(t))
	if err != nil {
		t.Fatal(err)
	}
	password, ok := u.User.Password()
	if !ok {
		t.Skip("LEADSHEET_TEST_DATABASE_URL has no password")
	}
	u.User = url.UserPassword(u.User.Username(), "wrong")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if st, err := Open(ctx, u.String(), ""); err == nil {
		st.Close()
		t.Fatal("opened with the wrong password")
	}
	st, err := Open(ctx, u.String(), password)
	if err != nil {
		t.Fatalf("opening with the password override: %v", err)
	}
	st.Close()

	u.User = url.User(u.User.Username())
	st, err = Open(ctx, u.String(), password)
	if err != nil {
		t.Fatalf("opening a password-less URL with the override: %v", err)
	}
	st.Close()
}
