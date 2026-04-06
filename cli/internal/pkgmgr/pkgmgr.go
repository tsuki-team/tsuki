// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: pkgmgr  —  install / remove / list tsukilib packages
//
//  Package install directory (priority order):
//    1. config.json  libs_dir
//    2. tsuki_LIBS environment variable
//    3. OS default: ~/.local/share/tsuki/libs  (Linux/macOS)
//                   %APPDATA%\tsuki\libs        (Windows)
//
//  Registries (priority order — first registry wins on name collision):
//    1. tsuki_REGISTRY env var  (single URL, prepended)
//    2. config.json  registry_urls  (ordered list)
//    3. config.json  registry_url   (legacy single-URL, backward compat)
//    4. Built-in default (github.com/s7lver/tsuki-pkgs)
//
//  Each registry JSON may include a "key_index_url" field pointing to its
//  own signing-key index.  The global key index in config is the fallback.
//
//  Signature verification uses Ed25519:
//    - Public keys are PEM-encoded ("PUBLIC KEY" block, raw Ed25519).
//    - Signature files are fetched from <toml_url>.sig (raw 64-byte binary).
// ─────────────────────────────────────────────────────────────────────────────

package pkgmgr

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/tsuki/cli/internal/config"
	"github.com/tsuki/cli/internal/ui"
)

// ── Paths ─────────────────────────────────────────────────────────────────────

func LibsDir() string {
	cfg, err := config.Load()
	if err == nil {
		return cfg.ResolvedLibsDir()
	}
	if env := os.Getenv("tsuki_LIBS"); env != "" {
		return env
	}
	return config.Default().ResolvedLibsDir()
}



func PackageDir(name, version string) string {
	return filepath.Join(LibsDir(), name, version)
}

func ManifestPath(name, version string) string {
	return filepath.Join(PackageDir(name, version), "tsukilib.toml")
}

func KeysDir() string {
	cfg, err := config.Load()
	if err == nil {
		return cfg.ResolvedKeysDir()
	}
	if env := os.Getenv("tsuki_KEYS"); env != "" {
		return env
	}
	return config.Default().ResolvedKeysDir()
}



// ── InstalledPackage ──────────────────────────────────────────────────────────

type InstalledPackage struct {
	Name        string
	Version     string
	Description string
	CppHeader   string
	ArduinoLib  string
	Path        string
}

func ListInstalled() ([]InstalledPackage, error) {
	root := LibsDir()
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading libs dir: %w", err)
	}

	var pkgs []InstalledPackage
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		versions, _ := os.ReadDir(filepath.Join(root, name))
		for _, v := range versions {
			if !v.IsDir() {
				continue
			}
			mpath := filepath.Join(root, name, v.Name(), "tsukilib.toml")
			if _, err := os.Stat(mpath); err != nil {
				continue
			}
			ip := InstalledPackage{Name: name, Version: v.Name(), Path: mpath}
			if data, err := os.ReadFile(mpath); err == nil {
				ip.Description, ip.CppHeader, ip.ArduinoLib = quickParseMeta(string(data))
			}
			pkgs = append(pkgs, ip)
		}
	}
	sort.Slice(pkgs, func(i, j int) bool { return pkgs[i].Name < pkgs[j].Name })
	return pkgs, nil
}

// ── Install ───────────────────────────────────────────────────────────────────

type InstallSource int

const (
	SourceLocal    InstallSource = iota
	SourceURL
	SourceRegistry
)

type InstallOptions struct {
	Source  string
	Version string
}

// Install fetches a tsukilib.toml, optionally verifies its Ed25519
// signature, and places it in LibsDir.
func Install(opts InstallOptions) (*InstalledPackage, error) {
	tomlData, err := fetchTOML(opts.Source)
	if err != nil {
		return nil, err
	}

	name, version, description, header, arduinoLib, err := parseTOMLMeta(tomlData)
	if err != nil {
		return nil, err
	}
	if opts.Version != "" {
		version = opts.Version
	}

	// Signature verification
	cfg, _ := config.Load()
	if cfg != nil && cfg.Packages.VerifySignatures {
		if err := verifySignature(opts.Source, tomlData, cfg); err != nil {
			return nil, fmt.Errorf("signature verification failed for %s@%s: %w", name, version, err)
		}
	}

	destDir := PackageDir(name, version)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return nil, fmt.Errorf("creating package dir: %w", err)
	}

	destFile := filepath.Join(destDir, "tsukilib.toml")
	if err := os.WriteFile(destFile, []byte(tomlData), 0644); err != nil {
		return nil, fmt.Errorf("writing tsukilib.toml: %w", err)
	}

	return &InstalledPackage{
		Name:        name,
		Version:     version,
		Description: description,
		CppHeader:   header,
		ArduinoLib:  arduinoLib,
		Path:        destFile,
	}, nil
}

func Remove(name, version string) error {
	dir := PackageDir(name, version)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return fmt.Errorf("package %s@%s is not installed", name, version)
	}
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("removing %s: %w", dir, err)
	}
	parent := filepath.Join(LibsDir(), name)
	if entries, _ := os.ReadDir(parent); len(entries) == 0 {
		os.Remove(parent)
	}
	return nil
}

func IsInstalled(name string) (bool, string) {
	pkgs, _ := ListInstalled()
	for _, p := range pkgs {
		if p.Name == name {
			return true, p.Version
		}
	}
	return false, ""
}

// ── Ed25519 Signature verification ───────────────────────────────────────────

// KeyIndexEntry is one entry in a keys/index.json file.
type KeyIndexEntry struct {
	// KeyID is an arbitrary identifier (e.g. "tsuki-team").
	KeyID string `json:"key_id"`
	// PublicKeyURL is where the PEM-encoded Ed25519 public key lives.
	PublicKeyURL string `json:"public_key_url"`
	// SignatureURLTemplate is the URL pattern for .sig files.
	// Use "{toml_url}" as placeholder, e.g.:
	//   "https://raw.githubusercontent.com/.../sigs/{toml_url}.sig"
	// If empty, the signature URL defaults to <toml_url>.sig
	SignatureURLTemplate string `json:"signature_url_template"`
}

// KeyIndex is the top-level object in a keys/index.json.
type KeyIndex struct {
	Keys []KeyIndexEntry `json:"keys"`
}

// FetchKeyIndex downloads the key index from the given URL.
func FetchKeyIndex(url string) (*KeyIndex, error) {
	data, err := httpGet(url)
	if err != nil {
		return nil, fmt.Errorf("fetching key index from %s: %w", url, err)
	}
	var idx KeyIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		return nil, fmt.Errorf("parsing key index: %w", err)
	}
	return &idx, nil
}

// FetchGlobalKeyIndex fetches the key index from the configured global URL.
func FetchGlobalKeyIndex() (*KeyIndex, error) {
	url := config.Default().ResolvedKeysIndexURL()
	if cfg, err := config.Load(); err == nil {
		url = cfg.ResolvedKeysIndexURL()
	}
	return FetchKeyIndex(url)
}

// EnsureKeyDownloaded downloads and caches a public key by key ID.
// Returns the local file path.
func EnsureKeyDownloaded(entry KeyIndexEntry) (string, error) {
	dir := KeysDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("creating keys dir: %w", err)
	}

	localPath := filepath.Join(dir, entry.KeyID+".pub")
	// Re-download if missing; cached keys are trusted on disk.
	if _, err := os.Stat(localPath); err == nil {
		return localPath, nil
	}

	data, err := httpGet(entry.PublicKeyURL)
	if err != nil {
		return "", fmt.Errorf("downloading key %s from %s: %w", entry.KeyID, entry.PublicKeyURL, err)
	}
	if err := os.WriteFile(localPath, data, 0644); err != nil {
		return "", fmt.Errorf("saving key to %s: %w", localPath, err)
	}
	return localPath, nil
}

// verifySignature verifies the Ed25519 signature of a TOML package file.
//
// Algorithm:
//  1. Load all configured key indexes (per-registry + global).
//  2. For each key entry, fetch (or use cached) public key.
//  3. Derive the signature URL: use SignatureURLTemplate if set,
//     otherwise append ".sig" to the toml URL.
//  4. Fetch the .sig file (raw 64-byte Ed25519 signature).
//  5. Verify ed25519.Verify(pubkey, []byte(tomlData), sig).
//  6. Return nil on the first successful verification; error if all fail.
func verifySignature(tomlURL, tomlData string, cfg *config.Config) error {
	// Collect all key index URLs to try: per-registry indexes + global fallback.
	var keyIndexURLs []string
	for _, regURL := range cfg.ResolvedRegistryURLs() {
		idx, err := fetchRegistryFromURL(regURL)
		if err == nil && idx.KeyIndexURL != "" {
			keyIndexURLs = append(keyIndexURLs, idx.KeyIndexURL)
		}
	}
	keyIndexURLs = append(keyIndexURLs, cfg.ResolvedKeysIndexURL())

	// Deduplicate
	seen := make(map[string]bool)
	var uniqueIndexURLs []string
	for _, u := range keyIndexURLs {
		if !seen[u] {
			seen[u] = true
			uniqueIndexURLs = append(uniqueIndexURLs, u)
		}
	}

	var lastErr error
	for _, idxURL := range uniqueIndexURLs {
		keyIdx, err := FetchKeyIndex(idxURL)
		if err != nil {
			lastErr = err
			continue
		}
		for _, entry := range keyIdx.Keys {
			if err := tryVerifyWithKey(entry, tomlURL, tomlData); err == nil {
				return nil // verified successfully
			} else {
				lastErr = err
			}
		}
	}

	if lastErr != nil {
		return fmt.Errorf("no key could verify the package signature: %w", lastErr)
	}
	return fmt.Errorf("no signing keys found in any key index")
}

// tryVerifyWithKey attempts to verify tomlData's signature using one key entry.
func tryVerifyWithKey(entry KeyIndexEntry, tomlURL, tomlData string) error {
	// 1. Determine signature URL
	sigURL := tomlURL + ".sig"
	if entry.SignatureURLTemplate != "" {
		sigURL = strings.ReplaceAll(entry.SignatureURLTemplate, "{toml_url}", tomlURL)
	}

	// 2. Fetch the signature (raw bytes)
	sigBytes, err := httpGet(sigURL)
	if err != nil {
		return fmt.Errorf("fetching signature from %s: %w", sigURL, err)
	}
	if len(sigBytes) != ed25519.SignatureSize {
		return fmt.Errorf("invalid signature length %d (expected %d)", len(sigBytes), ed25519.SignatureSize)
	}

	// 3. Fetch (or use cached) public key
	keyPath, err := EnsureKeyDownloaded(entry)
	if err != nil {
		return fmt.Errorf("fetching public key %s: %w", entry.KeyID, err)
	}

	// 4. Parse PEM-encoded Ed25519 public key
	pubKey, err := loadEd25519PublicKey(keyPath)
	if err != nil {
		return fmt.Errorf("loading public key %s: %w", entry.KeyID, err)
	}

	// 5. Verify
	if !ed25519.Verify(pubKey, []byte(tomlData), sigBytes) {
		return fmt.Errorf("signature invalid for key %s", entry.KeyID)
	}
	return nil
}

// loadEd25519PublicKey parses an Ed25519 public key from a PEM file.
// Accepts "PUBLIC KEY" PEM blocks (PKIX/DER-encoded).
func loadEd25519PublicKey(path string) (ed25519.PublicKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("no PEM block found in %s", path)
	}
	if block.Type != "PUBLIC KEY" {
		return nil, fmt.Errorf("expected PEM type 'PUBLIC KEY', got %q", block.Type)
	}

	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parsing PKIX public key: %w", err)
	}

	ed, ok := pub.(ed25519.PublicKey)
	if !ok {
		return nil, fmt.Errorf("key is not Ed25519 (got %T)", pub)
	}
	return ed, nil
}

// ── Registry ──────────────────────────────────────────────────────────────────

// RegistryBoardPackage is one board entry in a registry.json "boards" map.
type RegistryBoardPackage struct {
	Description string            `json:"description"`
	Author      string            `json:"author"`
	Latest      string            `json:"latest"`
	Versions    map[string]string `json:"versions"` // version -> tsuki_board.toml URL
}

// RegistryIndex is the top-level object in a registry.json file.
type RegistryIndex struct {
	// KeyIndexURL optionally points to this registry's own signing-key index.
	// If set, it is consulted first during signature verification.
	KeyIndexURL string `json:"key_index_url,omitempty"`

	Packages map[string]RegistryPackage     `json:"packages"`
	Boards   map[string]RegistryBoardPackage `json:"boards"`
}

type RegistryPackage struct {
	Description string            `json:"description"`
	Author      string            `json:"author"`
	Latest      string            `json:"latest"`
	Versions    map[string]string `json:"versions"` // version -> TOML URL
}

type RegistryEntry struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
	URL         string `json:"toml_url"`
	ArduinoLib  string `json:"arduino_lib"`
	// RegistryURL is the source registry this entry came from.
	RegistryURL string `json:"registry_url"`
}

// fetchRegistryFromURL downloads and parses a single registry JSON.
func fetchRegistryFromURL(url string) (*RegistryIndex, error) {
	data, err := httpGet(url)
	if err != nil {
		return nil, fmt.Errorf("fetching registry from %s: %w", url, err)
	}
	var idx RegistryIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		return nil, fmt.Errorf("parsing registry JSON from %s: %w", url, err)
	}
	return &idx, nil
}

// FetchAllRegistries fetches and merges packages from all configured registry
// URLs.  The first registry in the list wins on name collisions.  A warning
// is printed whenever a package name is shadowed by an earlier registry.
func FetchAllRegistries() (map[string]RegistryPackage, []string, error) {
	cfg, _ := config.Load()
	if cfg == nil {
		cfg = config.Default()
	}

	merged := make(map[string]RegistryPackage)   // name → package
	sourceMap := make(map[string]string)          // name → registry URL that owns it
	var registryURLs []string                     // which URLs were successfully fetched

	var firstErr error
	for _, regURL := range cfg.ResolvedRegistryURLs() {
		idx, err := fetchRegistryFromURL(regURL)
		if err != nil {
			ui.Warn(fmt.Sprintf("registry unavailable: %s — %v", regURL, err))
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		registryURLs = append(registryURLs, regURL)
		for name, pkg := range idx.Packages {
			if existing, exists := merged[name]; exists {
				_ = existing // suppress unused warning
				ui.Warn(fmt.Sprintf(
					"package %q from %s shadowed by earlier registry %s",
					name, regURL, sourceMap[name],
				))
			} else {
				merged[name] = pkg
				sourceMap[name] = regURL
			}
		}
	}

	if len(registryURLs) == 0 {
		if firstErr != nil {
			return nil, nil, firstErr
		}
		return nil, nil, fmt.Errorf("no registries could be reached")
	}
	return merged, registryURLs, nil
}

// SearchRegistry queries all configured registries for packages matching query.
func SearchRegistry(query string) ([]RegistryEntry, error) {
	packages, _, err := FetchAllRegistries()
	if err != nil {
		return nil, err
	}

	q := strings.ToLower(query)
	var results []RegistryEntry
	for name, pkg := range packages {
		if q == "" ||
			strings.Contains(strings.ToLower(name), q) ||
			strings.Contains(strings.ToLower(pkg.Description), q) ||
			strings.Contains(strings.ToLower(pkg.Author), q) {

			results = append(results, RegistryEntry{
				Name:        name,
				Version:     pkg.Latest,
				Description: pkg.Description,
				URL:         pkg.Versions[pkg.Latest],
			})
		}
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Name < results[j].Name })
	return results, nil
}

// InstallFromRegistry installs a package by name from the merged registry.
func InstallFromRegistry(name, version string) (*InstalledPackage, error) {
	packages, _, err := FetchAllRegistries()
	if err != nil {
		return nil, err
	}

	entry, ok := packages[name]
	if !ok {
		return nil, fmt.Errorf(
			"package %q not found in any registry — run `tsuki pkg search` to see available packages",
			name,
		)
	}

	ver := version
	if ver == "" {
		ver = entry.Latest
	}

	tomlURL, ok := entry.Versions[ver]
	if !ok {
		versions := make([]string, 0, len(entry.Versions))
		for v := range entry.Versions {
			versions = append(versions, v)
		}
		sort.Strings(versions)
		return nil, fmt.Errorf(
			"version %q not found for package %q. Available: %s",
			ver, name, strings.Join(versions, ", "),
		)
	}

	return Install(InstallOptions{Source: tomlURL, Version: ver})
}

// ── Print helpers ─────────────────────────────────────────────────────────────

func PrintList(pkgs []InstalledPackage) {
	if len(pkgs) == 0 {
		ui.Info("No packages installed — run `tsuki pkg install <source>` to add one")
		return
	}

	ui.SectionTitle(fmt.Sprintf("Installed packages (%d)", len(pkgs)))
	fmt.Println()

	ui.ColorTitle.Printf("  %-20s  %-10s  %-30s  %s\n", "NAME", "VERSION", "DESCRIPTION", "HEADER")
	ui.ColorMuted.Println("  " + strings.Repeat("─", 88))

	for _, p := range pkgs {
		desc := p.Description
		if len(desc) > 30 {
			desc = desc[:27] + "..."
		}
		ui.ColorKey.Printf("  %-20s", p.Name)
		ui.ColorNumber.Printf("  %-10s", p.Version)
		fmt.Printf("  %-30s", desc)
		ui.ColorMuted.Printf("  %s\n", p.CppHeader)
	}
	fmt.Println()
}

func PrintRegistryResults(entries []RegistryEntry) {
	if len(entries) == 0 {
		ui.Info("No packages found matching your query")
		return
	}

	ui.ColorTitle.Printf("  %-20s  %-10s  %-40s\n", "NAME", "VERSION", "DESCRIPTION")
	ui.ColorMuted.Println("  " + strings.Repeat("─", 76))

	for _, e := range entries {
		ui.ColorKey.Printf("  %-20s", e.Name)
		ui.ColorNumber.Printf("  %-10s", e.Version)
		fmt.Printf("  %s\n", e.Description)
	}
	fmt.Println()

	ui.Info("Install with: tsuki pkg install <name>")
}

// ── TOML fetch ────────────────────────────────────────────────────────────────

func fetchTOML(source string) (string, error) {
	if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		data, err := httpGet(source)
		if err != nil {
			return "", err
		}
		return string(data), nil
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", source, err)
	}
	return string(data), nil
}

func httpGet(url string) ([]byte, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GET %s: HTTP %d", url, resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// ── Minimal TOML parser ───────────────────────────────────────────────────────

func parseTOMLMeta(toml string) (name, version, description, header, arduinoLib string, err error) {
	for _, line := range strings.Split(toml, "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := parseKV(line)
		if !ok {
			continue
		}
		switch k {
		case "name":
			name = v
		case "version":
			version = v
		case "description":
			description = v
		case "cpp_header":
			header = v
		case "arduino_lib":
			arduinoLib = v
		}
	}
	if name == "" || version == "" {
		err = fmt.Errorf("tsukilib.toml must declare [package] name and version")
	}
	return
}

func quickParseMeta(toml string) (description, header, arduinoLib string) {
	for _, line := range strings.Split(toml, "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := parseKV(line)
		if !ok {
			continue
		}
		switch k {
		case "description":
			description = v
		case "cpp_header":
			header = v
		case "arduino_lib":
			arduinoLib = v
		}
	}
	return
}

func parseKV(line string) (key, value string, ok bool) {
	if strings.HasPrefix(line, "#") || strings.HasPrefix(line, "[") {
		return
	}
	parts := strings.SplitN(line, "=", 2)
	if len(parts) != 2 {
		return
	}
	key = strings.TrimSpace(parts[0])
	value = strings.Trim(strings.TrimSpace(parts[1]), `"`)
	ok = true
	return
}

// ── Lock file ─────────────────────────────────────────────────────────────────

type LockEntry struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Path    string `json:"path"`
}

func WriteLock(projectDir string, pkgs []InstalledPackage) error {
	entries := make([]LockEntry, len(pkgs))
	for i, p := range pkgs {
		entries[i] = LockEntry{Name: p.Name, Version: p.Version, Path: p.Path}
	}
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(projectDir, "tsuki.lock"), append(data, '\n'), 0644)
}

func ReadLock(projectDir string) ([]LockEntry, error) {
	data, err := os.ReadFile(filepath.Join(projectDir, "tsuki.lock"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var entries []LockEntry
	return entries, json.Unmarshal(data, &entries)
}
// ── Board package management ──────────────────────────────────────────────────
//
// Board packages use the same registry (packages.json) but the "boards" key.
// They are stored as tsuki_board.toml in BoardsDir/<id>/<version>/.

func BoardsDir() string {
	cfg, err := config.Load()
	if err == nil {
		return cfg.ResolvedBoardsDir()
	}
	if env := os.Getenv("tsuki_BOARDS"); env != "" {
		return env
	}
	return config.Default().ResolvedBoardsDir()
}

func BoardPackageDir(id, version string) string {
	return filepath.Join(BoardsDir(), id, version)
}

func BoardManifestPath(id, version string) string {
	return filepath.Join(BoardPackageDir(id, version), "tsuki_board.toml")
}

// InstalledBoard represents an installed board package.
type InstalledBoard struct {
	ID          string
	Version     string
	Description string
	FQBN        string
	Path        string
}

// ListInstalledBoards returns all board packages installed in BoardsDir.
func ListInstalledBoards() ([]InstalledBoard, error) {
	root := BoardsDir()
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading boards dir: %w", err)
	}

	var boards []InstalledBoard
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		id := e.Name()
		versions, _ := os.ReadDir(filepath.Join(root, id))
		for _, v := range versions {
			if !v.IsDir() {
				continue
			}
			mpath := filepath.Join(root, id, v.Name(), "tsuki_board.toml")
			if _, err := os.Stat(mpath); err != nil {
				continue
			}
			ib := InstalledBoard{ID: id, Version: v.Name(), Path: mpath}
			if data, err := os.ReadFile(mpath); err == nil {
				ib.Description, ib.FQBN = quickParseBoardMeta(string(data))
			}
			boards = append(boards, ib)
		}
	}
	sort.Slice(boards, func(i, j int) bool { return boards[i].ID < boards[j].ID })
	return boards, nil
}

func quickParseBoardMeta(toml string) (description, fqbn string) {
	for _, line := range strings.Split(toml, "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := parseKV(line)
		if !ok {
			continue
		}
		switch k {
		case "description":
			description = v
		case "fqbn":
			fqbn = v
		}
	}
	return
}

// InstallBoard installs a board package from a URL, local path, or registry name.
func InstallBoard(opts InstallOptions) (*InstalledBoard, error) {
	tomlData, err := fetchTOML(opts.Source)
	if err != nil {
		return nil, err
	}
	id, version, description, fqbn, err := parseBoardTOMLMeta(tomlData)
	if err != nil {
		return nil, err
	}
	if opts.Version != "" {
		version = opts.Version
	}

	destDir := BoardPackageDir(id, version)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return nil, fmt.Errorf("creating board package dir: %w", err)
	}
	destFile := filepath.Join(destDir, "tsuki_board.toml")
	if err := os.WriteFile(destFile, []byte(tomlData), 0644); err != nil {
		return nil, fmt.Errorf("writing tsuki_board.toml: %w", err)
	}
	return &InstalledBoard{
		ID:          id,
		Version:     version,
		Description: description,
		FQBN:        fqbn,
		Path:        destFile,
	}, nil
}

// RemoveBoard removes an installed board package.
func RemoveBoard(id, version string) error {
	dir := BoardPackageDir(id, version)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return fmt.Errorf("board package %s@%s is not installed", id, version)
	}
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("removing %s: %w", dir, err)
	}
	parent := filepath.Join(BoardsDir(), id)
	if entries, _ := os.ReadDir(parent); len(entries) == 0 {
		os.Remove(parent)
	}
	return nil
}

// IsBoardInstalled returns whether a board package is installed.
func IsBoardInstalled(id string) (bool, string) {
	boards, _ := ListInstalledBoards()
	for _, b := range boards {
		if b.ID == id {
			return true, b.Version
		}
	}
	return false, ""
}

// InstallBoardFromRegistry installs a board package by ID from the registry.
func InstallBoardFromRegistry(id, version string) (*InstalledBoard, error) {
	cfg, _ := config.Load()
	if cfg == nil {
		cfg = config.Default()
	}

	var boardEntry *RegistryBoardPackage
	for _, regURL := range cfg.ResolvedRegistryURLs() {
		idx, err := fetchRegistryFromURL(regURL)
		if err != nil {
			ui.Warn(fmt.Sprintf("registry unavailable: %s — %v", regURL, err))
			continue
		}
		if entry, ok := idx.Boards[id]; ok {
			e := entry
			boardEntry = &e
			break
		}
	}
	if boardEntry == nil {
		return nil, fmt.Errorf(
			"board %q not found in any registry — run `tsuki boards search` to see available boards",
			id,
		)
	}

	ver := version
	if ver == "" {
		ver = boardEntry.Latest
	}
	tomlURL, ok := boardEntry.Versions[ver]
	if !ok {
		versions := make([]string, 0, len(boardEntry.Versions))
		for v := range boardEntry.Versions {
			versions = append(versions, v)
		}
		sort.Strings(versions)
		return nil, fmt.Errorf(
			"version %q not found for board %q. Available: %s",
			ver, id, strings.Join(versions, ", "),
		)
	}
	return InstallBoard(InstallOptions{Source: tomlURL, Version: ver})
}

// SearchBoardRegistry searches for board packages in the registry.
func SearchBoardRegistry(query string) ([]RegistryEntry, error) {
	cfg, _ := config.Load()
	if cfg == nil {
		cfg = config.Default()
	}

	q := strings.ToLower(query)
	var results []RegistryEntry

	for _, regURL := range cfg.ResolvedRegistryURLs() {
		idx, err := fetchRegistryFromURL(regURL)
		if err != nil {
			continue
		}
		for name, pkg := range idx.Boards {
			if q == "" ||
				strings.Contains(strings.ToLower(name), q) ||
				strings.Contains(strings.ToLower(pkg.Description), q) {
				results = append(results, RegistryEntry{
					Name:        name,
					Version:     pkg.Latest,
					Description: pkg.Description,
					URL:         pkg.Versions[pkg.Latest],
				})
			}
		}
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Name < results[j].Name })
	return results, nil
}

// ── Board TOML parser ─────────────────────────────────────────────────────────

func parseBoardTOMLMeta(toml string) (id, version, description, fqbn string, err error) {
	for _, line := range strings.Split(toml, "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := parseKV(line)
		if !ok {
			continue
		}
		switch k {
		case "id":
			id = v
		case "version":
			version = v
		case "description":
			description = v
		case "fqbn":
			fqbn = v
		}
	}
	if id == "" || fqbn == "" {
		err = fmt.Errorf("tsuki_board.toml must declare [board] id and fqbn")
	}
	if version == "" {
		version = "1.0.0"
	}
	return
}

// ── Print helpers for boards ──────────────────────────────────────────────────

func PrintBoardList(boards []InstalledBoard) {
	if len(boards) == 0 {
		ui.Info("No board packages installed — run `tsuki boards install <id>` to add one")
		return
	}

	ui.SectionTitle(fmt.Sprintf("Installed board packages (%d)", len(boards)))
	fmt.Println()

	ui.ColorTitle.Printf("  %-16s  %-10s  %-42s  %s\n", "ID", "VERSION", "DESCRIPTION", "FQBN")
	ui.ColorMuted.Println("  " + strings.Repeat("─", 96))

	for _, b := range boards {
		desc := b.Description
		if len(desc) > 42 {
			desc = desc[:39] + "..."
		}
		ui.ColorKey.Printf("  %-16s", b.ID)
		ui.ColorNumber.Printf("  %-10s", b.Version)
		fmt.Printf("  %-42s", desc)
		ui.ColorMuted.Printf("  %s\n", b.FQBN)
	}
	fmt.Println()
}
