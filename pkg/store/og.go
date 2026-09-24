package store

import (
	"context"
	"time"

	"github.com/jazware/leadsheet.fm/pkg/store/dbq"
)

// OGCard returns a sheet's stored link-preview image if it was drawn from
// this version of the sheet no earlier than freshAfter, else ErrNotFound.
func (s *Store) OGCard(ctx context.Context, uri, version string, freshAfter time.Time) ([]byte, error) {
	png, err := s.q.GetOGCard(ctx, dbq.GetOGCardParams{Uri: uri, Version: version, RenderedAt: freshAfter})
	if err != nil {
		return nil, noRows(err)
	}
	return png, nil
}

// PutOGCard stores a sheet's image, replacing any earlier one.
func (s *Store) PutOGCard(ctx context.Context, uri, version string, png []byte) error {
	return s.q.PutOGCard(ctx, dbq.PutOGCardParams{Uri: uri, Version: version, Png: png})
}
