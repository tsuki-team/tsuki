// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: scaffold/board  —  genera tsuki_board.toml, README, snippet Rust
// ─────────────────────────────────────────────────────────────────────────────

package scaffold

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// BoardResult contiene los paths generados tras el scaffold de un board.
type BoardResult struct {
	ID          string
	Version     string
	BaseDir     string
	Files       []string
	UpdatedJSON string
	RustSnippet string // snippet listo para pegar en flash/boards.rs
}

// ScaffoldBoardOptions configura el scaffolding de un board.
type ScaffoldBoardOptions struct {
	// OutDir es el directorio raíz de tsuki-pkg (contiene boards/, boards.json).
	OutDir string
	// RegistryJSON es la ruta al boards.json. Vacío = OutDir/boards.json.
	RegistryJSON string
	// DryRun no escribe nada a disco.
	DryRun bool
}

// ScaffoldBoard genera todos los archivos para un board a partir de un BoardSpec.
func ScaffoldBoard(spec *BoardSpec, opts ScaffoldBoardOptions) (*BoardResult, error) {
	if opts.RegistryJSON == "" {
		opts.RegistryJSON = filepath.Join(opts.OutDir, "boards.json")
	}

	baseDir := filepath.Join(opts.OutDir, "boards", spec.ID)
	verDir := filepath.Join(baseDir, "v"+spec.Version)

	result := &BoardResult{
		ID:          spec.ID,
		Version:     spec.Version,
		BaseDir:     baseDir,
		UpdatedJSON: opts.RegistryJSON,
		RustSnippet: buildRustSnippet(spec),
	}

	type fileJob struct {
		path    string
		tmplKey string
		data    interface{}
	}

	jobs := []fileJob{
		{
			path:    filepath.Join(baseDir, "README.md"),
			tmplKey: "board_readme.md.tmpl",
			data:    spec,
		},
		{
			path:    filepath.Join(verDir, "tsuki_board.toml"),
			tmplKey: "tsuki_board_toml.tmpl",
			data:    spec,
		},
	}

	for _, j := range jobs {
		rel, _ := filepath.Rel(opts.OutDir, j.path)
		result.Files = append(result.Files, rel)

		if opts.DryRun {
			continue
		}

		if err := os.MkdirAll(filepath.Dir(j.path), 0755); err != nil {
			return nil, fmt.Errorf("creating dirs for %s: %w", j.path, err)
		}

		content, err := renderTemplate(j.tmplKey, j.data)
		if err != nil {
			return nil, fmt.Errorf("rendering %s: %w", j.tmplKey, err)
		}

		if err := os.WriteFile(j.path, []byte(content), 0644); err != nil {
			return nil, fmt.Errorf("writing %s: %w", j.path, err)
		}
	}

	if !opts.DryRun {
		if err := RegisterBoard(opts.RegistryJSON, spec); err != nil {
			return nil, fmt.Errorf("updating boards.json: %w", err)
		}
	}

	return result, nil
}

// buildRustSnippet genera el snippet de Rust para pegar en flash/boards.rs.
func buildRustSnippet(spec *BoardSpec) string {
	tc := spec.Toolchain
	defines := formatDefines(spec.Defines)

	archVariant := ""
	switch tc.Type {
	case "avr":
		archVariant = fmt.Sprintf(`Arch::Avr(AvrConfig {
        mcu:        "%s",
        f_cpu:      %s,
        programmer: "%s",
        baud:       %s,
    })`,
			tc.MCU,
			formatNumUnderscores(tc.FCPU, 16_000_000),
			tc.Programmer,
			formatNumUnderscores(tc.Baud, 115_200),
		)
	case "esp32":
		archVariant = `Arch::Esp32(Esp32Config { variant: Esp32Variant::Esp32 })`
	case "esp8266":
		archVariant = `Arch::Esp8266`
	case "rp2040":
		archVariant = `Arch::Rp2040`
	case "sam":
		archVariant = `Arch::Sam(SamConfig { mcu: "` + tc.MCU + `" })`
	default:
		archVariant = fmt.Sprintf(`Arch::Unknown("%s")`, tc.Type)
	}

	return fmt.Sprintf(`BoardDef {
    id:       "%s",
    name:     "%s",
    fqbn:     "%s",
    flash_kb: %d,
    ram_kb:   %d,
    arch:     %s,
    defines: &[%s],
}`,
		spec.ID,
		spec.Name,
		spec.FQBN,
		spec.FlashKB,
		spec.RAMKB,
		archVariant,
		defines,
	)
}

func formatDefines(defines []string) string {
	if len(defines) == 0 {
		return ""
	}
	parts := make([]string, len(defines))
	for i, d := range defines {
		parts[i] = `"` + d + `"`
	}
	return strings.Join(parts, ", ")
}

// formatNumUnderscores convierte n a string con underscores cada 3 dígitos
// desde la derecha (estilo Rust: 16_000_000). Usa fallback si n == 0.
func formatNumUnderscores(n, fallback int) string {
	if n == 0 {
		n = fallback
	}
	s := strconv.Itoa(n)
	result := ""
	for i, ch := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			result += "_"
		}
		result += string(ch)
	}
	return result
}

// ── Interactive prompt ────────────────────────────────────────────────────────

// PromptBoardSpec pregunta al usuario en terminal y devuelve un BoardSpec.
func PromptBoardSpec(id string) (*BoardSpec, error) {
	spec := &BoardSpec{ID: id}
	spec.applyDefaults()

	prompt := newPrompter()

	fmt.Println()
	spec.Name = prompt("name (e.g. \"Arduino Nano Every\")", "")
	spec.Description = prompt("description", "")
	spec.FQBN = prompt("fqbn (e.g. \"arduino:avr:nano\")", "")
	spec.Variant = prompt("variant (optional)", "")

	spec.Toolchain.Type = prompt("toolchain type (avr/esp32/esp8266/rp2040/sam)", "avr")
	spec.Toolchain.MCU = prompt("mcu (e.g. \"atmega328p\")", "")

	if v, err := strconv.Atoi(prompt("f_cpu (Hz)", "16000000")); err == nil {
		spec.Toolchain.FCPU = v
	}

	spec.Toolchain.Programmer = prompt("programmer", spec.Toolchain.Programmer)

	if v, err := strconv.Atoi(prompt("baud", strconv.Itoa(spec.Toolchain.Baud))); err == nil {
		spec.Toolchain.Baud = v
	}

	if v, err := strconv.Atoi(prompt("flash_kb", "32")); err == nil {
		spec.FlashKB = v
	}

	if v, err := strconv.Atoi(prompt("ram_kb", "2")); err == nil {
		spec.RAMKB = v
	}

	if definesStr := prompt("defines (comma-separated, optional)", ""); definesStr != "" {
		for _, d := range strings.Split(definesStr, ",") {
			spec.Defines = append(spec.Defines, strings.TrimSpace(d))
		}
	}

	spec.Version = prompt("version", spec.Version)
	spec.Author = prompt("author", spec.Author)

	return spec, nil
}