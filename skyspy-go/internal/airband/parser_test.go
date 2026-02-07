package airband

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseFilename_StandardFormat(t *testing.T) {
	// Create a temp MP3 file with standard naming
	dir := t.TempDir()
	fpath := filepath.Join(dir, "airband_119900000_20260104_123005.mp3")
	if err := os.WriteFile(fpath, make([]byte, 5000), 0o644); err != nil {
		t.Fatal(err)
	}

	chanMap := NewChannelMap(map[string]string{
		"119900000": "SEA-Twr-16L34R",
	})

	meta := ParseFilename(fpath, chanMap)

	if meta.Filename != "airband_119900000_20260104_123005.mp3" {
		t.Errorf("expected filename airband_119900000_20260104_123005.mp3, got %s", meta.Filename)
	}
	if meta.ChannelName != "SEA-Twr-16L34R" {
		t.Errorf("expected channel SEA-Twr-16L34R, got %s", meta.ChannelName)
	}
	if meta.FrequencyMHz != 119.9 {
		t.Errorf("expected frequency 119.9, got %f", meta.FrequencyMHz)
	}
	if !meta.HasFrequency {
		t.Error("expected HasFrequency to be true")
	}
	if !meta.HasTimestamp {
		t.Error("expected HasTimestamp to be true")
	}
	expected := time.Date(2026, 1, 4, 12, 30, 5, 0, time.UTC)
	if !meta.Timestamp.Equal(expected) {
		t.Errorf("expected timestamp %v, got %v", expected, meta.Timestamp)
	}
	if meta.FileSize != 5000 {
		t.Errorf("expected file size 5000, got %d", meta.FileSize)
	}
}

func TestParseFilename_AlternateFormat(t *testing.T) {
	dir := t.TempDir()
	fpath := filepath.Join(dir, "prefix_20260104_120000_119900000.mp3")
	if err := os.WriteFile(fpath, make([]byte, 3000), 0o644); err != nil {
		t.Fatal(err)
	}

	chanMap := NewChannelMap(map[string]string{
		"119900000": "SEA-Twr-16L34R",
	})

	meta := ParseFilename(fpath, chanMap)

	if meta.ChannelName != "SEA-Twr-16L34R" {
		t.Errorf("expected channel SEA-Twr-16L34R, got %s", meta.ChannelName)
	}
	if meta.FrequencyMHz != 119.9 {
		t.Errorf("expected frequency 119.9, got %f", meta.FrequencyMHz)
	}
	expected := time.Date(2026, 1, 4, 12, 0, 0, 0, time.UTC)
	if !meta.Timestamp.Equal(expected) {
		t.Errorf("expected timestamp %v, got %v", expected, meta.Timestamp)
	}
}

func TestParseFilename_UnknownFrequency(t *testing.T) {
	dir := t.TempDir()
	fpath := filepath.Join(dir, "airband_125000000_20260104_120000.mp3")
	if err := os.WriteFile(fpath, make([]byte, 1000), 0o644); err != nil {
		t.Fatal(err)
	}

	chanMap := NewChannelMap(map[string]string{
		"119900000": "SEA-Twr-16L34R",
	})

	meta := ParseFilename(fpath, chanMap)

	if meta.ChannelName != "Unknown-125.000" {
		t.Errorf("expected channel Unknown-125.000, got %s", meta.ChannelName)
	}
}

func TestParseFilename_UnknownFormat(t *testing.T) {
	dir := t.TempDir()
	fpath := filepath.Join(dir, "randomfile.mp3")
	if err := os.WriteFile(fpath, make([]byte, 1000), 0o644); err != nil {
		t.Fatal(err)
	}

	meta := ParseFilename(fpath, nil)

	if meta.ChannelName != "randomfile" {
		t.Errorf("expected channel 'randomfile', got %s", meta.ChannelName)
	}
	if meta.HasFrequency {
		t.Error("expected HasFrequency to be false")
	}
	if meta.HasTimestamp {
		t.Error("expected HasTimestamp to be false")
	}
}

func TestParseFilename_NilChannelMap(t *testing.T) {
	dir := t.TempDir()
	fpath := filepath.Join(dir, "airband_119900000_20260104_120000.mp3")
	if err := os.WriteFile(fpath, make([]byte, 1000), 0o644); err != nil {
		t.Fatal(err)
	}

	meta := ParseFilename(fpath, nil)

	if meta.ChannelName != "Unknown-119.900" {
		t.Errorf("expected channel Unknown-119.900, got %s", meta.ChannelName)
	}
}

func TestChannelMap_Lookup(t *testing.T) {
	cm := NewChannelMap(map[string]string{
		"119900000": "SEA-Twr-16L34R",
		"121500000": "Guard",
	})

	if cm.Lookup(119900000) != "SEA-Twr-16L34R" {
		t.Errorf("expected SEA-Twr-16L34R, got %s", cm.Lookup(119900000))
	}
	if cm.Lookup(121500000) != "Guard" {
		t.Errorf("expected Guard, got %s", cm.Lookup(121500000))
	}
	if cm.Lookup(125000000) != "Unknown-125.000" {
		t.Errorf("expected Unknown-125.000, got %s", cm.Lookup(125000000))
	}
	if cm.Size() != 2 {
		t.Errorf("expected size 2, got %d", cm.Size())
	}
}
