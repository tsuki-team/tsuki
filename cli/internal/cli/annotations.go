// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: annotations
//
//  Parses tsuki source annotations from .go and .py files.
//
//  Both Go and Python use line comments:
//    Go:     // #[flags("UPLOAD=20000", "MODE=2")]
//    Python: # #[flags("UPLOAD=20000", "MODE=2")]
//
//  Supported annotations:
//    #[flags("KEY=VAL", "KEY2=VAL2")]   → TSUKI_FLAGS env var
//    #[modules(Wifi, Bt, Fs)]           → TSUKI_MODULES env var
//
//  Multiple annotation lines are merged (flags concatenated with commas,
//  modules merged into one comma-separated list).
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"os"
	"regexp"
	"strings"
)

// TsukiAnnotations holds the parsed values of #[flags(...)] and #[modules(...)]
// extracted from source files.
type TsukiAnnotations struct {
	// Flags is the value for TSUKI_FLAGS env var, e.g. "UPLOAD=20000,MODE=2"
	Flags string
	// Modules is the value for TSUKI_MODULES env var, e.g. "Wifi,Bt,Fs"
	Modules string
}

// ParseAnnotations scans the given source files for tsuki annotations and
// returns the merged result.  Files that cannot be read are silently skipped.
func ParseAnnotations(srcFiles []string) TsukiAnnotations {
	var flagParts    []string
	var moduleParts  []string

	for _, path := range srcFiles {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			flags, modules, ok := parseAnnotationLine(line)
			if !ok {
				continue
			}
			flagParts   = append(flagParts, flags...)
			moduleParts = append(moduleParts, modules...)
		}
	}

	// Deduplicate flags (last value for duplicate keys wins)
	flagMap := make(map[string]string)
	var flagOrder []string
	for _, f := range flagParts {
		key := f
		if eq := strings.IndexByte(f, '='); eq >= 0 {
			key = f[:eq]
		}
		if _, seen := flagMap[key]; !seen {
			flagOrder = append(flagOrder, key)
		}
		val := ""
		if eq := strings.IndexByte(f, '='); eq >= 0 {
			val = f[eq+1:]
		}
		flagMap[key] = val
	}
	var finalFlags []string
	for _, k := range flagOrder {
		v := flagMap[k]
		if v != "" {
			finalFlags = append(finalFlags, k+"="+v)
		} else {
			finalFlags = append(finalFlags, k)
		}
	}

	// Deduplicate modules (preserve order, case-insensitive)
	seen := make(map[string]bool)
	var finalModules []string
	for _, m := range moduleParts {
		lower := strings.ToLower(strings.TrimSpace(m))
		if lower == "" || seen[lower] {
			continue
		}
		seen[lower] = true
		finalModules = append(finalModules, strings.TrimSpace(m))
	}

	return TsukiAnnotations{
		Flags:   strings.Join(finalFlags, ","),
		Modules: strings.Join(finalModules, ","),
	}
}

// reAnnotation matches a tsuki annotation in a comment line, in both Go and Python.
// It captures the annotation body (everything between #[ and ]).
//
//	Go:     // #[flags("UPLOAD=20000", "MODE=2")]
//	Python: # #[flags("UPLOAD=20000", "MODE=2")]
var reAnnotation = regexp.MustCompile(`(?:\/\/|#)\s*#\[([^\]]+)\]`)

// parseAnnotationLine checks a single source line for a tsuki annotation.
// Returns flag pairs, module names, and whether anything was found.
func parseAnnotationLine(line string) (flags []string, modules []string, ok bool) {
	m := reAnnotation.FindStringSubmatch(strings.TrimSpace(line))
	if m == nil {
		return nil, nil, false
	}

	body := strings.TrimSpace(m[1]) // e.g. `flags("UPLOAD=20000", "MODE=2")`

	switch {
	case strings.HasPrefix(body, "flags("):
		inner := strings.TrimSuffix(strings.TrimPrefix(body, "flags("), ")")
		for _, part := range splitArgs(inner) {
			part = strings.Trim(strings.TrimSpace(part), `"`)
			if part != "" {
				flags = append(flags, part)
			}
		}
		return flags, nil, true

	case strings.HasPrefix(body, "modules("):
		inner := strings.TrimSuffix(strings.TrimPrefix(body, "modules("), ")")
		for _, m := range strings.Split(inner, ",") {
			m = strings.TrimSpace(m)
			if m != "" {
				modules = append(modules, m)
			}
		}
		return nil, modules, true
	}

	return nil, nil, false
}

// splitArgs splits a comma-separated argument list, respecting quoted strings.
// Example: `"UPLOAD=20000", "MODE=2"` → ["UPLOAD=20000", "MODE=2"]
func splitArgs(s string) []string {
	var parts []string
	var cur   strings.Builder
	inQuote  := false

	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '"':
			inQuote = !inQuote
		case c == ',' && !inQuote:
			parts = append(parts, cur.String())
			cur.Reset()
		default:
			cur.WriteByte(c)
		}
	}
	if cur.Len() > 0 {
		parts = append(parts, cur.String())
	}
	return parts
}
