package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jazware/leadsheet.fm/pkg/store/dbq"
)

// GetAuthor looks up an account by DID or handle.
func (s *Store) GetAuthor(ctx context.Context, actor string) (*Author, error) {
	var r dbq.AuthorByDIDRow
	var err error
	if strings.HasPrefix(actor, "did:") {
		r, err = s.q.AuthorByDID(ctx, actor)
	} else {
		var h dbq.AuthorByHandleRow
		h, err = s.q.AuthorByHandle(ctx, strings.ToLower(actor))
		r = dbq.AuthorByDIDRow(h)
	}
	if err != nil {
		return nil, noRows(err)
	}
	return &Author{DID: r.Did, Handle: r.Handle, DisplayName: r.DisplayName, Avatar: r.Avatar}, nil
}

// UpsertProfile records resolved display info for an account.
func (s *Store) UpsertProfile(ctx context.Context, a Author) error {
	return s.q.UpsertProfile(ctx, dbq.UpsertProfileParams{
		Did: a.DID, Handle: strings.ToLower(a.Handle), DisplayName: a.DisplayName, Avatar: a.Avatar,
	})
}

// MarkProfileStale queues a known account for re-resolution (after an
// identity event). Unknown DIDs are ignored.
func (s *Store) MarkProfileStale(ctx context.Context, did string) error {
	return s.q.MarkProfileStale(ctx, did)
}

// SetHidden hides or unhides a known account's records.
func (s *Store) SetHidden(ctx context.Context, did string, hidden bool) error {
	return s.q.SetHidden(ctx, dbq.SetHiddenParams{Did: did, Hidden: hidden})
}

// StaleProfiles returns DIDs never resolved or last resolved before cutoff.
func (s *Store) StaleProfiles(ctx context.Context, cutoff time.Time, limit int) ([]string, error) {
	return s.q.StaleProfiles(ctx, dbq.StaleProfilesParams{ResolvedAt: &cutoff, Limit: int32(limit)})
}

// State reads an ingest_state value ("" when unset).
func (s *Store) State(ctx context.Context, name string) (string, error) {
	v, err := s.q.GetState(ctx, name)
	if errors.Is(noRows(err), ErrNotFound) {
		return "", nil
	}
	return v, err
}

func (s *Store) SetState(ctx context.Context, name, value string) error {
	return s.q.SetState(ctx, dbq.SetStateParams{Name: name, Value: value})
}
