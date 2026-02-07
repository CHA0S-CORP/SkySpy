package airband

// FilterResult describes why a file was filtered.
type FilterResult struct {
	Passed bool
	Reason string // "too_small", "too_short", "too_short_estimated"
}

// CheckSize rejects files smaller than minFileSize bytes.
func CheckSize(fileSize int64, minFileSize int) FilterResult {
	if fileSize < int64(minFileSize) {
		return FilterResult{Passed: false, Reason: "too_small"}
	}
	return FilterResult{Passed: true}
}

// CheckDuration estimates duration from file size and rejects files shorter
// than minDuration seconds. Uses ~24kbps = ~3000 bytes/second for voice MP3,
// matching the Python uploader's fallback estimation.
func CheckDuration(fileSize int64, minDuration float64) FilterResult {
	estimatedDuration := float64(fileSize) / 3000.0
	if estimatedDuration < minDuration {
		return FilterResult{Passed: false, Reason: "too_short_estimated"}
	}
	return FilterResult{Passed: true}
}

// Filter applies all filtering checks to a file's metadata.
// Returns the first failing filter result, or a passing result.
func Filter(meta FileMetadata, minFileSize int, minDuration float64) FilterResult {
	if r := CheckSize(meta.FileSize, minFileSize); !r.Passed {
		return r
	}
	if r := CheckDuration(meta.FileSize, minDuration); !r.Passed {
		return r
	}
	return FilterResult{Passed: true}
}
