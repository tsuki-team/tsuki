package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/manifest"
	"github.com/tsuki/cli/internal/pkgmgr"
	"github.com/tsuki/cli/internal/ui"
)

// ── Built-in board catalog ────────────────────────────────────────────────────
//
// Only the Arduino Uno is built into tsuki.
// All other boards are distributed as board packages.
// Install them with: tsuki boards install <id>

type boardInfo struct {
	ID      string
	Name    string
	FlashKB int
	RAMKB   int
	FQBN    string
	Builtin bool
}

var builtinBoards = []boardInfo{
	{"uno", "Arduino Uno", 32, 2, "arduino:avr:uno", true},
}

// ── boards command ────────────────────────────────────────────────────────────

func newBoardsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "boards",
		Short: "Manage boards and board packages",
		Long: `List, detect, install, and remove boards.

The Arduino Uno is the only board built into tsuki.
All other boards (Nano, Mega, ESP32, etc.) are board packages.

Board packages are tsuki_board.toml files stored in the boards directory.
They use the same registry as library packages.`,
	}

	cmd.AddCommand(
		newBoardsListCmd(),
		newBoardsDetectCmd(),
		newBoardsInstallCmd(),
		newBoardsRemoveCmd(),
		newBoardsSearchCmd(),
		newBoardsInfoCmd(),
	)
	return cmd
}

// ── boards list ───────────────────────────────────────────────────────────────

func newBoardsListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List built-in and installed board packages",
		RunE: func(cmd *cobra.Command, args []string) error {
			ui.SectionTitle("Boards")
			fmt.Println()

			header := fmt.Sprintf("  %-14s  %-34s  %7s  %6s  %-28s  %s", "ID", "NAME", "FLASH", "RAM", "FQBN", "SOURCE")
			ui.ColorTitle.Println(header)
			ui.ColorMuted.Println("  " + hline(110, "─"))

			// 1. Built-in boards
			for _, b := range builtinBoards {
				ui.ColorKey.Printf("  %-14s", b.ID)
				fmt.Printf("  %-34s", b.Name)
				ui.ColorNumber.Printf("  %5dK", b.FlashKB)
				ui.ColorNumber.Printf("  %4dK", b.RAMKB)
				fmt.Printf("  %-28s", b.FQBN)
				ui.ColorMuted.Printf("  built-in\n")
			}

			// 2. Installed board packages
			installed, err := pkgmgr.ListInstalledBoards()
			if err != nil {
				ui.Warn(fmt.Sprintf("Could not read boards dir: %v", err))
			}
			for _, b := range installed {
				desc := b.Description
				// Truncate description used as name stand-in
				name := b.ID
				// Try to get proper name from description
				if parts := strings.SplitN(b.Description, " — ", 2); len(parts) > 0 {
					name = parts[0]
				}
				if len(name) > 34 {
					name = name[:31] + "..."
				}
				_ = desc
				ui.ColorKey.Printf("  %-14s", b.ID)
				fmt.Printf("  %-34s", name)
				ui.ColorNumber.Printf("  %5s", "—")
				ui.ColorNumber.Printf("  %4s", "—")
				fmt.Printf("  %-28s", b.FQBN)
				ui.ColorMuted.Printf("  pkg@%s\n", b.Version)
			}

			fmt.Println()
			ui.Info("Install a board package: tsuki boards install <id>")
			ui.Info(fmt.Sprintf("Board packages dir: %s", pkgmgr.BoardsDir()))
			return nil
		},
	}
}

// ── boards detect ─────────────────────────────────────────────────────────────

func newBoardsDetectCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "detect",
		Short: "Detect boards connected via USB",
		Run: func(cmd *cobra.Command, args []string) {
			ui.SectionTitle("Detecting connected boards")
			sp := ui.NewSpinner("Scanning serial ports…")
			sp.Start()
			sp.Stop(false, "Use `arduino-cli board list` to detect boards")
			ui.Info("Run: arduino-cli board list")
		},
	}
}

// ── boards install ────────────────────────────────────────────────────────────

func newBoardsInstallCmd() *cobra.Command {
	var version string

	cmd := &cobra.Command{
		Use:   "install <board-id>",
		Short: "Install a board package",
		Long: `Download and install a board package from the registry or a local path.

<source> can be:
  - A board ID from the registry: nano, esp32, mega…
  - A local file path: ./my-board/tsuki_board.toml
  - An HTTPS URL: https://example.com/my-board/tsuki_board.toml

Board packages teach tsuki-flash how to compile and flash for that board.`,
		Example: `  tsuki boards install nano
  tsuki boards install esp32
  tsuki boards install ./custom-board/tsuki_board.toml`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			source := args[0]

			sp := ui.NewSpinner(fmt.Sprintf("Installing board package %s…", source))
			sp.Start()

			var board *pkgmgr.InstalledBoard
			var err error

			if !strings.Contains(source, "/") && !strings.HasPrefix(source, ".") &&
				!strings.HasPrefix(source, "http://") && !strings.HasPrefix(source, "https://") {
				board, err = pkgmgr.InstallBoardFromRegistry(source, version)
			} else {
				board, err = pkgmgr.InstallBoard(pkgmgr.InstallOptions{
					Source:  source,
					Version: version,
				})
			}

			if err != nil {
				sp.Stop(false, "installation failed")
				return err
			}

			sp.Stop(true, fmt.Sprintf("Installed board package %s@%s", board.ID, board.Version))
			fmt.Println()

			ui.PrintConfig("Board package installed", []ui.ConfigEntry{
				{Key: "id",          Value: board.ID},
				{Key: "version",     Value: board.Version},
				{Key: "description", Value: board.Description},
				{Key: "fqbn",        Value: board.FQBN},
				{Key: "path",        Value: board.Path},
			}, false)

			fmt.Println()
			ui.Info(fmt.Sprintf("Use this board with: tsuki build --board %s", board.ID))
			ui.Info(fmt.Sprintf("Or set as default: tsuki config set default_board %s", board.ID))
			return nil
		},
	}

	cmd.Flags().StringVar(&version, "version", "", "override version from tsuki_board.toml")
	return cmd
}

// ── boards remove ─────────────────────────────────────────────────────────────

func newBoardsRemoveCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "remove <board-id>",
		Aliases: []string{"rm", "uninstall"},
		Short:   "Remove an installed board package",
		Example: `  tsuki boards remove esp32
  tsuki boards remove nano`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id := args[0]

			// Refuse to remove built-in boards
			for _, b := range builtinBoards {
				if b.ID == id {
					return fmt.Errorf("board %q is built into tsuki and cannot be removed", id)
				}
			}

			installed, err := pkgmgr.ListInstalledBoards()
			if err != nil {
				return err
			}
			var found *pkgmgr.InstalledBoard
			for i := range installed {
				if installed[i].ID == id {
					found = &installed[i]
					break
				}
			}
			if found == nil {
				return fmt.Errorf("board package %q is not installed", id)
			}

			sp := ui.NewSpinner(fmt.Sprintf("Removing board %s@%s…", found.ID, found.Version))
			sp.Start()
			if err := pkgmgr.RemoveBoard(found.ID, found.Version); err != nil {
				sp.Stop(false, "removal failed")
				return err
			}
			sp.Stop(true, fmt.Sprintf("Removed board package %s@%s", found.ID, found.Version))
			return nil
		},
	}
	return cmd
}

// ── boards search ─────────────────────────────────────────────────────────────

func newBoardsSearchCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "search [query]",
		Short: "Search the registry for available board packages",
		Example: `  tsuki boards search
  tsuki boards search esp
  tsuki boards search nano`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			query := ""
			if len(args) > 0 {
				query = args[0]
			}

			sp := ui.NewSpinner("Searching registry for boards…")
			sp.Start()
			entries, err := pkgmgr.SearchBoardRegistry(query)
			sp.Stop(err == nil, "done")
			if err != nil {
				return err
			}

			ui.SectionTitle("Available board packages")
			fmt.Println()

			if len(entries) == 0 {
				ui.Info("No board packages found matching your query")
				return nil
			}

			ui.ColorTitle.Printf("  %-16s  %-10s  %s\n", "ID", "VERSION", "DESCRIPTION")
			ui.ColorMuted.Println("  " + hline(80, "─"))
			for _, e := range entries {
				ui.ColorKey.Printf("  %-16s", e.Name)
				ui.ColorNumber.Printf("  %-10s", e.Version)
				fmt.Printf("  %s\n", e.Description)
			}
			fmt.Println()
			ui.Info("Install with: tsuki boards install <id>")
			return nil
		},
	}
}

// ── boards info ───────────────────────────────────────────────────────────────

func newBoardsInfoCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "info <board-id>",
		Short: "Show details about an installed board package",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id := args[0]

			// Check built-in first
			for _, b := range builtinBoards {
				if b.ID == id {
					ui.PrintConfig(fmt.Sprintf("Board: %s (built-in)", b.ID), []ui.ConfigEntry{
						{Key: "id",       Value: b.ID},
						{Key: "name",     Value: b.Name},
						{Key: "flash_kb", Value: fmt.Sprintf("%dK", b.FlashKB)},
						{Key: "ram_kb",   Value: fmt.Sprintf("%dK", b.RAMKB)},
						{Key: "fqbn",     Value: b.FQBN},
						{Key: "source",   Value: "built-in"},
					}, false)
					return nil
				}
			}

			boards, err := pkgmgr.ListInstalledBoards()
			if err != nil {
				return err
			}
			for _, b := range boards {
				if b.ID == id {
					ui.PrintConfig(fmt.Sprintf("Board package: %s", b.ID), []ui.ConfigEntry{
						{Key: "id",          Value: b.ID},
						{Key: "version",     Value: b.Version},
						{Key: "description", Value: b.Description},
						{Key: "fqbn",        Value: b.FQBN},
						{Key: "path",        Value: b.Path},
					}, false)
					return nil
				}
			}
			return fmt.Errorf("board %q is not installed (run `tsuki boards install %s`)", id, id)
		},
	}
}

// ── clean ─────────────────────────────────────────────────────────────────────

func newCleanCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "clean",
		Short: "Remove the build/ directory",
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := projectDir()
			_, m, err := manifest.Find(dir)
			if err != nil {
				return err
			}

			buildDir := filepath.Join(dir, m.Build.OutputDir)
			if _, err := os.Stat(buildDir); os.IsNotExist(err) {
				ui.Info(fmt.Sprintf("%s does not exist — nothing to clean", m.Build.OutputDir))
				return nil
			}

			sp := ui.NewSpinner(fmt.Sprintf("Removing %s…", buildDir))
			sp.Start()
			if err := os.RemoveAll(buildDir); err != nil {
				sp.Stop(false, "failed to remove build directory")
				return err
			}
			sp.Stop(true, fmt.Sprintf("Removed %s", buildDir))
			return nil
		},
	}
}

// ── version ───────────────────────────────────────────────────────────────────

const Version = "0.1.0"

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print version information",
		Run: func(cmd *cobra.Command, args []string) {
			ui.PrintConfig("tsuki version", []ui.ConfigEntry{
				{Key: "cli",  Value: Version,         Comment: "tsuki CLI"},
				{Key: "core", Value: "(not detected)", Comment: "tsuki-core (Rust transpiler)"},
			}, false)
		},
	}
}

func hline(n int, ch string) string {
	s := ""
	for i := 0; i < n; i++ {
		s += ch
	}
	return s
}
