package auth

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestTokenSet_IsExpired(t *testing.T) {
	testCases := []struct {
		name      string
		expiresAt time.Time
		expected  bool
	}{
		{
			name:      "expired token (1 hour ago)",
			expiresAt: time.Now().Add(-1 * time.Hour),
			expected:  true,
		},
		{
			name:      "expired token (1 second ago)",
			expiresAt: time.Now().Add(-1 * time.Second),
			expected:  true,
		},
		{
			name:      "valid token (1 hour from now)",
			expiresAt: time.Now().Add(1 * time.Hour),
			expected:  false,
		},
		{
			name:      "valid token (1 minute from now)",
			expiresAt: time.Now().Add(1 * time.Minute),
			expected:  false,
		},
		{
			name:      "expired at exact now",
			expiresAt: time.Now().Add(-1 * time.Millisecond),
			expected:  true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			tokens := &TokenSet{
				AccessToken: "test-token",
				ExpiresAt:   tc.expiresAt,
			}

			if got := tokens.IsExpired(); got != tc.expected {
				t.Errorf("IsExpired() = %v, expected %v", got, tc.expected)
			}
		})
	}
}

func TestTokenSet_NeedsRefresh(t *testing.T) {
	testCases := []struct {
		name      string
		expiresAt time.Time
		expected  bool
	}{
		{
			name:      "expired token needs refresh",
			expiresAt: time.Now().Add(-1 * time.Hour),
			expected:  true,
		},
		{
			name:      "token expiring in 4 minutes needs refresh",
			expiresAt: time.Now().Add(4 * time.Minute),
			expected:  true,
		},
		{
			name:      "token expiring in 5 minutes needs refresh (boundary)",
			expiresAt: time.Now().Add(5 * time.Minute),
			expected:  true,
		},
		{
			name:      "token expiring in 6 minutes does not need refresh",
			expiresAt: time.Now().Add(6 * time.Minute),
			expected:  false,
		},
		{
			name:      "token expiring in 1 hour does not need refresh",
			expiresAt: time.Now().Add(1 * time.Hour),
			expected:  false,
		},
		{
			name:      "token expiring in 4.5 minutes needs refresh",
			expiresAt: time.Now().Add(4*time.Minute + 30*time.Second),
			expected:  true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			tokens := &TokenSet{
				AccessToken: "test-token",
				ExpiresAt:   tc.expiresAt,
			}

			if got := tokens.NeedsRefresh(); got != tc.expected {
				t.Errorf("NeedsRefresh() = %v, expected %v", got, tc.expected)
			}
		})
	}
}

func TestFileTokenStore_SaveLoad(t *testing.T) {
	// Create temporary directory for test
	tempDir, err := os.MkdirTemp("", "skyspy-tokens-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create store with temp directory
	store := &FileTokenStore{
		dir: tempDir,
		key: generateMachineKey(),
	}

	testTokens := &TokenSet{
		AccessToken:  "test-access-token-12345",
		RefreshToken: "test-refresh-token-67890",
		ExpiresAt:    time.Now().Add(1 * time.Hour).Truncate(time.Second),
		TokenType:    "Bearer",
		Host:         "localhost:8080",
		Username:     "testuser",
	}

	// Save tokens
	err = store.Save("localhost:8080", testTokens)
	if err != nil {
		t.Fatalf("failed to save tokens: %v", err)
	}

	// Verify file was created
	expectedFile := filepath.Join(tempDir, "localhost_8080.json")
	if _, err := os.Stat(expectedFile); os.IsNotExist(err) {
		t.Fatalf("expected token file to be created at %s", expectedFile)
	}

	// Load tokens
	loaded, err := store.Load("localhost:8080")
	if err != nil {
		t.Fatalf("failed to load tokens: %v", err)
	}

	if loaded == nil {
		t.Fatal("expected tokens to be loaded")
	}

	// Verify fields
	if loaded.AccessToken != testTokens.AccessToken {
		t.Errorf("AccessToken: expected '%s', got '%s'", testTokens.AccessToken, loaded.AccessToken)
	}

	if loaded.RefreshToken != testTokens.RefreshToken {
		t.Errorf("RefreshToken: expected '%s', got '%s'", testTokens.RefreshToken, loaded.RefreshToken)
	}

	if !loaded.ExpiresAt.Equal(testTokens.ExpiresAt) {
		t.Errorf("ExpiresAt: expected %v, got %v", testTokens.ExpiresAt, loaded.ExpiresAt)
	}

	if loaded.TokenType != testTokens.TokenType {
		t.Errorf("TokenType: expected '%s', got '%s'", testTokens.TokenType, loaded.TokenType)
	}

	if loaded.Host != testTokens.Host {
		t.Errorf("Host: expected '%s', got '%s'", testTokens.Host, loaded.Host)
	}

	if loaded.Username != testTokens.Username {
		t.Errorf("Username: expected '%s', got '%s'", testTokens.Username, loaded.Username)
	}
}

func TestFileTokenStore_Delete(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-tokens-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	store := &FileTokenStore{
		dir: tempDir,
		key: generateMachineKey(),
	}

	testTokens := &TokenSet{
		AccessToken: "test-token",
		ExpiresAt:   time.Now().Add(1 * time.Hour),
		Host:        "delete-test:8080",
	}

	// Save tokens
	err = store.Save("delete-test:8080", testTokens)
	if err != nil {
		t.Fatalf("failed to save tokens: %v", err)
	}

	// Verify tokens exist
	loaded, err := store.Load("delete-test:8080")
	if err != nil || loaded == nil {
		t.Fatal("expected tokens to exist before delete")
	}

	// Delete tokens
	err = store.Delete("delete-test:8080")
	if err != nil {
		t.Fatalf("failed to delete tokens: %v", err)
	}

	// Verify tokens no longer exist
	loaded, err = store.Load("delete-test:8080")
	if err != nil {
		t.Fatalf("unexpected error loading after delete: %v", err)
	}
	if loaded != nil {
		t.Error("expected tokens to be nil after delete")
	}

	// Delete non-existent should not error
	err = store.Delete("nonexistent:9999")
	if err != nil {
		t.Errorf("delete of non-existent should not error: %v", err)
	}
}

func TestFileTokenStore_LoadNonexistent(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-tokens-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	store := &FileTokenStore{
		dir: tempDir,
		key: generateMachineKey(),
	}

	// Try to load tokens that don't exist
	loaded, err := store.Load("nonexistent:8080")
	if err != nil {
		t.Errorf("expected no error for non-existent file, got: %v", err)
	}

	if loaded != nil {
		t.Error("expected nil tokens for non-existent file")
	}
}

func TestFileTokenStore_List(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-tokens-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	store := &FileTokenStore{
		dir: tempDir,
		key: generateMachineKey(),
	}

	// Initially empty
	hosts, err := store.List()
	if err != nil {
		t.Fatalf("failed to list: %v", err)
	}
	if len(hosts) != 0 {
		t.Errorf("expected 0 hosts, got %d", len(hosts))
	}

	// Add some tokens
	testHosts := []string{"server1:8080", "server2:9090", "server3:443"}
	for _, host := range testHosts {
		tokens := &TokenSet{
			AccessToken: "token-" + host,
			ExpiresAt:   time.Now().Add(1 * time.Hour),
			Host:        host,
		}
		if err := store.Save(host, tokens); err != nil {
			t.Fatalf("failed to save tokens for %s: %v", host, err)
		}
	}

	// List should return all hosts
	hosts, err = store.List()
	if err != nil {
		t.Fatalf("failed to list: %v", err)
	}
	if len(hosts) != len(testHosts) {
		t.Errorf("expected %d hosts, got %d", len(testHosts), len(hosts))
	}
}

func TestTokenEncryption(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-tokens-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	store := &FileTokenStore{
		dir: tempDir,
		key: generateMachineKey(),
	}

	sensitiveToken := "super-secret-access-token-do-not-expose"
	sensitiveRefresh := "super-secret-refresh-token"

	testTokens := &TokenSet{
		AccessToken:  sensitiveToken,
		RefreshToken: sensitiveRefresh,
		ExpiresAt:    time.Now().Add(1 * time.Hour),
		TokenType:    "Bearer",
		Host:         "encrypted-test:8080",
		Username:     "secretuser",
	}

	// Save tokens
	err = store.Save("encrypted-test:8080", testTokens)
	if err != nil {
		t.Fatalf("failed to save tokens: %v", err)
	}

	// Read the raw file content
	filename := filepath.Join(tempDir, "encrypted-test_8080.json")
	rawContent, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read token file: %v", err)
	}

	// Verify the raw content is not plain JSON
	var plainTokens TokenSet
	err = json.Unmarshal(rawContent, &plainTokens)
	if err == nil && plainTokens.AccessToken == sensitiveToken {
		t.Error("tokens appear to be stored in plain text (no encryption)")
	}

	// Verify the raw content is base64 encoded (encrypted format)
	_, err = base64.StdEncoding.DecodeString(string(rawContent))
	if err != nil {
		t.Errorf("encrypted content should be base64 encoded: %v", err)
	}

	// Verify the sensitive data is not visible in raw content
	rawStr := string(rawContent)
	if containsSubstring(rawStr, sensitiveToken) {
		t.Error("access token visible in encrypted file")
	}
	if containsSubstring(rawStr, sensitiveRefresh) {
		t.Error("refresh token visible in encrypted file")
	}

	// Verify we can still decrypt and read the tokens
	loaded, err := store.Load("encrypted-test:8080")
	if err != nil {
		t.Fatalf("failed to load encrypted tokens: %v", err)
	}

	if loaded.AccessToken != sensitiveToken {
		t.Errorf("decrypted AccessToken mismatch: expected '%s', got '%s'", sensitiveToken, loaded.AccessToken)
	}

	if loaded.RefreshToken != sensitiveRefresh {
		t.Errorf("decrypted RefreshToken mismatch: expected '%s', got '%s'", sensitiveRefresh, loaded.RefreshToken)
	}
}

func TestTokenEncryption_DifferentKeys(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-tokens-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create store with one key
	key1 := make([]byte, 32)
	for i := range key1 {
		key1[i] = byte(i)
	}
	store1 := &FileTokenStore{
		dir: tempDir,
		key: key1,
	}

	testTokens := &TokenSet{
		AccessToken: "encrypted-token",
		ExpiresAt:   time.Now().Add(1 * time.Hour),
		Host:        "key-test:8080",
	}

	// Save with store1
	err = store1.Save("key-test:8080", testTokens)
	if err != nil {
		t.Fatalf("failed to save tokens: %v", err)
	}

	// Create store with different key
	key2 := make([]byte, 32)
	for i := range key2 {
		key2[i] = byte(i + 100)
	}
	store2 := &FileTokenStore{
		dir: tempDir,
		key: key2,
	}

	// Try to load with different key - should fail
	_, err = store2.Load("key-test:8080")
	if err == nil {
		t.Error("expected error when loading with different key")
	}
}

func TestFileTokenStore_FilePermissions(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-tokens-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	store := &FileTokenStore{
		dir: tempDir,
		key: generateMachineKey(),
	}

	testTokens := &TokenSet{
		AccessToken: "permission-test-token",
		ExpiresAt:   time.Now().Add(1 * time.Hour),
		Host:        "perm-test:8080",
	}

	err = store.Save("perm-test:8080", testTokens)
	if err != nil {
		t.Fatalf("failed to save tokens: %v", err)
	}

	// Check file permissions
	filename := filepath.Join(tempDir, "perm-test_8080.json")
	info, err := os.Stat(filename)
	if err != nil {
		t.Fatalf("failed to stat token file: %v", err)
	}

	mode := info.Mode().Perm()
	// Should be 0600 (owner read/write only)
	if mode != 0600 {
		t.Errorf("expected file permissions 0600, got %o", mode)
	}
}

func TestFileTokenStore_SaveUpdatesExisting(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-tokens-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	store := &FileTokenStore{
		dir: tempDir,
		key: generateMachineKey(),
	}

	// Save initial tokens
	initialTokens := &TokenSet{
		AccessToken: "initial-token",
		ExpiresAt:   time.Now().Add(1 * time.Hour),
		Host:        "update-test:8080",
		Username:    "initial-user",
	}
	err = store.Save("update-test:8080", initialTokens)
	if err != nil {
		t.Fatalf("failed to save initial tokens: %v", err)
	}

	// Update with new tokens
	updatedTokens := &TokenSet{
		AccessToken:  "updated-token",
		RefreshToken: "new-refresh-token",
		ExpiresAt:    time.Now().Add(2 * time.Hour),
		Host:         "update-test:8080",
		Username:     "updated-user",
	}
	err = store.Save("update-test:8080", updatedTokens)
	if err != nil {
		t.Fatalf("failed to save updated tokens: %v", err)
	}

	// Load and verify updated values
	loaded, err := store.Load("update-test:8080")
	if err != nil {
		t.Fatalf("failed to load updated tokens: %v", err)
	}

	if loaded.AccessToken != "updated-token" {
		t.Errorf("expected AccessToken 'updated-token', got '%s'", loaded.AccessToken)
	}

	if loaded.RefreshToken != "new-refresh-token" {
		t.Errorf("expected RefreshToken 'new-refresh-token', got '%s'", loaded.RefreshToken)
	}

	if loaded.Username != "updated-user" {
		t.Errorf("expected Username 'updated-user', got '%s'", loaded.Username)
	}
}

func TestHostToFilename(t *testing.T) {
	testCases := []struct {
		host     string
		expected string
	}{
		{"localhost:8080", "localhost_8080.json"},
		{"192.168.1.1:9090", "192.168.1.1_9090.json"},
		{"api.example.com:443", "api.example.com_443.json"},
		{"server:80", "server_80.json"},
		{"host:with:multiple:colons", "host_with_multiple_colons.json"},
	}

	for _, tc := range testCases {
		t.Run(tc.host, func(t *testing.T) {
			result := hostToFilename(tc.host)
			if result != tc.expected {
				t.Errorf("hostToFilename(%q) = %q, expected %q", tc.host, result, tc.expected)
			}
		})
	}
}

func TestFileTokenStore_CorruptedFile(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-tokens-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	store := &FileTokenStore{
		dir: tempDir,
		key: generateMachineKey(),
	}

	// Create a corrupted file
	filename := filepath.Join(tempDir, "corrupted_8080.json")
	err = os.WriteFile(filename, []byte("not valid base64 or encrypted data!!!"), 0600)
	if err != nil {
		t.Fatalf("failed to create corrupted file: %v", err)
	}

	// Try to load corrupted file
	_, err = store.Load("corrupted:8080")
	if err == nil {
		t.Error("expected error when loading corrupted file")
	}
}

func TestFileTokenStore_EmptyFile(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-tokens-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	store := &FileTokenStore{
		dir: tempDir,
		key: generateMachineKey(),
	}

	// Create an empty file
	filename := filepath.Join(tempDir, "empty_8080.json")
	err = os.WriteFile(filename, []byte(""), 0600)
	if err != nil {
		t.Fatalf("failed to create empty file: %v", err)
	}

	// Try to load empty file
	_, err = store.Load("empty:8080")
	if err == nil {
		t.Error("expected error when loading empty file")
	}
}

func TestTokenSet_JSONSerialization(t *testing.T) {
	original := TokenSet{
		AccessToken:  "access-token-value",
		RefreshToken: "refresh-token-value",
		ExpiresAt:    time.Now().Add(1 * time.Hour).Truncate(time.Second),
		TokenType:    "Bearer",
		Host:         "test:8080",
		Username:     "testuser",
	}

	// Marshal to JSON
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	// Unmarshal back
	var loaded TokenSet
	err = json.Unmarshal(data, &loaded)
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	// Verify all fields
	if loaded.AccessToken != original.AccessToken {
		t.Errorf("AccessToken mismatch")
	}
	if loaded.RefreshToken != original.RefreshToken {
		t.Errorf("RefreshToken mismatch")
	}
	if !loaded.ExpiresAt.Equal(original.ExpiresAt) {
		t.Errorf("ExpiresAt mismatch: expected %v, got %v", original.ExpiresAt, loaded.ExpiresAt)
	}
	if loaded.TokenType != original.TokenType {
		t.Errorf("TokenType mismatch")
	}
	if loaded.Host != original.Host {
		t.Errorf("Host mismatch")
	}
	if loaded.Username != original.Username {
		t.Errorf("Username mismatch")
	}
}

func TestGenerateMachineKey(t *testing.T) {
	key1 := generateMachineKey()
	key2 := generateMachineKey()

	// Keys should be consistent for the same machine
	if len(key1) != len(key2) {
		t.Error("key lengths should be consistent")
	}

	for i := range key1 {
		if key1[i] != key2[i] {
			t.Error("keys should be deterministic for the same machine")
			break
		}
	}

	// Key should be 32 bytes (256 bits for AES-256)
	if len(key1) != 32 {
		t.Errorf("expected key length 32, got %d", len(key1))
	}
}

// Helper function
func containsSubstring(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		(len(s) > 0 && len(substr) > 0 && findSubstring(s, substr)))
}

func findSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
