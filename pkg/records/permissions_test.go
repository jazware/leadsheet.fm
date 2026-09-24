package records

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/jazware/leadsheet.fm/lexicons"
)

// The fm.leadsheet.authFull permission set (what sign-in requests) must
// grant exactly the collections the app writes.
func TestPermissionSetCoversCollections(t *testing.T) {
	raw, err := lexicons.FS.ReadFile("fm/leadsheet/authFull.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Defs struct {
			Main struct {
				Permissions []struct {
					Resource   string   `json:"resource"`
					Collection []string `json:"collection"`
				} `json:"permissions"`
			} `json:"main"`
		} `json:"defs"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	var granted []string
	for _, p := range doc.Defs.Main.Permissions {
		if p.Resource == "repo" {
			granted = append(granted, p.Collection...)
		}
	}
	want := slices.Clone(Collections)
	slices.Sort(granted)
	slices.Sort(want)
	if !slices.Equal(granted, want) {
		t.Fatalf("authFull grants %v, app writes %v", granted, want)
	}
}
