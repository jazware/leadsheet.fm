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
func (s *Store) UpsertProfile(ctx context.Context, p ProfileUpdate) error {
	return s.q.UpsertProfile(ctx, dbq.UpsertProfileParams{
		Did: p.DID, Handle: strings.ToLower(p.Handle), DisplayName: p.DisplayName, Avatar: p.Avatar,
		KeepHandle: !p.HandleKnown, KeepProfile: !p.ProfileKnown,
	})
}

// ProfileUpdate is a freshly resolved profile. A part whose lookup failed
// (not known) keeps its previous value, so an outage doesn't blank it.
type ProfileUpdate struct {
	Author
	HandleKnown  bool
	ProfileKnown bool
}

// MarkProfileStale queues a known account for re-resolution (after an
// identity event). Unknown DIDs are ignored.
func (s *Store) MarkProfileStale(ctx context.Context, did string) error {
	return s.q.MarkProfileStale(ctx, did)
}

// SetHidden hides or unhides a known account's records, and recounts the
// sheets its forks count toward (hidden accounts' forks aren't counted).
func (s *Store) SetHidden(ctx context.Context, did string, hidden bool) error {
	return s.tx(ctx, func(q *dbq.Queries) error {
		if err := q.SetHidden(ctx, dbq.SetHiddenParams{Did: did, Hidden: hidden}); err != nil {
			return err
		}
		subjects, err := q.AccountSubjects(ctx, did)
		if err != nil {
			return err
		}
		return recomputeAll(ctx, q, subjects...)
	})
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
