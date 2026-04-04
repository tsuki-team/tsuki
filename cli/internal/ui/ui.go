// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: ui  —  shim over internal/tsukiux
//
//  Adapts the legacy 2-arg Step / SectionTitle API and exposes the inline
//  color helpers used by boards.go and config.go.
// ─────────────────────────────────────────────────────────────────────────────

package ui

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/tsuki-team/tsuki-ux/go/tsukiux"
	"golang.org/x/term"
)

// ── Re-exported types ─────────────────────────────────────────────────────────

type ConfigEntry = tsukiux.ConfigEntry
type Frame       = tsukiux.Frame
type CodeLine    = tsukiux.CodeLine

// ── Status primitives ─────────────────────────────────────────────────────────

func Success(msg string)  { tsukiux.Success(msg) }
func Fail(msg string)     { tsukiux.Fail(msg) }
func Warn(msg string)     { tsukiux.Warn(msg) }
func Info(msg string)     { tsukiux.Info(msg) }
func Note(msg string)     { tsukiux.Note(msg) }
func Header(title string) { tsukiux.Header(title) }

// Step adapts the legacy 2-arg API to tsukiux's single-arg Step.
func Step(label, msg string) {
	tsukiux.Step(label + "  →  " + msg)
}

// SectionTitle is the legacy name for tsukiux.Section.
func SectionTitle(title string) { tsukiux.Section(title) }
func SectionEnd()               { tsukiux.SectionEnd() }

func Artifact(name, size string) { tsukiux.Artifact(name, size) }
func ProgressBar(label string, done, total, width int) {
	tsukiux.ProgressBar(label, done, total, width)
}

func PrintConfig(title string, entries []ConfigEntry, raw bool) {
	tsukiux.PrintConfig(title, entries, raw)
}

func Traceback(errType, errMsg string, frames []Frame) {
	tsukiux.Traceback(errType, errMsg, frames)
}

func Box(title, content string) { tsukiux.Box(title, content) }

// ── LiveBlock ─────────────────────────────────────────────────────────────────

type LiveBlock = tsukiux.LiveBlock

func NewLiveBlock(label string) *LiveBlock { return tsukiux.NewLiveBlock(label) }

// ── Spinner ───────────────────────────────────────────────────────────────────
// Wraps LiveBlock — tsukiux has no separate Spinner type in Go.

type Spinner struct{ block *tsukiux.LiveBlock }

func NewSpinner(msg string) *Spinner {
	return &Spinner{block: tsukiux.NewLiveBlock(msg)}
}
func (s *Spinner) Start()                     { s.block.Start() }
func (s *Spinner) Stop(ok bool, msg string)   { s.block.Finish(ok, msg) }
func (s *Spinner) StopSilent()                { s.block.Finish(true, "") }

// ── Inline color helpers ──────────────────────────────────────────────────────
// Used for table-style output in boards.go and config.go.

type colorPrinter struct{ code string }

func (c colorPrinter) Sprint(s string) string {
	if tsukiux.IsTTY() {
		return c.code + s + "\033[0m"
	}
	return s
}

func (c colorPrinter) Sprintf(format string, a ...interface{}) string {
	return c.Sprint(fmt.Sprintf(format, a...))
}

func (c colorPrinter) Printf(format string, a ...interface{}) {
	if tsukiux.IsTTY() {
		fmt.Printf(c.code+format+"\033[0m", a...)
	} else {
		fmt.Printf(format, a...)
	}
}

func (c colorPrinter) Println(s string) {
	if tsukiux.IsTTY() {
		fmt.Println(c.code + s + "\033[0m")
	} else {
		fmt.Println(s)
	}
}

var (
	ColorTitle   = colorPrinter{"\033[1;97m"}
	ColorKey     = colorPrinter{"\033[96m"}
	ColorValue   = colorPrinter{"\033[93m"}
	ColorString  = colorPrinter{"\033[92m"}
	ColorNumber  = colorPrinter{"\033[94m"}
	ColorBool    = colorPrinter{"\033[95m"}
	ColorNull    = colorPrinter{"\033[90m"}
	ColorMuted   = colorPrinter{"\033[90m"}
	ColorSuccess = colorPrinter{"\033[1;92m"}
	ColorError   = colorPrinter{"\033[1;91m"}
	ColorWarn    = colorPrinter{"\033[1;93m"}
	ColorInfo    = colorPrinter{"\033[96m"}
)

// ── SelectPort ────────────────────────────────────────────────────────────────
// SelectPort shows an arrow-key navigable list of serial ports and returns the
// one chosen by the user. Falls back to a numbered prompt when stdin is not a
// TTY (pipes, CI). Returns an error only when ports is empty.

func SelectPort(ports []string) (string, error) {
	if len(ports) == 0 {
		return "", fmt.Errorf("no serial ports available")
	}
	if len(ports) == 1 {
		return ports[0], nil
	}

	question := "Multiple serial ports detected — select the board port:"
	if tsukiux.IsTTY() {
		fmt.Printf("\n  \033[1;97m%s\033[0m\n\n", question)
	} else {
		fmt.Printf("\n  %s\n\n", question)
	}

	// ── Non-interactive fallback (pipes / CI) ─────────────────────────────
	if !tsukiux.IsTTY() {
		for i, p := range ports {
			fmt.Printf("   %d. %s\n", i+1, p)
		}
		fmt.Printf("\n   Enter number [1-%d] (default 1): ", len(ports))
		reader := bufio.NewReader(os.Stdin)
		line, _ := reader.ReadString('\n')
		line = strings.TrimSpace(line)
		idx := 0
		if line != "" {
			var n int
			if _, err := fmt.Sscanf(line, "%d", &n); err == nil && n >= 1 && n <= len(ports) {
				idx = n - 1
			}
		}
		fmt.Printf("\n  ✔  Selected: %s\n\n", ports[idx])
		return ports[idx], nil
	}

	// ── Raw-mode arrow-key menu ───────────────────────────────────────────
	fd := int(os.Stdin.Fd())
	oldState, err := term.MakeRaw(fd)
	if err != nil {
		// Can't enter raw mode — fall back to index 0.
		return ports[0], nil
	}
	defer term.Restore(fd, oldState) //nolint:errcheck

	fmt.Print("\033[?25l") // hide cursor
	defer fmt.Print("\033[?25h")

	cur := 0
	n := len(ports)

	render := func() {
		for i, p := range ports {
			if i == cur {
				fmt.Print("   \033[K")
				fmt.Printf("\033[1;92m▶ \033[0m\033[1;97m%s\033[0m\n", p)
			} else {
				fmt.Print("   \033[K")
				fmt.Printf("\033[90m  %s\033[0m\n", p)
			}
		}
		fmt.Printf("\033[%dA", n) // move cursor back to top
	}

	render()

	buf := make([]byte, 3)
	for {
		nread, _ := os.Stdin.Read(buf)
		if nread == 0 {
			continue
		}
		switch {
		case buf[0] == '\r' || buf[0] == '\n':
			fmt.Printf("\033[%dB\n", n)
			chosen := ports[cur]
			fmt.Printf("  \033[1;92m✔\033[0m  Selected: \033[1;97m%s\033[0m\n\n", chosen)
			return chosen, nil

		case buf[0] == 3: // Ctrl-C
			fmt.Printf("\033[%dB\n", n)
			fmt.Print("\033[?25h")
			term.Restore(fd, oldState) //nolint:errcheck
			os.Exit(1)

		case nread >= 3 && buf[0] == 27 && buf[1] == '[':
			switch buf[2] {
			case 'A': // ↑
				cur = (cur - 1 + n) % n
			case 'B': // ↓
				cur = (cur + 1) % n
			}
			render()
		}
	}
}

// ── FlashBadge ────────────────────────────────────────────────────────────────

func FlashBadge(mode string) {
	if mode == "" || mode == "arduino-cli" {
		return
	}
	var label string
	normalized := strings.ToLower(strings.TrimSpace(mode))
	switch {
	case strings.Contains(normalized, "+cores") ||
		(strings.Contains(normalized, "tsuki-flash") && strings.Contains(normalized, "modules")):
		label = "⚡ tsuki-flash + cores"
	case strings.HasPrefix(normalized, "tsuki-flash"):
		label = "⚡ tsuki-flash"
	default:
		label = "⚡ " + mode
	}
	if tsukiux.IsTTY() {
		fmt.Printf("\033[1;93m  [ %s ]\033[0m\n", label)
	} else {
		fmt.Printf("  [ %s ]\n", label)
	}
}