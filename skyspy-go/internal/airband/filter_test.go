package airband

import (
	"testing"
)

func TestCheckSize_Pass(t *testing.T) {
	r := CheckSize(5000, 2048)
	if !r.Passed {
		t.Error("expected file to pass size check")
	}
}

func TestCheckSize_Fail(t *testing.T) {
	r := CheckSize(1000, 2048)
	if r.Passed {
		t.Error("expected file to fail size check")
	}
	if r.Reason != "too_small" {
		t.Errorf("expected reason 'too_small', got %s", r.Reason)
	}
}

func TestCheckSize_ExactBoundary(t *testing.T) {
	r := CheckSize(2048, 2048)
	if !r.Passed {
		t.Error("expected file at exact boundary to pass")
	}
}

func TestCheckDuration_Pass(t *testing.T) {
	// 9000 bytes / 3000 = 3.0 seconds, >= 2.0
	r := CheckDuration(9000, 2.0)
	if !r.Passed {
		t.Error("expected file to pass duration check")
	}
}

func TestCheckDuration_Fail(t *testing.T) {
	// 3000 bytes / 3000 = 1.0 seconds, < 2.0
	r := CheckDuration(3000, 2.0)
	if r.Passed {
		t.Error("expected file to fail duration check")
	}
	if r.Reason != "too_short_estimated" {
		t.Errorf("expected reason 'too_short_estimated', got %s", r.Reason)
	}
}

func TestFilter_PassesAll(t *testing.T) {
	meta := FileMetadata{FileSize: 10000}
	r := Filter(meta, 2048, 2.0)
	if !r.Passed {
		t.Error("expected file to pass all filters")
	}
}

func TestFilter_FailsSize(t *testing.T) {
	meta := FileMetadata{FileSize: 100}
	r := Filter(meta, 2048, 2.0)
	if r.Passed {
		t.Error("expected file to fail size filter")
	}
	if r.Reason != "too_small" {
		t.Errorf("expected reason 'too_small', got %s", r.Reason)
	}
}

func TestFilter_PassesSizeFailsDuration(t *testing.T) {
	// 3000 bytes passes size (>2048) but fails duration (3000/3000 = 1.0s < 2.0s)
	meta := FileMetadata{FileSize: 3000}
	r := Filter(meta, 2048, 2.0)
	if r.Passed {
		t.Error("expected file to fail duration filter")
	}
	if r.Reason != "too_short_estimated" {
		t.Errorf("expected reason 'too_short_estimated', got %s", r.Reason)
	}
}
