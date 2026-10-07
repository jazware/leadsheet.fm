package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/urfave/cli/v2"
)

func writeFile(t *testing.T, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(p, []byte(content), 0o400); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestReadSecret(t *testing.T) {
	for _, tc := range []struct{ name, content, want string }{
		{"no newline", "s3cret", "s3cret"},
		{"one newline", "s3cret\n", "s3cret"},
		{"crlf", "s3cret\r\n", "s3cret"},
		{"only one newline trimmed", "s3cret\n\n", "s3cret\n"},
		{"inner whitespace kept", " a b \n", " a b "},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := readSecret("X", "", writeFile(t, tc.content))
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}

	t.Run("no file", func(t *testing.T) {
		got, err := readSecret("X", "plain", "")
		if err != nil || got != "plain" {
			t.Fatalf("got %q, %v", got, err)
		}
	})

	errCases := []struct{ name, value, content, want string }{
		{"both set", "plain-value", "file-value", "set X or X_FILE, not both"},
		{"empty file", "", "", "is empty"},
		{"newline only", "", "\n", "is empty"},
	}
	for _, tc := range errCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := readSecret("X", tc.value, writeFile(t, tc.content))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("got %v, want %q", err, tc.want)
			}
			if strings.Contains(err.Error(), "value") {
				t.Fatalf("error leaks a value: %v", err)
			}
		})
	}

	t.Run("missing file", func(t *testing.T) {
		p := filepath.Join(t.TempDir(), "nope")
		_, err := readSecret("X", "", p)
		if err == nil || err.Error() != "X_FILE: can't read "+p+": no such file or directory" {
			t.Fatalf("got %v", err)
		}
	})
}

// runFlags parses args and env through a cli.App with a secret flag the way
// main declares them, and returns secretFlag's result.
func runFlags(t *testing.T, args ...string) (string, error) {
	t.Helper()
	var got string
	var gotErr error
	app := &cli.App{
		Flags: []cli.Flag{
			&cli.StringFlag{Name: "database-url", EnvVars: []string{"LEADSHEET_DATABASE_URL"}, Value: "postgres://default"},
			&cli.StringFlag{Name: "oauth-client-key", EnvVars: []string{"LEADSHEET_OAUTH_CLIENT_KEY"}},
		},
		Action: func(cctx *cli.Context) error {
			if got, gotErr = secretFlag(cctx, "database-url", "LEADSHEET_DATABASE_URL"); gotErr != nil {
				return nil
			}
			key, err := secretFlag(cctx, "oauth-client-key", "LEADSHEET_OAUTH_CLIENT_KEY")
			got += "|" + key
			gotErr = err
			return nil
		},
	}
	if err := app.Run(append([]string{"leadsheet"}, args...)); err != nil {
		t.Fatal(err)
	}
	return got, gotErr
}

func TestSecretFlag(t *testing.T) {
	t.Run("defaults", func(t *testing.T) {
		got, err := runFlags(t)
		if err != nil || got != "postgres://default|" {
			t.Fatalf("got %q, %v", got, err)
		}
	})

	t.Run("plain env", func(t *testing.T) {
		t.Setenv("LEADSHEET_DATABASE_URL", "postgres://env")
		t.Setenv("LEADSHEET_OAUTH_CLIENT_KEY", "zKey")
		got, err := runFlags(t)
		if err != nil || got != "postgres://env|zKey" {
			t.Fatalf("got %q, %v", got, err)
		}
	})

	t.Run("files over defaults", func(t *testing.T) {
		t.Setenv("LEADSHEET_DATABASE_URL_FILE", writeFile(t, "postgres://file\n"))
		t.Setenv("LEADSHEET_OAUTH_CLIENT_KEY_FILE", writeFile(t, "zFileKey\n"))
		got, err := runFlags(t)
		if err != nil || got != "postgres://file|zFileKey" {
			t.Fatalf("got %q, %v", got, err)
		}
	})

	// compose passes LEADSHEET_OAUTH_CLIENT_KEY: "" when the env file leaves it out.
	t.Run("empty env is unset", func(t *testing.T) {
		t.Setenv("LEADSHEET_OAUTH_CLIENT_KEY", "")
		t.Setenv("LEADSHEET_OAUTH_CLIENT_KEY_FILE", writeFile(t, "zFileKey"))
		got, err := runFlags(t)
		if err != nil || got != "postgres://default|zFileKey" {
			t.Fatalf("got %q, %v", got, err)
		}
	})

	t.Run("env and file", func(t *testing.T) {
		t.Setenv("LEADSHEET_OAUTH_CLIENT_KEY", "zEnvKey")
		t.Setenv("LEADSHEET_OAUTH_CLIENT_KEY_FILE", writeFile(t, "zFileKey"))
		_, err := runFlags(t)
		if err == nil || err.Error() != "set LEADSHEET_OAUTH_CLIENT_KEY or LEADSHEET_OAUTH_CLIENT_KEY_FILE, not both" {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("flag and file", func(t *testing.T) {
		t.Setenv("LEADSHEET_DATABASE_URL_FILE", writeFile(t, "postgres://file"))
		_, err := runFlags(t, "--database-url", "postgres://flag")
		if err == nil || !strings.Contains(err.Error(), "not both") || strings.Contains(err.Error(), "postgres://") {
			t.Fatalf("got %v", err)
		}
	})
}
