// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: scaffold/spec  —  parse de pkg-spec.yaml y board-spec.yaml
// ─────────────────────────────────────────────────────────────────────────────

package scaffold

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// ── Lib spec ──────────────────────────────────────────────────────────────────

// PkgSpec es el formato de un archivo pkg-spec.yaml.
type PkgSpec struct {
	Name        string        `yaml:"name"`
	Version     string        `yaml:"version"`
	Description string        `yaml:"description"`
	Author      string        `yaml:"author"`
	ArduinoLib  string        `yaml:"arduino_lib"`
	CppHeader   string        `yaml:"cpp_header"`
	CppClass    string        `yaml:"cpp_class"`
	Aliases     []string      `yaml:"aliases"`
	Category    string        `yaml:"category"`
	Functions   []FuncSpec    `yaml:"functions"`
	Constants   []ConstSpec   `yaml:"constants"`
	Example     ExampleSpec   `yaml:"example"`
}

type FuncSpec struct {
	Go     string `yaml:"go"`
	Python string `yaml:"python"`
	Cpp    string `yaml:"cpp"`
}

type ConstSpec struct {
	Go     string `yaml:"go"`
	Python string `yaml:"python"`
	Cpp    string `yaml:"cpp"`
}

type ExampleSpec struct {
	Board             string             `yaml:"board"`
	Title             string             `yaml:"title"`
	Description       string             `yaml:"description"`
	Code              string             `yaml:"code"`
	CircuitComponents []CircuitComponent `yaml:"circuit_components"`
}

type CircuitComponent struct {
	ID    string  `yaml:"id"`
	Type  string  `yaml:"type"`
	Label string  `yaml:"label"`
	X     float64 `yaml:"x"`
	Y     float64 `yaml:"y"`
}

// defaults para campos vacíos
func (s *PkgSpec) applyDefaults() {
	if s.Version == "" {
		s.Version = "1.0.0"
	}
	if s.Author == "" {
		s.Author = "tsuki-team"
	}
	if s.Category == "" {
		s.Category = "sensor"
	}
	if s.Example.Board == "" {
		s.Example.Board = "uno"
	}
}

// ── Board spec ────────────────────────────────────────────────────────────────

// BoardSpec es el formato de un archivo board-spec.yaml.
type BoardSpec struct {
	ID          string          `yaml:"id"`
	Name        string          `yaml:"name"`
	Description string          `yaml:"description"`
	FQBN        string          `yaml:"fqbn"`
	Variant     string          `yaml:"variant"`
	Version     string          `yaml:"version"`
	Author      string          `yaml:"author"`
	Toolchain   ToolchainSpec   `yaml:"toolchain"`
	FlashKB     int             `yaml:"flash_kb"`
	RAMKB       int             `yaml:"ram_kb"`
	Defines     []string        `yaml:"defines"`
	Readme      string          `yaml:"readme"`
}

type ToolchainSpec struct {
	Type       string `yaml:"type"`
	MCU        string `yaml:"mcu"`
	FCPU       int    `yaml:"f_cpu"`
	Voltage    int    `yaml:"voltage"`
	Programmer string `yaml:"programmer"`
	Baud       int    `yaml:"baud"`
}

func (s *BoardSpec) applyDefaults() {
	if s.Version == "" {
		s.Version = "1.0.0"
	}
	if s.Author == "" {
		s.Author = "tsuki-team"
	}
	if s.Toolchain.Programmer == "" {
		s.Toolchain.Programmer = "arduino"
	}
	if s.Toolchain.Baud == 0 {
		s.Toolchain.Baud = 115200
	}
}

// ── Loaders ───────────────────────────────────────────────────────────────────

// LoadPkgSpec lee y parsea un archivo pkg-spec.yaml.
func LoadPkgSpec(path string) (*PkgSpec, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	var s PkgSpec
	if err := yaml.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	if s.Name == "" {
		// Fallback: usa el nombre del archivo sin extensión
		base := filepath.Base(path)
		s.Name = strings.TrimSuffix(base, filepath.Ext(base))
	}
	s.applyDefaults()
	return &s, nil
}

// LoadBoardSpec lee y parsea un archivo board-spec.yaml.
func LoadBoardSpec(path string) (*BoardSpec, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	var s BoardSpec
	if err := yaml.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	if s.ID == "" {
		base := filepath.Base(path)
		s.ID = strings.TrimSuffix(base, filepath.Ext(base))
	}
	s.applyDefaults()
	return &s, nil
}

// LoadPkgSpecsFromDir carga todos los *.yaml del directorio como PkgSpec.
func LoadPkgSpecsFromDir(dir string) ([]*PkgSpec, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("reading dir %s: %w", dir, err)
	}
	var specs []*PkgSpec
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".yaml") {
			continue
		}
		s, err := LoadPkgSpec(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		specs = append(specs, s)
	}
	return specs, nil
}

// LoadBoardSpecsFromDir carga todos los *.yaml del directorio como BoardSpec.
func LoadBoardSpecsFromDir(dir string) ([]*BoardSpec, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("reading dir %s: %w", dir, err)
	}
	var specs []*BoardSpec
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".yaml") {
			continue
		}
		s, err := LoadBoardSpec(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		specs = append(specs, s)
	}
	return specs, nil
}