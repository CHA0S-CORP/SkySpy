package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// TokenSet represents a complete set of authentication tokens
type TokenSet struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	TokenType    string    `json:"token_type"`
	Host         string    `json:"host"`
	Username     string    `json:"username,omitempty"`
}

// IsExpired returns true if the access token is expired
func (t *TokenSet) IsExpired() bool {
	return time.Now().After(t.ExpiresAt)
}

// NeedsRefresh returns true if the token should be refreshed (5 min before expiry)
func (t *TokenSet) NeedsRefresh() bool {
	return time.Now().After(t.ExpiresAt.Add(-5 * time.Minute))
}

// TokenStore defines the interface for token storage
type TokenStore interface {
	Save(host string, tokens *TokenSet) error
	Load(host string) (*TokenSet, error)
	Delete(host string) error
	List() ([]string, error)
}

// FileTokenStore stores tokens in encrypted files
type FileTokenStore struct {
	dir string
	key []byte
}

// NewFileTokenStore creates a new file-based token store
func NewFileTokenStore() (*FileTokenStore, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	dir := filepath.Join(homeDir, ".config", "skyspy", "credentials")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}

	// Generate or load encryption key based on machine-specific data
	key := generateMachineKey()

	return &FileTokenStore{
		dir: dir,
		key: key,
	}, nil
}

// generateMachineKey generates a key based on machine-specific data
func generateMachineKey() []byte {
	// Use a combination of user home dir and a fixed salt
	// This provides basic obfuscation - not meant to be highly secure
	// For production, use OS keychain (see keyring.go)
	homeDir, _ := os.UserHomeDir()
	data := homeDir + ":skyspy-cli-v1"
	hash := sha256.Sum256([]byte(data))
	return hash[:]
}

// hostToFilename converts a host string to a safe filename
func hostToFilename(host string) string {
	// Replace unsafe characters
	safe := strings.ReplaceAll(host, ":", "_")
	safe = strings.ReplaceAll(safe, "/", "_")
	safe = strings.ReplaceAll(safe, "\\", "_")
	return safe + ".json"
}

// Save stores tokens for a host
func (s *FileTokenStore) Save(host string, tokens *TokenSet) error {
	tokens.Host = host

	data, err := json.Marshal(tokens)
	if err != nil {
		return err
	}

	encrypted, err := s.encrypt(data)
	if err != nil {
		return err
	}

	filename := filepath.Join(s.dir, hostToFilename(host))
	return os.WriteFile(filename, encrypted, 0600)
}

// Load retrieves tokens for a host
func (s *FileTokenStore) Load(host string) (*TokenSet, error) {
	filename := filepath.Join(s.dir, hostToFilename(host))

	encrypted, err := os.ReadFile(filename)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // No tokens stored
		}
		return nil, err
	}

	data, err := s.decrypt(encrypted)
	if err != nil {
		return nil, err
	}

	var tokens TokenSet
	if err := json.Unmarshal(data, &tokens); err != nil {
		return nil, err
	}

	return &tokens, nil
}

// Delete removes tokens for a host
func (s *FileTokenStore) Delete(host string) error {
	filename := filepath.Join(s.dir, hostToFilename(host))
	err := os.Remove(filename)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

// List returns all hosts with stored tokens
func (s *FileTokenStore) List() ([]string, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}

	var hosts []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			// Convert filename back to host
			// Filename format: host_port.json (underscore separates host from port)
			name := strings.TrimSuffix(entry.Name(), ".json")
			// Replace underscore with colon for host:port format
			host := strings.Replace(name, "_", ":", 1) // Only replace first underscore
			hosts = append(hosts, host)
		}
	}

	return hosts, nil
}

// encrypt encrypts data using AES-GCM
func (s *FileTokenStore) encrypt(plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return []byte(base64.StdEncoding.EncodeToString(ciphertext)), nil
}

// decrypt decrypts data using AES-GCM
func (s *FileTokenStore) decrypt(data []byte) ([]byte, error) {
	ciphertext, err := base64.StdEncoding.DecodeString(string(data))
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(s.key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	return gcm.Open(nil, nonce, ciphertext, nil)
}
