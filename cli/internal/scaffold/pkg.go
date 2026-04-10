// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: scaffold/pkg  —  genera godotinolib.toml, README, ejemplos
// ─────────────────────────────────────────────────────────────────────────────

package scaffold

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// PkgResult contiene los paths generados tras el scaffold.
type PkgResult struct {
	Name        string
	Version     string
	BaseDir     string   // libs/<n>/
	Files       []string // rutas relativas generadas
	UpdatedJSON string   // path al packages.json actualizado
}

// ScaffoldPkgOptions configura el scaffolding de una librería.
type ScaffoldPkgOptions struct {
	// OutDir es el directorio raíz de tsuki-pkg (contiene libs/, packages.json).
	OutDir string
	// RegistryJSON es la ruta al packages.json. Vacío = OutDir/packages.json.
	RegistryJSON string
	// DryRun no escribe nada a disco.
	DryRun bool
}

// ScaffoldPkg genera todos los archivos para una librería a partir de un PkgSpec.
func ScaffoldPkg(spec *PkgSpec, opts ScaffoldPkgOptions) (*PkgResult, error) {
	if opts.RegistryJSON == "" {
		opts.RegistryJSON = filepath.Join(opts.OutDir, "packages.json")
	}

	baseDir := filepath.Join(opts.OutDir, "libs", spec.Name)
	verDir := filepath.Join(baseDir, "v"+spec.Version)
	exDir := filepath.Join(verDir, "examples", "basic")

	result := &PkgResult{
		Name:        spec.Name,
		Version:     spec.Version,
		BaseDir:     baseDir,
		UpdatedJSON: opts.RegistryJSON,
	}

	type fileJob struct {
		path    string
		tmplKey string
		data    interface{}
	}

	jobs := []fileJob{
		{
			path:    filepath.Join(baseDir, "README.md"),
			tmplKey: "pkg_readme.md.tmpl",
			data:    spec,
		},
		{
			path:    filepath.Join(verDir, "godotinolib.toml"),
			tmplKey: "godotinolib.toml.tmpl",
			data:    spec,
		},
	}

	if spec.Example.Code != "" {
		jobs = append(jobs,
			fileJob{
				path:    filepath.Join(exDir, "main.go"),
				tmplKey: "main_go.tmpl",
				data:    spec.Example,
			},
			fileJob{
				path:    filepath.Join(exDir, "tsuki_example.json"),
				tmplKey: "tsuki_example_json.tmpl",
				data:    spec.Example,
			},
		)
		if len(spec.Example.CircuitComponents) > 0 {
			jobs = append(jobs, fileJob{
				path:    filepath.Join(exDir, "circuit.tsuki-circuit"),
				tmplKey: "circuit_tsuki_circuit.tmpl",
				data:    spec.Example,
			})
		}
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
		if err := RegisterLib(opts.RegistryJSON, spec); err != nil {
			return nil, fmt.Errorf("updating packages.json: %w", err)
		}
	}

	return result, nil
}

// ── Interactive prompt ────────────────────────────────────────────────────────

// PromptPkgSpec pregunta al usuario en terminal y devuelve un PkgSpec.
func PromptPkgSpec(name string) (*PkgSpec, error) {
	spec := &PkgSpec{Name: name}
	spec.applyDefaults()

	prompt := newPrompter()

	fmt.Println()
	spec.Description = prompt("description", "")
	spec.ArduinoLib = prompt("arduino_lib (e.g. \"DHT sensor library\")", "")
	spec.CppHeader = prompt("cpp_header  (e.g. \"DHT.h\")", "")
	spec.CppClass = prompt("cpp_class   (e.g. \"DHT\", optional)", "")
	spec.Category = prompt("category    (sensor/actuator/display/comms)", spec.Category)
	spec.Version = prompt("version", spec.Version)
	spec.Author = prompt("author", spec.Author)

	// Al menos una función
	fmt.Println()
	fmt.Println("  Functions (leave go name empty to finish):")
	for {
		goName := prompt("    go name", "")
		if goName == "" {
			break
		}
		py := prompt("    python name", strings.ToLower(goName))
		cpp := prompt("    cpp template (e.g. \"{0}.read()\")", "")
		spec.Functions = append(spec.Functions, FuncSpec{Go: goName, Python: py, Cpp: cpp})
	}

	fmt.Println()
	fmt.Println("  Constants (leave go name empty to finish):")
	for {
		goName := prompt("    go name", "")
		if goName == "" {
			break
		}
		py := prompt("    python name", goName)
		cpp := prompt("    cpp value", goName)
		spec.Constants = append(spec.Constants, ConstSpec{Go: goName, Python: py, Cpp: cpp})
	}

	return spec, nil
}