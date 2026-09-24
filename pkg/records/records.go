// Package records defines the fm.leadsheet.* record types and validates
// raw records (from the firehose, a backfill, or our own writes) against
// the embedded lexicons.
package records

import (
	"encoding/json"
	"fmt"

	"github.com/bluesky-social/indigo/atproto/atdata"
	"github.com/bluesky-social/indigo/atproto/lexicon"
	"github.com/jazware/leadsheet.fm/lexicons"
)

const (
	NSIDSheet    = "fm.leadsheet.sheet"
	NSIDRating   = "fm.leadsheet.rating"
	NSIDFavorite = "fm.leadsheet.favorite"
)

// Collections is every collection Leadsheet indexes.
var Collections = []string{NSIDSheet, NSIDRating, NSIDFavorite}

// StrongRef is com.atproto.repo.strongRef.
type StrongRef struct {
	URI string `json:"uri"`
	CID string `json:"cid"`
}

type Sheet struct {
	Type        string     `json:"$type"`
	Title       string     `json:"title"`
	Artist      string     `json:"artist"`
	Album       string     `json:"album,omitempty"`
	Kind        string     `json:"kind,omitempty"`
	Format      string     `json:"format,omitempty"`
	Content     string     `json:"content"`
	Key         string     `json:"key,omitempty"`
	Capo        *int64     `json:"capo,omitempty"`
	Tuning      string     `json:"tuning,omitempty"`
	Difficulty  string     `json:"difficulty,omitempty"`
	Description string     `json:"description,omitempty"`
	Tags        []string   `json:"tags,omitempty"`
	ForkOf      *StrongRef `json:"forkOf,omitempty"`
	CreatedAt   string     `json:"createdAt"`
	UpdatedAt   string     `json:"updatedAt,omitempty"`
}

type Rating struct {
	Type      string    `json:"$type"`
	Subject   StrongRef `json:"subject"`
	Value     int64     `json:"value"`
	CreatedAt string    `json:"createdAt"`
}

type Favorite struct {
	Type      string    `json:"$type"`
	Subject   StrongRef `json:"subject"`
	CreatedAt string    `json:"createdAt"`
}

var catalog = func() *lexicon.BaseCatalog {
	cat := lexicon.NewBaseCatalog()
	if err := cat.LoadEmbedFS(lexicons.FS); err != nil {
		panic("loading embedded lexicons: " + err.Error())
	}
	return cat
}()

// Validate checks a record against its collection's lexicon. The record
// may be any JSON-shaped value (a decoded map or one of the structs
// above); it's round-tripped through JSON so numbers and nested objects
// take the shapes the validator expects.
func Validate(collection string, record any) error {
	raw, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("encoding record: %w", err)
	}
	data, err := atdata.UnmarshalJSON(raw)
	if err != nil {
		return fmt.Errorf("decoding record: %w", err)
	}
	return lexicon.ValidateRecord(catalog, data, collection, lexicon.AllowLenientDatetime)
}

// Decode validates a raw record and decodes it into out.
func Decode(collection string, record any, out any) error {
	if err := Validate(collection, record); err != nil {
		return err
	}
	raw, err := json.Marshal(record)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, out)
}
