// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: boardmgr  —  install / remove / list board packages
//
//  Board packages live under a separate directory from tsukilib packages:
//    1. config.json  boards_dir
//    2. tsuki_BOARDS environment variable
//    3. OS default: ~/.local/share/tsuki/boards  (Linux/macOS)
//                   %APPDATA%\tsuki\boards        (Windows)
//
//  Board registry (boards.json) is co-located with packages.json in the
//  same registry URL, but under the "boards" key of the registry JSON.
//
//  Board manifests are TOML files named board.toml with this structure:
//
//    [board]
//    id             = "uno"
//    name           = "Arduino Uno"
//    version        = "1.0.0"
//    fqbn           = "arduino:avr:uno"
//    variant        = "standard"
//    flash_kb       = 32
//    ram_kb         = 2
//    toolchain_type = "avr"          # avr | sam | esp32 | esp8266 | rp2040
//    defines        = "ARDUINO_AVR_UNO,ARDUINO_ARCH_AVR"
//    aliases        = "wemos_d1_mini"  # optional comma-separated aliases
//
//    [avr]         # present when toolchain_type = "avr"
//    mcu        = "atmega328p"
//    f_cpu      = 16000000
//    programmer = "arduino"
//    baud       = 115200
//
//    [esp32]       # present when toolchain_type = "esp32"
//    variant = "esp32"
//    f_cpu   = 240000000
//
//    [esp8266]     # present when toolchain_type = "esp8266"
//    f_cpu = 80000000
//
//    [sam]         # present when toolchain_type = "sam"
//    mcu   = "cortex-m3"
//    f_cpu = 84000000
// ─────────────────────────────────────────────────────────────────────────────

package boardmgr

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/tsuki/cli/internal/config"
	"github.com/tsuki/cli/internal/ui"
)

const boardManifestFile = "board.toml"

// ── Paths ─────────────────────────────────────────────────────────────────────

// BoardsDir returns the local directory where board packages are installed.
func BoardsDir() string {
	cfg, err := config.Load()
	if err == nil && cfg.ResolvedBoardsDir() != "" {
		return cfg.ResolvedBoardsDir()
	}
	if env := os.Getenv("tsuki_BOARDS"); env != "" {
		return env
	}
	return config.Default().ResolvedBoardsDir()
}

func boardDir(id, version string) string {
	return filepath.Join(BoardsDir(), id, version)
}

func boardManifestPath(id, version string) string {
	return filepath.Join(boardDir(id, version), boardManifestFile)
}

// ── InstalledBoard ────────────────────────────────────────────────────────────

// InstalledBoard holds the parsed metadata of an installed board package.
type InstalledBoard struct {
	ID            string
	Name          string
	Version       string
	Description   string
	FQBN          string
	Variant       string
	FlashKB       int
	RAMKB         int
	ToolchainType string // "avr" | "sam" | "esp32" | "esp8266" | "rp2040"
	Defines       []string
	Aliases       []string

	// AVR-specific
	AvrMCU        string
	AvrFCPU       int
	AvrProgrammer string
	AvrBaud       int

	// ESP32-specific
	Esp32Variant string
	Esp32FCPU    int

	// ESP8266-specific
	Esp8266FCPU int

	// SAM-specific
	SamMCU   string
	SamFCPU  int

	Path string
}

// Arch returns the architecture string used in SDK paths (e.g. "avr", "esp32").
func (b *InstalledBoard) Arch() string {
	switch b.ToolchainType {
	case "avr":
		return "avr"
	case "sam":
		return "sam"
	case "esp32":
		return "esp32"
	case "esp8266":
		return "esp8266"
	case "rp2040":
		return "rp2040"
	default:
		return b.ToolchainType
	}
}

// ListInstalled scans BoardsDir and returns all installed board packages.
func ListInstalled() ([]InstalledBoard, error) {
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
			mpath := filepath.Join(root, id, v.Name(), boardManifestFile)
			if _, err := os.Stat(mpath); err != nil {
				continue
			}
			data, err := os.ReadFile(mpath)
			if err != nil {
				continue
			}
			b, err := parseBoardTOML(string(data))
			if err != nil {
				continue
			}
			b.Path = mpath
			boards = append(boards, *b)
		}
	}

	sort.Slice(boards, func(i, j int) bool { return boards[i].ID < boards[j].ID })
	return boards, nil
}

// ── Install ───────────────────────────────────────────────────────────────────

// InstallOptions describes a board install request.
type InstallOptions struct {
	Source  string // local path, HTTPS URL, or bare board ID
	Version string // optional version override
}

// Install fetches a board.toml and places it in BoardsDir.
func Install(opts InstallOptions) (*InstalledBoard, error) {
	tomlData, err := fetchTOML(opts.Source)
	if err != nil {
		return nil, err
	}

	b, err := parseBoardTOML(tomlData)
	if err != nil {
		return nil, err
	}
	if opts.Version != "" {
		b.Version = opts.Version
	}

	destDir := boardDir(b.ID, b.Version)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return nil, fmt.Errorf("creating board dir: %w", err)
	}
	destFile := filepath.Join(destDir, boardManifestFile)
	if err := os.WriteFile(destFile, []byte(tomlData), 0644); err != nil {
		return nil, fmt.Errorf("writing board.toml: %w", err)
	}
	b.Path = destFile
	return b, nil
}

// Remove uninstalls a board package by ID and version.
func Remove(id, version string) error {
	dir := boardDir(id, version)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return fmt.Errorf("board %s@%s is not installed", id, version)
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

// IsInstalled reports whether a board is installed and returns its version.
func IsInstalled(id string) (bool, string) {
	boards, _ := ListInstalled()
	for _, b := range boards {
		if b.ID == id {
			return true, b.Version
		}
		for _, alias := range b.Aliases {
			if alias == id {
				return true, b.Version
			}
		}
	}
	return false, ""
}

// FindInstalled returns the InstalledBoard for the given ID (or alias), or nil.
func FindInstalled(id string) *InstalledBoard {
	boards, _ := ListInstalled()
	for i := range boards {
		if boards[i].ID == id {
			return &boards[i]
		}
		for _, alias := range boards[i].Aliases {
			if alias == id {
				return &boards[i]
			}
		}
	}
	return nil
}

// ── Registry ──────────────────────────────────────────────────────────────────

// RegistryIndex mirrors the structure of packages.json but for the "boards" key.
type RegistryIndex struct {
	Boards map[string]RegistryBoard `json:"boards"`
	Branch string                   `json:"branch,omitempty"`
}

// RegistryBoard is one entry in the boards registry.
type RegistryBoard struct {
	Description string            `json:"description"`
	Author      string            `json:"author"`
	Latest      string            `json:"latest"`
	Versions    map[string]string `json:"versions"` // version → TOML URL
}

// RegistryEntry is what SearchRegistry returns.
type RegistryEntry struct {
	ID          string
	Version     string
	Description string
	Author      string
	URL         string
}

func fetchRegistry() (*RegistryIndex, error) {
	cfg, _ := config.Load()
	if cfg == nil {
		cfg = config.Default()
	}
	// Board registry lives at the same base URL as the package registry,
	// but in the "boards" section of boards.json (or the main registry.json).
	// By convention we expect it at: <registry_base>/boards.json
	urls := cfg.ResolvedRegistryURLs()
	if len(urls) == 0 {
		return nil, fmt.Errorf("no registry URLs configured")
	}

	for _, regURL := range urls {
		// Derive boards.json URL from registry base:
		// https://raw.githubusercontent.com/.../pkg/packages.json
		//  → https://raw.githubusercontent.com/.../pkg/boards.json
		boardsURL := strings.TrimSuffix(regURL, "packages.json") + "boards.json"

		data, err := httpGet(boardsURL)
		if err != nil {
			ui.Warn(fmt.Sprintf("board registry unavailable: %s — %v", boardsURL, err))
			continue
		}

		var idx RegistryIndex
		if err := json.Unmarshal(data, &idx); err != nil {
			ui.Warn(fmt.Sprintf("parsing board registry from %s: %v", boardsURL, err))
			continue
		}
		return &idx, nil
	}
	return nil, fmt.Errorf("no board registries could be reached")
}

// SearchRegistry returns board registry entries matching query.
func SearchRegistry(query string) ([]RegistryEntry, error) {
	idx, err := fetchRegistry()
	if err != nil {
		return nil, err
	}

	q := strings.ToLower(query)
	var results []RegistryEntry
	for id, b := range idx.Boards {
		if q == "" ||
			strings.Contains(strings.ToLower(id), q) ||
			strings.Contains(strings.ToLower(b.Description), q) ||
			strings.Contains(strings.ToLower(b.Author), q) {
			results = append(results, RegistryEntry{
				ID:          id,
				Version:     b.Latest,
				Description: b.Description,
				Author:      b.Author,
				URL:         b.Versions[b.Latest],
			})
		}
	}
	sort.Slice(results, func(i, j int) bool { return results[i].ID < results[j].ID })
	return results, nil
}

// InstallFromRegistry installs a board by ID from the registry.
func InstallFromRegistry(id, version string) (*InstalledBoard, error) {
	idx, err := fetchRegistry()
	if err != nil {
		return nil, err
	}

	entry, ok := idx.Boards[id]
	if !ok {
		return nil, fmt.Errorf(
			"board %q not found in registry — run `tsuki boards search` to see available boards",
			id,
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
			"version %q not found for board %q. Available: %s",
			ver, id, strings.Join(versions, ", "),
		)
	}

	return Install(InstallOptions{Source: tomlURL, Version: ver})
}

// ── Print helpers ─────────────────────────────────────────────────────────────

// PrintList prints installed boards to stdout.
func PrintList(boards []InstalledBoard) {
	if len(boards) == 0 {
		ui.Info("No boards installed — run `tsuki boards install <id>` to add one")
		return
	}

	ui.SectionTitle(fmt.Sprintf("Installed boards (%d)", len(boards)))
	fmt.Println()

	ui.ColorTitle.Printf("  %-16s  %-10s  %-34s  %7s  %6s  %s\n",
		"ID", "VERSION", "NAME", "FLASH", "RAM", "TOOLCHAIN")
	ui.ColorMuted.Println("  " + strings.Repeat("─", 98))

	for _, b := range boards {
		ui.ColorKey.Printf("  %-16s", b.ID)
		ui.ColorNumber.Printf("  %-10s", b.Version)
		fmt.Printf("  %-34s", b.Name)
		ui.ColorNumber.Printf("  %5dK", b.FlashKB)
		ui.ColorNumber.Printf("  %4dK", b.RAMKB)
		ui.ColorMuted.Printf("  %s\n", b.ToolchainType)
	}
	fmt.Println()
}

// PrintRegistryResults prints boards found in the registry.
func PrintRegistryResults(entries []RegistryEntry) {
	if len(entries) == 0 {
		ui.Info("No boards found matching your query")
		return
	}

	ui.ColorTitle.Printf("  %-16s  %-10s  %-50s\n", "ID", "VERSION", "DESCRIPTION")
	ui.ColorMuted.Println("  " + strings.Repeat("─", 82))

	for _, e := range entries {
		ui.ColorKey.Printf("  %-16s", e.ID)
		ui.ColorNumber.Printf("  %-10s", e.Version)
		fmt.Printf("  %s\n", e.Description)
	}
	fmt.Println()

	ui.Info("Install with: tsuki boards install <id>")
}

// ── TOML parser ───────────────────────────────────────────────────────────────

// parseBoardTOML parses a board.toml file into an InstalledBoard.
// Uses a simple line-by-line state-machine — no external TOML library needed.
func parseBoardTOML(toml string) (*InstalledBoard, error) {
	b := &InstalledBoard{}
	section := ""

	for _, raw := range strings.Split(toml, "\n") {
		line := strings.TrimSpace(raw)

		// Section header
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.ToLower(line[1 : len(line)-1])
			continue
		}

		k, v, ok := parseKV(line)
		if !ok {
			continue
		}

		switch section {
		case "board":
			switch k {
			case "id":
				b.ID = v
			case "name":
				b.Name = v
			case "version":
				b.Version = v
			case "description":
				b.Description = v
			case "fqbn":
				b.FQBN = v
			case "variant":
				b.Variant = v
			case "flash_kb":
				b.FlashKB, _ = strconv.Atoi(v)
			case "ram_kb":
				b.RAMKB, _ = strconv.Atoi(v)
			case "toolchain_type":
				b.ToolchainType = v
			case "defines":
				if v != "" {
					b.Defines = strings.Split(v, ",")
					for i := range b.Defines {
						b.Defines[i] = strings.TrimSpace(b.Defines[i])
					}
				}
			case "aliases":
				if v != "" {
					b.Aliases = strings.Split(v, ",")
					for i := range b.Aliases {
						b.Aliases[i] = strings.TrimSpace(b.Aliases[i])
					}
				}
			}

		case "avr":
			switch k {
			case "mcu":
				b.AvrMCU = v
			case "f_cpu":
				b.AvrFCPU, _ = strconv.Atoi(v)
			case "programmer":
				b.AvrProgrammer = v
			case "baud":
				b.AvrBaud, _ = strconv.Atoi(v)
			}

		case "esp32":
			switch k {
			case "variant":
				b.Esp32Variant = v
			case "f_cpu":
				b.Esp32FCPU, _ = strconv.Atoi(v)
			}

		case "esp8266":
			if k == "f_cpu" {
				b.Esp8266FCPU, _ = strconv.Atoi(v)
			}

		case "sam":
			switch k {
			case "mcu":
				b.SamMCU = v
			case "f_cpu":
				b.SamFCPU, _ = strconv.Atoi(v)
			}
		}
	}

	if b.ID == "" || b.Version == "" {
		return nil, fmt.Errorf("board.toml must declare [board] id and version")
	}
	return b, nil
}

func parseKV(line string) (key, value string, ok bool) {
	if strings.HasPrefix(line, "#") || strings.HasPrefix(line, "[") || line == "" {
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

// ── HTTP ──────────────────────────────────────────────────────────────────────

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


