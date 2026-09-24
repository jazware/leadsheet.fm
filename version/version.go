package version

var (
	Version   = "dev"     // Semantic version, set via ldflags
	GitCommit = "unknown" // Git SHA, set via ldflags
	BuildTime = "unknown" // Build timestamp, set via ldflags
)

func String() string {
	return Version + " (" + GitCommit + ")"
}
