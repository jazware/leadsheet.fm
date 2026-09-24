package store

import (
	"context"
	"errors"

	"github.com/jazware/leadsheet.fm/pkg/records"
	"github.com/jazware/leadsheet.fm/pkg/store/dbq"
)

// Bayesian rating prior: every sheet starts as if it had priorWeight
// ratings of priorMean stars.
const (
	priorMean   = 3.0
	priorWeight = 2.0
)

// recomputeAll refreshes sheet_stats for each distinct, non-empty URI.
func recomputeAll(ctx context.Context, q *dbq.Queries, uris ...string) error {
	seen := map[string]bool{}
	for _, uri := range uris {
		if uri == "" || seen[uri] {
			continue
		}
		seen[uri] = true
		if err := q.RecomputeStats(ctx, dbq.RecomputeStatsParams{Uri: uri, PriorMean: priorMean, PriorWeight: priorWeight}); err != nil {
			return err
		}
	}
	return nil
}

// subject reads the subject of an existing rating/favorite ("" if none).
func subject(uri string, err error) (string, error) {
	if errors.Is(noRows(err), ErrNotFound) {
		return "", nil
	}
	return uri, err
}

func (s *Store) UpsertRating(ctx context.Context, uri, did string, rec *records.Rating) error {
	return s.tx(ctx, func(q *dbq.Queries) error {
		old, err := subject(q.RatingSubject(ctx, uri))
		if err != nil {
			return err
		}
		if err := q.UpsertRating(ctx, dbq.UpsertRatingParams{
			Uri: uri, Did: did, SubjectUri: rec.Subject.URI, SubjectCid: rec.Subject.CID,
			Value: int32(rec.Value), CreatedAt: parseTime(rec.CreatedAt),
		}); err != nil {
			return err
		}
		return recomputeAll(ctx, q, old, rec.Subject.URI)
	})
}

func (s *Store) UpsertFavorite(ctx context.Context, uri, did string, rec *records.Favorite) error {
	return s.tx(ctx, func(q *dbq.Queries) error {
		old, err := subject(q.FavoriteSubject(ctx, uri))
		if err != nil {
			return err
		}
		if err := q.UpsertFavorite(ctx, dbq.UpsertFavoriteParams{
			Uri: uri, Did: did, SubjectUri: rec.Subject.URI, SubjectCid: rec.Subject.CID,
			CreatedAt: parseTime(rec.CreatedAt),
		}); err != nil {
			return err
		}
		return recomputeAll(ctx, q, old, rec.Subject.URI)
	})
}

func (s *Store) DeleteRating(ctx context.Context, uri string) error {
	return s.tx(ctx, func(q *dbq.Queries) error {
		subj, err := subject(q.DeleteRating(ctx, uri))
		if err != nil {
			return err
		}
		return recomputeAll(ctx, q, subj)
	})
}

func (s *Store) DeleteFavorite(ctx context.Context, uri string) error {
	return s.tx(ctx, func(q *dbq.Queries) error {
		subj, err := subject(q.DeleteFavorite(ctx, uri))
		if err != nil {
			return err
		}
		return recomputeAll(ctx, q, subj)
	})
}

// ViewerState is what the signed-in account has done to a sheet: the URIs
// of its records, so the UI can update or delete them.
type ViewerState struct {
	Rating       int      `json:"rating"` // 0 = not rated
	RatingURIs   []string `json:"ratingUris"`
	FavoriteURIs []string `json:"favoriteUris"`
}

func (s *Store) GetViewerState(ctx context.Context, did, subject string) (*ViewerState, error) {
	ratings, err := s.q.ViewerRatings(ctx, dbq.ViewerRatingsParams{Did: did, SubjectUri: subject})
	if err != nil {
		return nil, err
	}
	favs, err := s.q.ViewerFavorites(ctx, dbq.ViewerFavoritesParams{Did: did, SubjectUri: subject})
	if err != nil {
		return nil, err
	}
	vs := &ViewerState{RatingURIs: []string{}, FavoriteURIs: favs}
	for i, r := range ratings {
		if i == 0 {
			vs.Rating = int(r.Value)
		}
		vs.RatingURIs = append(vs.RatingURIs, r.Uri)
	}
	return vs, nil
}

// Favorites lists the sheets an account has favorited, newest first.
func (s *Store) Favorites(ctx context.Context, did string) ([]SheetSummary, error) {
	return summaries(s.q.FavoriteSheets(ctx, did))
}

// PurgeAccount drops everything a deleted account wrote.
func (s *Store) PurgeAccount(ctx context.Context, did string) error {
	return s.tx(ctx, func(q *dbq.Queries) error {
		subjects, err := q.AccountSubjects(ctx, did)
		if err != nil {
			return err
		}
		for _, del := range []func(context.Context, string) error{
			q.DeleteAccountOGCards, q.DeleteAccountSheets, q.DeleteAccountRatings, q.DeleteAccountFavorites, q.DeleteProfile,
		} {
			if err := del(ctx, did); err != nil {
				return err
			}
		}
		return recomputeAll(ctx, q, subjects...)
	})
}
