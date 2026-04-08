// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: config  —  persistent CLI configuration
//
//  Stored at:
//    Linux/macOS: ~/.config/tsuki/config.json
//    Windows:     %APPDATA%\tsuki\config.json
// ─────────────────────────────────────────────────────────────────────────────

package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"strings"
)

// defaultPkgRegistryBase is the raw base URL for tsuki-pkg — the dedicated
// package registry repo (github.com/tsuki-team/tsuki-pkg).  Individual files
// are fetched as {base}/libs/{name}/{version}/godotinolib.toml.
const defaultPkgRegistryBase = "https://raw.githubusercontent.com/tsuki-team/tsuki-pkg/main"

// defaultRegistryURL points to packages.json in the tsuki-pkg repo.
const defaultRegistryURL = defaultPkgRegistryBase + "/packages.json"
const defaultKeysIndexURL = defaultPkgRegistryBase + "/keys/index.json"
const defaultBoardsRegistryURL = defaultPkgRegistryBase + "/boards.json"

// DefaultBoardsRegistryURL is the exported form for use in other packages.
const DefaultBoardsRegistryURL = defaultBoardsRegistryURL

// PackagesConfig groups all package-management settings.
// Stored under the "packages" key in config.json.
type PackagesConfig struct {
	// LibsDir is where tsukilib packages are installed.
	LibsDir string `json:"libs_dir" comment:"directory where library packages are installed (leave empty for default)"`

	// BoardsDir is where board packages (tsuki_board.toml) are installed.
	BoardsDir string `json:"boards_dir" comment:"directory where board packages are installed (leave empty for default)"`

	// RegistryURL is kept for backward compatibility with existing config files.
	// Prefer RegistryURLs for multi-registry setups.
	RegistryURL string `json:"registry_url,omitempty" comment:"[deprecated] single registry URL — use registry_urls instead"`

	// RegistryURLs is the list of registry JSON URLs to consult, in priority
	// order (first registry wins on name collisions).
	RegistryURLs []string `json:"registry_urls" comment:"ordered list of package registry URLs"`

	// BoardsRegistryURL is the URL of the board-support-package registry.
	// Defaults to tsuki-ex (tsuki-team/tsuki-ex).
	BoardsRegistryURL string `json:"boards_registry_url,omitempty" comment:"URL of the board support package registry (tsuki-ex format)"`

	// PkgRegistryURL is the raw base URL of the tsuki-pkg repository.
	// Individual lib files are fetched as {PkgRegistryURL}/libs/{name}/{ver}/godotinolib.toml.
	// Defaults to github.com/tsuki-team/tsuki-pkg main branch.
	PkgRegistryURL string `json:"pkg_registry_url,omitempty" comment:"base URL of tsuki-pkg repo (used for fetching individual package files)"`

	// KeysDir is where downloaded public signing keys are cached.
	KeysDir string `json:"keys_dir" comment:"directory where package signing keys are cached (leave empty for default)"`

	// KeysIndexURL is the global fallback key-index URL.
	KeysIndexURL string `json:"keys_index_url" comment:"URL of the signing-key index JSON (global fallback)"`

	// VerifySignatures controls whether package signatures are verified on install.
	VerifySignatures bool `json:"verify_signatures" comment:"verify package signatures on install"`
}

// Config holds all persistent user-level settings.
type Config struct {
	// ── Core tools ──────────────────────────────────────────────────────────
	CoreBinary  string `json:"core_binary"  comment:"path to tsuki-core binary"  section:"core"`
	ArduinoCLI  string `json:"arduino_cli"  comment:"path to arduino-cli binary"  section:"core"`
	FlashBinary string `json:"flash_binary" comment:"path to tsuki-flash binary"  section:"core"`
	// Backend selects the compile+upload toolchain.
	Backend      string `json:"backend"       comment:"compiler backend: tsuki-flash or arduino-cli (default: arduino-cli)" section:"core"`
	DefaultBoard string `json:"default_board" comment:"default target board"   section:"core"`
	DefaultBaud  int    `json:"default_baud"  comment:"default serial baud rate" section:"core"`

	// ── Output ──────────────────────────────────────────────────────────────
	Color      bool `json:"color"       comment:"enable colored output"           section:"output"`
	Verbose    bool `json:"verbose"     comment:"verbose command output"           section:"output"`
	AutoDetect bool `json:"auto_detect" comment:"auto-detect connected boards"     section:"output"`

	// ── Package management ──────────────────────────────────────────────────
	// Packages groups all package-management settings under "packages" in JSON.
	Packages PackagesConfig `json:"packages" comment:"package management settings" section:"packages"`
}

// Default returns a Config with sensible defaults.
func Default() *Config {
	return &Config{
		CoreBinary:   "",
		ArduinoCLI:   "arduino-cli",
		FlashBinary:  "tsuki-flash",
		Backend:      "arduino-cli",
		DefaultBoard: "uno",
		DefaultBaud:  9600,
		Color:        true,
		Verbose:      false,
		AutoDetect:   true,
		Packages: PackagesConfig{
			LibsDir:           "",
			BoardsDir:         "",
			RegistryURL:       "",
			RegistryURLs:      []string{defaultRegistryURL},
			BoardsRegistryURL: defaultBoardsRegistryURL,
			PkgRegistryURL:    defaultPkgRegistryBase,
			KeysDir:           "",
			KeysIndexURL:      defaultKeysIndexURL,
			VerifySignatures:  false,
		},
	}
}

// ── Computed paths ────────────────────────────────────────────────────────────

func (c *Config) ResolvedLibsDir() string {
	if c.Packages.LibsDir != "" {
		return c.Packages.LibsDir
	}
	if env := os.Getenv("tsuki_LIBS"); env != "" {
		return env
	}
	return defaultLibsDir()
}

func (c *Config) ResolvedBoardsDir() string {
	if c.Packages.BoardsDir != "" {
		return c.Packages.BoardsDir
	}
	if env := os.Getenv("tsuki_BOARDS"); env != "" {
		return env
	}
	return defaultBoardsDir()
}

// ResolvedRegistryURLs returns the effective ordered list of registry URLs.
//
// Priority (highest first):
//  1. tsuki_REGISTRY env var  (single URL, prepended)
//  2. Config Packages.RegistryURLs list
//  3. Config Packages.RegistryURL (legacy, appended if not already present)
//  4. Built-in default
func (c *Config) ResolvedRegistryURLs() []string {
	seen := make(map[string]bool)
	var urls []string

	add := func(u string) {
		u = strings.TrimSpace(u)
		if u != "" && !seen[u] {
			seen[u] = true
			urls = append(urls, u)
		}
	}

	if env := os.Getenv("tsuki_REGISTRY"); env != "" {
		add(env)
	}
	for _, u := range c.Packages.RegistryURLs {
		add(u)
	}
	add(c.Packages.RegistryURL)
	if len(urls) == 0 {
		add(defaultRegistryURL)
	}
	return urls
}

// ResolvedPkgRegistryURL returns the effective base URL for tsuki-pkg.
// Priority: env var tsuki_PKG_REGISTRY → config → built-in default.
func (c *Config) ResolvedPkgRegistryURL() string {
	if env := os.Getenv("tsuki_PKG_REGISTRY"); env != "" {
		return strings.TrimRight(env, "/")
	}
	if c.Packages.PkgRegistryURL != "" {
		return strings.TrimRight(c.Packages.PkgRegistryURL, "/")
	}
	return defaultPkgRegistryBase
}

func (c *Config) ResolvedKeysDir() string {
	if c.Packages.KeysDir != "" {
		return c.Packages.KeysDir
	}
	if env := os.Getenv("tsuki_KEYS"); env != "" {
		return env
	}
	return defaultKeysDir()
}

func (c *Config) ResolvedKeysIndexURL() string {
	if c.Packages.KeysIndexURL != "" {
		return c.Packages.KeysIndexURL
	}
	if env := os.Getenv("tsuki_KEYS_INDEX"); env != "" {
		return env
	}
	return defaultKeysIndexURL
}

// ── OS-specific default paths ─────────────────────────────────────────────────

func defaultLibsDir() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("APPDATA")
		if base == "" {
			base = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
		}
		return filepath.Join(base, "tsuki", "libs")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "tsuki", "libs")
}

func defaultBoardsDir() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("APPDATA")
		if base == "" {
			base = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
		}
		return filepath.Join(base, "tsuki", "boards")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "tsuki", "boards")
}

func defaultKeysDir() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("APPDATA")
		if base == "" {
			base = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
		}
		return filepath.Join(base, "tsuki", "keys")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "tsuki", "keys")
}

// ── Config file I/O ───────────────────────────────────────────────────────────

func configPath() (string, error) {
	var base string
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		base = xdg
	} else {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "tsuki", "config.json"), nil
}

// Load reads the config from disk. Returns defaults if the file doesn't exist.
func Load() (*Config, error) {
	path, err := configPath()
	if err != nil {
		return Default(), nil
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return Default(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading config: %w", err)
	}

	// Support old flat-format configs by trying to migrate them.
	c := Default()
	if err := json.Unmarshal(data, c); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}

	// Migration: read old top-level flat package fields into Packages struct
	// for configs written before the "packages" section was introduced.
	var raw map[string]json.RawMessage
	if err2 := json.Unmarshal(data, &raw); err2 == nil {
		migrateOldField(raw, "libs_dir", &c.Packages.LibsDir)
		migrateOldField(raw, "boards_dir", &c.Packages.BoardsDir)
		migrateOldField(raw, "registry_url", &c.Packages.RegistryURL)
		migrateOldField(raw, "keys_dir", &c.Packages.KeysDir)
		migrateOldField(raw, "keys_index_url", &c.Packages.KeysIndexURL)
	}

	// Migration: legacy registry_url → registry_urls
	if len(c.Packages.RegistryURLs) == 0 && c.Packages.RegistryURL != "" {
		c.Packages.RegistryURLs = []string{c.Packages.RegistryURL}
	}

	return c, nil
}

func migrateOldField(raw map[string]json.RawMessage, key string, dst *string) {
	if v, ok := raw[key]; ok && *dst == "" {
		var s string
		if json.Unmarshal(v, &s) == nil {
			*dst = s
		}
	}
}

// Save writes the config to disk.
func (c *Config) Save() error {
	path, err := configPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0644)
}

// ── Get / Set ─────────────────────────────────────────────────────────────────
//
// Supports both simple keys ("verbose") and dotted package keys ("packages.libs_dir").

func (c *Config) Get(key string) (interface{}, error) {
	// Dotted key: "packages.<subkey>"
	if strings.HasPrefix(key, "packages.") {
		subkey := strings.TrimPrefix(key, "packages.")
		return getPackagesField(&c.Packages, subkey)
	}
	return getField(reflect.ValueOf(c).Elem(), key)
}

func (c *Config) Set(key, value string) error {
	if strings.HasPrefix(key, "packages.") {
		subkey := strings.TrimPrefix(key, "packages.")
		return setPackagesField(&c.Packages, subkey, value)
	}
	return setField(reflect.ValueOf(c).Elem(), key, value)
}

func getPackagesField(p *PackagesConfig, key string) (interface{}, error) {
	return getField(reflect.ValueOf(p).Elem(), key)
}

func setPackagesField(p *PackagesConfig, key, value string) error {
	return setField(reflect.ValueOf(p).Elem(), key, value)
}

func getField(rv reflect.Value, key string) (interface{}, error) {
	rt := rv.Type()
	for i := 0; i < rt.NumField(); i++ {
		field := rt.Field(i)
		tag := strings.Split(field.Tag.Get("json"), ",")[0]
		if tag == key || strings.ToLower(field.Name) == strings.ToLower(key) {
			return rv.Field(i).Interface(), nil
		}
	}
	return nil, fmt.Errorf("unknown config key %q", key)
}

func setField(rv reflect.Value, key, value string) error {
	rt := rv.Type()
	for i := 0; i < rt.NumField(); i++ {
		field := rt.Field(i)
		tag := strings.Split(field.Tag.Get("json"), ",")[0]
		if tag == key || strings.ToLower(field.Name) == strings.ToLower(key) {
			fv := rv.Field(i)
			switch fv.Kind() {
			case reflect.String:
				fv.SetString(value)
			case reflect.Bool:
				b, err := strconv.ParseBool(value)
				if err != nil {
					return fmt.Errorf("invalid bool value %q for key %q", value, key)
				}
				fv.SetBool(b)
			case reflect.Int:
				n, err := strconv.ParseInt(value, 10, 64)
				if err != nil {
					return fmt.Errorf("invalid int value %q for key %q", value, key)
				}
				fv.SetInt(n)
			case reflect.Slice:
				if fv.Type().Elem().Kind() == reflect.String {
					parts := strings.Split(value, ",")
					slice := reflect.MakeSlice(fv.Type(), len(parts), len(parts))
					for i, p := range parts {
						slice.Index(i).SetString(strings.TrimSpace(p))
					}
					fv.Set(slice)
				} else {
					return fmt.Errorf("unsupported slice type for key %q", key)
				}
			default:
				return fmt.Errorf("unsupported type for key %q", key)
			}
			return nil
		}
	}
	return fmt.Errorf("unknown config key %q", key)
}

// ── Section-aware entry listing ───────────────────────────────────────────────

type Entry struct {
	Key     string
	Value   interface{}
	Comment string
	Section string
}

func (c *Config) AllEntries() []Entry {
	rv := reflect.ValueOf(c).Elem()
	rt := rv.Type()
	var entries []Entry
	for i := 0; i < rt.NumField(); i++ {
		field := rt.Field(i)
		tag := strings.Split(field.Tag.Get("json"), ",")[0]
		comment := field.Tag.Get("comment")
		section := field.Tag.Get("section")
		fv := rv.Field(i)

		// Expand PackagesConfig sub-struct inline with "packages" section
		if field.Type == reflect.TypeOf(PackagesConfig{}) {
			pkgRv := fv
			pkgRt := pkgRv.Type()
			for j := 0; j < pkgRt.NumField(); j++ {
				pf := pkgRt.Field(j)
				ptag := strings.Split(pf.Tag.Get("json"), ",")[0]
				if ptag == "" || ptag == "-" {
					continue
				}
				entries = append(entries, Entry{
					Key:     "packages." + ptag,
					Value:   pkgRv.Field(j).Interface(),
					Comment: pf.Tag.Get("comment"),
					Section: "packages",
				})
			}
			continue
		}

		entries = append(entries, Entry{
			Key:     tag,
			Value:   fv.Interface(),
			Comment: comment,
			Section: section,
		})
	}
	return entries
}

// AllEntriesBySection returns entries grouped by section name.
func (c *Config) AllEntriesBySection() map[string][]Entry {
	sections := make(map[string][]Entry)
	for _, e := range c.AllEntries() {
		sec := e.Section
		if sec == "" {
			sec = "core"
		}
		sections[sec] = append(sections[sec], e)
	}
	return sections
}

// ── Registry list helpers (delegates to Packages) ─────────────────────────────

func (c *Config) AddRegistry(url string) bool {
	url = strings.TrimSpace(url)
	if url == "" {
		return false
	}
	for _, u := range c.Packages.RegistryURLs {
		if u == url {
			return false
		}
	}
	c.Packages.RegistryURLs = append([]string{url}, c.Packages.RegistryURLs...)
	return true
}

func (c *Config) RemoveRegistry(url string) bool {
	url = strings.TrimSpace(url)
	filtered := c.Packages.RegistryURLs[:0]
	found := false
	for _, u := range c.Packages.RegistryURLs {
		if u == url {
			found = true
			continue
		}
		filtered = append(filtered, u)
	}
	c.Packages.RegistryURLs = filtered
	return found
}

func (c *Config) MoveRegistry(url string, direction int) bool {
	for i, u := range c.Packages.RegistryURLs {
		if u != url {
			continue
		}
		j := i + direction
		if j < 0 || j >= len(c.Packages.RegistryURLs) {
			return false
		}
		c.Packages.RegistryURLs[i], c.Packages.RegistryURLs[j] =
			c.Packages.RegistryURLs[j], c.Packages.RegistryURLs[i]
		return true
	}
	return false
}

func Path() (string, error) {
	return configPath()
}