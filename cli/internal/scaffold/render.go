// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: scaffold/render  —  motor de plantillas embed compartido
// ─────────────────────────────────────────────────────────────────────────────

package scaffold

import (
	"bytes"
	"embed"
	"strings"
	"text/template"
)

//go:embed templates/*
var templateFS embed.FS

// renderTemplate ejecuta la plantilla con nombre `name` aplicando `data`.
func renderTemplate(name string, data interface{}) (string, error) {
	tmplData, err := templateFS.ReadFile("templates/" + name)
	if err != nil {
		return "", err
	}

	funcMap := template.FuncMap{
		"join": strings.Join,
	}

	t, err := template.New(name).Funcs(funcMap).Parse(string(tmplData))
	if err != nil {
		return "", err
	}

	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}