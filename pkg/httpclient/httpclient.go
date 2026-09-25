// Package httpclient holds Leadsheet's outbound HTTP clients: timeouts,
// pooling, retries for reads, and a trace span per request (see
// robusthttp).
package httpclient

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/bluesky-social/indigo/atproto/atclient"
	"github.com/bluesky-social/indigo/atproto/auth/oauth"
	"github.com/bluesky-social/indigo/atproto/identity"
	"github.com/bluesky-social/indigo/util/ssrf"
	"github.com/jazware/leadsheet.fm/telemetry/robusthttp"
	"github.com/jazware/leadsheet.fm/version"
)

var UserAgent = "leadsheet/" + version.String() + " (+https://leadsheet.fm)"

var (
	// For services we configure (the relay, the Bluesky AppView).
	trusted = robusthttp.NewClient(robusthttp.WithUserAgent(UserAgent))
	// For hosts taken from records and DID documents (PDSes): no
	// connecting to private addresses.
	public = robusthttp.NewClient(robusthttp.WithUserAgent(UserAgent), robusthttp.WithDialer(ssrf.PublicOnlyDialer()))
)

// New returns a client for a service we configure, bounded by timeout.
func New(timeout time.Duration) *http.Client {
	return robusthttp.NewClient(robusthttp.WithUserAgent(UserAgent), robusthttp.WithTimeout(timeout))
}

// API is an XRPC client for a service we configure.
func API(host string) *atclient.APIClient { return apiClient(host, trusted) }

// PDS is an XRPC client for an account's PDS (a host from its DID document).
func PDS(host string) *atclient.APIClient { return apiClient(host, public) }

func apiClient(host string, c *http.Client) *atclient.APIClient {
	api := atclient.NewAPIClient(host)
	api.Client = c
	api.Headers.Set("User-Agent", UserAgent)
	return api
}

// Directory is indigo's default identity directory, traced, with retries
// on PLC directory reads. did:web and handle resolution keep indigo's
// SSRF-safe transport.
func Directory() identity.Directory {
	dir := identity.DefaultDirectory()
	if base := baseDirectory(dir); base != nil {
		base.HTTPClient.Transport = robusthttp.Instrument(base.HTTPClient.Transport)
		base.PLCClient = robusthttp.NewClient(robusthttp.WithUserAgent(UserAgent), robusthttp.WithTimeout(10*time.Second))
		base.UserAgent = UserAgent
	}
	return dir
}

// InstrumentOAuth traces the OAuth client's requests (keeping its
// SSRF-safe transports; token requests are POSTs, never retried) and has
// it share dir.
func InstrumentOAuth(app *oauth.ClientApp, dir identity.Directory) {
	app.Client.Transport = robusthttp.Instrument(app.Client.Transport)
	if app.Resolver != nil && app.Resolver.Client != nil {
		app.Resolver.Client.Transport = robusthttp.Instrument(app.Resolver.Client.Transport)
	}
	app.Dir = dir
}

func baseDirectory(dir identity.Directory) *identity.BaseDirectory {
	if c, ok := dir.(*identity.CacheDirectory); ok {
		if b, ok := c.Inner.(*identity.BaseDirectory); ok {
			return b
		}
	}
	slog.Warn("identity directory isn't the expected type; its requests won't be traced")
	return nil
}
