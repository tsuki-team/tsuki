// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: flash  —  upload firmware to the connected board
// ─────────────────────────────────────────────────────────────────────────────

package flash

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/tsuki/cli/internal/manifest"
	"github.com/tsuki/cli/internal/ui"
)

// Options controls the flash operation.
type Options struct {
	Port        string // serial port; empty = auto-detect
	Board       string // override manifest board
	BuildDir    string // directory with compiled firmware (.hex)
	ProjectName string // project name → <n>.hex; derived from manifest if empty
	ArduinoCLI  string
	FlashBinary string // path to tsuki-flash binary
	Backend     string // "tsuki-flash" or "arduino-cli"
	Verbose     bool
}

// boardFQBN maps short board IDs to FQBNs.
var boardFQBN = map[string]string{
	"uno":      "arduino:avr:uno",
	"nano":     "arduino:avr:nano",
	"mega":     "arduino:avr:mega",
	"leonardo": "arduino:avr:leonardo",
	"micro":    "arduino:avr:micro",
	"due":      "arduino:sam:arduino_due_x",
	"esp32":    "esp32:esp32:esp32",
	"esp8266":  "esp8266:esp8266:generic",
	"pico":     "rp2040:rp2040:rpipico",
}

// uploadTimeout is the maximum time allowed for a single avrdude/esptool call.
const uploadTimeout = 60 * time.Second

// Run uploads the firmware to the board.
func Run(projectDir string, m *manifest.Manifest, opts Options) error {
	board := opts.Board
	if board == "" {
		board = m.Board
	}

	// Firmware lives in build/.cache. Respect explicit --build-dir if given.
	buildDir := opts.BuildDir
	if buildDir == "" {
		buildDir = filepath.Join(projectDir, m.Build.OutputDir, ".cache")
	}

	projectName := opts.ProjectName
	if projectName == "" {
		projectName = m.Name
	}

	backend := opts.Backend
	if backend == "" {
		backend = "arduino-cli"
	}

	switch backend {
	case "tsuki-flash":
		return uploadTsukiFlash(board, buildDir, projectName, opts)
	default:
		return uploadArduinoCLI(board, buildDir, opts)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
//  Backend: tsuki-flash upload
// ─────────────────────────────────────────────────────────────────────────────

func uploadTsukiFlash(board, buildDir, projectName string, opts Options) error {
	flashBin := opts.FlashBinary
	if flashBin == "" {
		flashBin = "tsuki-flash"
	}

	port, err := resolvePort(opts.Port, func() ([]string, error) {
		return detectPortsTsukiFlash(flashBin)
	})
	if err != nil {
		return err
	}

	args := []string{
		"upload",
		"--board", board,
		"--port", port,
		"--build-dir", buildDir,
		"--name", projectName,
	}
	if opts.Verbose {
		args = append(args, "--verbose")
	}

	ui.SectionTitle(fmt.Sprintf("Uploading to %s  [board: %s]  [tsuki-flash]", port, board))
	sp := ui.NewSpinner("Flashing firmware...")
	sp.Start()

	ctx, cancel := context.WithTimeout(context.Background(), uploadTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, flashBin, args...)
	out, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		sp.Stop(false, "upload timed out")
		ui.Warn(fmt.Sprintf(
			"avrdude did not respond on %s after %s.\n  Is the correct port selected? Try: tsuki upload --port <PORT>",
			port, uploadTimeout,
		))
		return fmt.Errorf("upload timed out on %s", port)
	}
	if err != nil {
		sp.Stop(false, "upload failed")
		renderFlashError(string(out), port)
		return fmt.Errorf("upload failed")
	}

	sp.Stop(true, fmt.Sprintf("firmware uploaded to %s", port))
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
//  Backend: arduino-cli upload
// ─────────────────────────────────────────────────────────────────────────────

func uploadArduinoCLI(board, buildDir string, opts Options) error {
	fqbn, ok := boardFQBN[strings.ToLower(board)]
	if !ok {
		return fmt.Errorf("unknown board %q — run `tsuki boards list` for the full list", board)
	}

	arduinoCLI := opts.ArduinoCLI
	if arduinoCLI == "" {
		arduinoCLI = "arduino-cli"
	}

	port, err := resolvePort(opts.Port, func() ([]string, error) {
		return detectPortsArduinoCLI(arduinoCLI)
	})
	if err != nil {
		return err
	}

	args := []string{
		"upload",
		"--fqbn", fqbn,
		"--port", port,
		"--input-dir", buildDir,
	}
	if opts.Verbose {
		args = append(args, "--verbose")
	}

	ui.SectionTitle(fmt.Sprintf("Uploading to %s  [%s]", port, fqbn))
	sp := ui.NewSpinner("Flashing firmware...")
	sp.Start()

	ctx, cancel := context.WithTimeout(context.Background(), uploadTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, arduinoCLI, args...)
	out, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		sp.Stop(false, "upload timed out")
		ui.Warn(fmt.Sprintf(
			"arduino-cli did not respond on %s after %s.\n  Is the correct port selected? Try: tsuki upload --port <PORT>",
			port, uploadTimeout,
		))
		return fmt.Errorf("upload timed out on %s", port)
	}
	if err != nil {
		sp.Stop(false, "upload failed")
		renderFlashError(string(out), port)
		return fmt.Errorf("upload failed")
	}

	sp.Stop(true, fmt.Sprintf("firmware uploaded to %s", port))
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
//  Port resolution
// ─────────────────────────────────────────────────────────────────────────────

// resolvePort returns the port to use for upload.
//
//   - If opts.Port was provided explicitly, it is returned immediately.
//   - Otherwise all available ports are enumerated via detect().
//   - 0 ports → clear error with hint.
//   - 1 port  → used automatically (printed as confirmation).
//   - 2+ ports → interactive arrow-key selector shown to the user.
func resolvePort(explicit string, detect func() ([]string, error)) (string, error) {
	if explicit != "" {
		return explicit, nil
	}

	ui.Info("Scanning serial ports...")
	ports, err := detect()
	if err != nil {
		return "", fmt.Errorf(
			"port detection failed: %w\n  Hint: connect the board and retry, or pass --port <PORT>", err,
		)
	}

	switch len(ports) {
	case 0:
		return "", fmt.Errorf(
			"no board detected on any serial port\n  Hint: connect the board and retry, or pass --port <PORT>",
		)
	case 1:
		ui.Success(fmt.Sprintf("Found board on %s", ports[0]))
		return ports[0], nil
	default:
		ui.Warn(fmt.Sprintf(
			"%d serial devices found — select the one connected to your board.\n  Tip: you can skip this with --port <PORT>",
			len(ports),
		))
		return ui.SelectPort(ports)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
//  Port detectors  (return ALL matching ports, not just the first)
// ─────────────────────────────────────────────────────────────────────────────

// detectPortsTsukiFlash enumerates every port reported by `tsuki-flash detect`.
func detectPortsTsukiFlash(flashBin string) ([]string, error) {
	out, err := exec.Command(flashBin, "detect").Output()
	if err != nil {
		return nil, fmt.Errorf("tsuki-flash detect: %w", err)
	}
	return parsePortLines(string(out)), nil
}

// detectPortsArduinoCLI enumerates every port reported by `arduino-cli board list`.
func detectPortsArduinoCLI(arduinoCLI string) ([]string, error) {
	if arduinoCLI == "" {
		arduinoCLI = "arduino-cli"
	}
	out, err := exec.Command(arduinoCLI, "board", "list").Output()
	if err != nil {
		return nil, fmt.Errorf("arduino-cli board list: %w", err)
	}
	return parsePortLines(string(out)), nil
}

// parsePortLines collects every token that looks like a serial port path from
// the raw output of a detect command (one port per line, port is first field).
func parsePortLines(output string) []string {
	var ports []string
	seen := map[string]bool{}
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		p := fields[0]
		if isSerialPort(p) && !seen[p] {
			ports = append(ports, p)
			seen[p] = true
		}
	}
	return ports
}

// isSerialPort returns true for tokens that look like a serial port path.
func isSerialPort(s string) bool {
	return strings.HasPrefix(s, "/dev/tty") ||
		strings.HasPrefix(s, "/dev/cu.") ||
		strings.HasPrefix(strings.ToUpper(s), "COM")
}

func renderFlashError(output, port string) {
	lines := strings.Split(output, "\n")
	var relevant []string
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l != "" && (strings.Contains(l, "error") || strings.Contains(l, "Error") || strings.Contains(l, "not found")) {
			relevant = append(relevant, l)
		}
	}
	msg := strings.Join(relevant, "; ")
	if msg == "" {
		msg = strings.TrimSpace(output)
	}
	ui.Traceback("FlashError", msg, []ui.Frame{
		{
			File: port,
			Func: "upload",
			Line: 0,
			Code: []ui.CodeLine{{Number: 0, Text: msg, IsPointer: true}},
		},
	})
}