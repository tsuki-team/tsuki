// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: scaffold/registry  —  actualiza packages.json / boards.json
// ─────────────────────────────────────────────────────────────────────────────

package scaffold

import (
	"encoding/json"
	"fmt"
	"os"
)

const registryBase = "https://raw.githubusercontent.com/tsuki-team/tsuki-pkg/main"

// ── packages.json ─────────────────────────────────────────────────────────────

type packagesFile struct {
	Packages map[string]pkgEntry `json:"packages"`
	Branch   string              `json:"branch"`
}

type pkgEntry struct {
	Type        string            `json:"type"`
	Description string            `json:"description"`
	Author      string            `json:"author"`
	ArduinoLib  string            `json:"arduino_lib"`
	Arch        string            `json:"arch"`
	Category    string            `json:"category"`
	Latest      string            `json:"latest"`
	Versions    map[string]string `json:"versions"`
}

// RegisterLib añade o actualiza la entrada de una librería en packages.json.
func RegisterLib(packagesJSONPath string, spec *PkgSpec) error {
	reg, err := loadPackagesFile(packagesJSONPath)
	if err != nil {
		return err
	}

	tomlURL := fmt.Sprintf("%s/libs/%s/v%s/godotinolib.toml",
		registryBase, spec.Name, spec.Version)

	existing, ok := reg.Packages[spec.Name]
	if ok {
		// Actualiza versión existente
		existing.Latest = spec.Version
		existing.Description = spec.Description
		existing.ArduinoLib = spec.ArduinoLib
		existing.Category = spec.Category
		if existing.Versions == nil {
			existing.Versions = make(map[string]string)
		}
		existing.Versions[spec.Version] = tomlURL
		reg.Packages[spec.Name] = existing
	} else {
		reg.Packages[spec.Name] = pkgEntry{
			Type:        "lib",
			Description: spec.Description,
			Author:      spec.Author,
			ArduinoLib:  spec.ArduinoLib,
			Arch:        "",
			Category:    spec.Category,
			Latest:      spec.Version,
			Versions:    map[string]string{spec.Version: tomlURL},
		}
	}

	return savePackagesFile(packagesJSONPath, reg)
}

func loadPackagesFile(path string) (*packagesFile, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return &packagesFile{
			Packages: make(map[string]pkgEntry),
			Branch:   "main",
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	var reg packagesFile
	if err := json.Unmarshal(data, &reg); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	if reg.Packages == nil {
		reg.Packages = make(map[string]pkgEntry)
	}
	if reg.Branch == "" {
		reg.Branch = "main"
	}
	return &reg, nil
}

func savePackagesFile(path string, reg *packagesFile) error {
	data, err := json.MarshalIndent(reg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0644)
}

// ── boards.json ───────────────────────────────────────────────────────────────

type boardsFile struct {
	Boards map[string]boardEntry `json:"boards"`
	Branch string                `json:"branch"`
}

type boardEntry struct {
	Description string            `json:"description"`
	Author      string            `json:"author"`
	Arch        string            `json:"arch"`
	Category    string            `json:"category"`
	Latest      string            `json:"latest"`
	Versions    map[string]string `json:"versions"`
}

// RegisterBoard añade o actualiza la entrada de un board en boards.json.
func RegisterBoard(boardsJSONPath string, spec *BoardSpec) error {
	reg, err := loadBoardsFile(boardsJSONPath)
	if err != nil {
		return err
	}

	tomlURL := fmt.Sprintf("%s/boards/%s/v%s/tsuki_board.toml",
		registryBase, spec.ID, spec.Version)

	existing, ok := reg.Boards[spec.ID]
	if ok {
		existing.Latest = spec.Version
		existing.Description = spec.Description
		if existing.Versions == nil {
			existing.Versions = make(map[string]string)
		}
		existing.Versions[spec.Version] = tomlURL
		reg.Boards[spec.ID] = existing
	} else {
		reg.Boards[spec.ID] = boardEntry{
			Description: spec.Description,
			Author:      spec.Author,
			Arch:        spec.Toolchain.Type,
			Category:    "basic",
			Latest:      spec.Version,
			Versions:    map[string]string{spec.Version: tomlURL},
		}
	}

	return saveBoardsFile(boardsJSONPath, reg)
}

func loadBoardsFile(path string) (*boardsFile, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return &boardsFile{
			Boards: make(map[string]boardEntry),
			Branch: "main",
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	var reg boardsFile
	if err := json.Unmarshal(data, &reg); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	if reg.Boards == nil {
		reg.Boards = make(map[string]boardEntry)
	}
	if reg.Branch == "" {
		reg.Branch = "main"
	}
	return &reg, nil
}

func saveBoardsFile(path string, reg *boardsFile) error {
	data, err := json.MarshalIndent(reg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0644)
}