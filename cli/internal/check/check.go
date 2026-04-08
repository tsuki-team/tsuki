// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: check  —  validate source files without building
// ─────────────────────────────────────────────────────────────────────────────

package check

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/tsuki/cli/internal/core"
	"github.com/tsuki/cli/internal/manifest"
	"github.com/tsuki/cli/internal/ui"
)

// errCoreMissing is returned when tsuki-core is not installed.
var errCoreMissing = errors.New("tsuki-core not found — install it or set core_binary in your config")

// IsCoreMissing reports whether err signals that tsuki-core is not installed.
// The Cobra command uses this to exit with code 2 instead of 1.
func IsCoreMissing(err error) bool { return errors.Is(err, errCoreMissing) }

// Options controls the check command.
type Options struct {
	Board   string
	Verbose bool
	CoreBin string
	// Mode is the checker strict-mode: "strict" (default), "dev", or "none".
	Mode string
}

// Report holds the results of a check run.
type Report struct {
	Files    int
	Warnings []Issue
	Errors   []Issue
}

// Issue is a single warning or error found during check.
type Issue struct {
	File    string
	Line    int
	Message string
	IsError bool
}

// Run checks all source files in the project src/ directory.
// Supports Go (.go) and Python (.py) projects.
func Run(projectDir string, m *manifest.Manifest, opts Options) (*Report, error) {
	board := opts.Board
	if board == "" {
		board = m.Board
	}

	transpiler := core.New(opts.CoreBin, opts.Verbose)
	if !transpiler.Installed() {
		return nil, errCoreMissing
	}

	srcDir := filepath.Join(projectDir, "src")

	lang := m.EffectiveLanguage()
	var srcFiles []string
	var ext, langLabel string

	switch lang {
	case manifest.LangPython:
		ext = "*.py"
		langLabel = "Python"
	default:
		ext = "*.go"
		langLabel = "Go"
	}

	var err error
	srcFiles, err = filepath.Glob(filepath.Join(srcDir, ext))
	if err != nil || len(srcFiles) == 0 {
		return nil, fmt.Errorf("no %s files found in %s", ext, srcDir)
	}

	ui.SectionTitle(fmt.Sprintf("Checking %s  [board: %s]", langLabel, board))

	pkgNames := make([]string, 0, len(m.Packages))
	for _, p := range m.Packages {
		pkgNames = append(pkgNames, p.Name)
	}
	libsDir := ""

	report := &Report{Files: len(srcFiles)}

	for _, srcFile := range srcFiles {
		ui.Info(fmt.Sprintf("Checking %s…", filepath.Base(srcFile)))

		warnings, errs, checkErr := transpiler.CheckFile(
			srcFile,
			board,
			lang,
			libsDir,
			pkgNames,
			opts.Mode,
		)

		for _, w := range warnings {
			report.Warnings = append(report.Warnings, Issue{File: srcFile, Message: w})
		}
		for _, e := range errs {
			report.Errors = append(report.Errors, Issue{File: srcFile, Message: e, IsError: true})
		}
		if checkErr != nil {
			report.Errors = append(report.Errors, Issue{
				File:    srcFile,
				Message: checkErr.Error(),
				IsError: true,
			})
		}
	}

	return report, nil
}

// PrintReport renders the check report to stdout.
// Rust-formatted multi-line messages (starting with "error[T…]" / "warning[T…]")
// are printed verbatim; plain single-line messages use ui.Warn / ui.Fail.
func PrintReport(report *Report) {
	fmt.Println()

	if len(report.Errors) == 0 && len(report.Warnings) == 0 {
		ui.Success(fmt.Sprintf("All %d file(s) OK — no errors or warnings", report.Files))
		return
	}

	printIssue := func(issue Issue) {
		msg := strings.TrimSpace(issue.Message)
		if isRustFormatted(msg) {
			fmt.Println(msg)
			fmt.Println()
			return
		}
		file := filepath.Base(issue.File)
		if issue.IsError {
			if issue.Line > 0 {
				ui.Fail(fmt.Sprintf("%s:%d  %s", file, issue.Line, msg))
			} else {
				ui.Fail(fmt.Sprintf("%s  %s", file, msg))
			}
		} else {
			if issue.Line > 0 {
				ui.Warn(fmt.Sprintf("%s:%d  %s", file, issue.Line, msg))
			} else {
				ui.Warn(fmt.Sprintf("%s  %s", file, msg))
			}
		}
	}

	for _, w := range report.Warnings {
		printIssue(w)
	}
	for _, e := range report.Errors {
		printIssue(e)
	}

	// Rustc-style summary
	fmt.Println()
	nErr  := len(report.Errors)
	nWarn := len(report.Warnings)
	switch {
	case nErr > 0 && nWarn > 0:
		ui.Fail(fmt.Sprintf("error: aborting due to %s; %s emitted",
			pluralise(nErr, "error"), pluralise(nWarn, "warning")))
	case nErr > 0:
		ui.Fail(fmt.Sprintf("error: aborting due to %s", pluralise(nErr, "error")))
	default:
		ui.Warn(fmt.Sprintf("%s emitted", pluralise(nWarn, "warning")))
	}
}

// isRustFormatted reports whether msg is already in Rust-style diagnostic format.
func isRustFormatted(msg string) bool {
	if !strings.Contains(msg, "\n") {
		return false
	}
	return strings.HasPrefix(msg, "error[T") || strings.HasPrefix(msg, "warning[T")
}

func pluralise(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("1 %s", word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}
