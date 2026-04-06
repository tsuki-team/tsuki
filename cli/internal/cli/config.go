package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/config"
	"github.com/tsuki/cli/internal/ui"
)

func newConfigCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Get or set CLI configuration",
		Long: `Manage tsuki CLI configuration.

The config file is stored at ~/.config/tsuki/config.json.

Settings are organized into sections:
  core      — binaries, backend, default board and baud
  output    — color, verbosity, auto-detection
  packages  — package dirs, registry URLs, signing keys

Use 'tsuki config set <key> <value>' to set a value.
  Simple keys:   tsuki config set verbose true
  Package keys:  tsuki config set packages.libs_dir /my/libs

Use 'tsuki config get <key>' to read a specific key.
Use 'tsuki config show' to display all settings grouped by section.
Use 'tsuki config show --section packages' to show one section only.`,
	}

	cmd.AddCommand(
		newConfigSetCmd(),
		newConfigGetCmd(),
		newConfigShowCmd(),
		newConfigPathCmd(),
		newConfigRegistryCmd(),
	)
	return cmd
}

// ── config set ────────────────────────────────────────────────────────────────

func newConfigSetCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "set <key> <value>",
		Short: "Set a configuration key",
		Long: `Set a configuration key.

For top-level keys use the plain key name.
For package settings, prefix with "packages.":

  tsuki config set default_board esp32
  tsuki config set packages.libs_dir /home/user/tsuki-libs
  tsuki config set packages.verify_signatures true
  tsuki config set packages.registry_urls https://example.com/registry.json`,
		Example: `  tsuki config set default_board esp32
  tsuki config set arduino_cli /usr/local/bin/arduino-cli
  tsuki config set verbose true
  tsuki config set default_baud 115200
  tsuki config set packages.libs_dir /my/libs
  tsuki config set packages.boards_dir /my/boards
  tsuki config set packages.verify_signatures true`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			key, value := args[0], args[1]

			c, err := config.Load()
			if err != nil {
				return err
			}

			if err := c.Set(key, value); err != nil {
				ui.Fail(err.Error())
				fmt.Fprintln(os.Stderr, "")
				ui.Info("Available keys:")
				sections := c.AllEntriesBySection()
				for _, sec := range []string{"core", "output", "packages"} {
					if entries, ok := sections[sec]; ok {
						ui.ColorMuted.Printf("\n  [%s]\n", sec)
						for _, e := range entries {
							ui.Step("  "+e.Key, e.Comment)
						}
					}
				}
				return fmt.Errorf("unknown key")
			}

			if err := c.Save(); err != nil {
				return fmt.Errorf("saving config: %w", err)
			}

			ui.Success(fmt.Sprintf("Set %s = %s", key, value))
			ui.PrintConfig("tsuki config", []ui.ConfigEntry{
				{Key: key, Value: value},
			}, false)

			return nil
		},
	}
	return cmd
}

// ── config get ────────────────────────────────────────────────────────────────

func newConfigGetCmd() *cobra.Command {
	var rawFlag bool

	cmd := &cobra.Command{
		Use:   "get <key>",
		Short: "Get a configuration key",
		Example: `  tsuki config get default_board
  tsuki config get packages.libs_dir
  tsuki config get packages.registry_urls --raw`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			key := args[0]

			c, err := config.Load()
			if err != nil {
				return err
			}

			val, err := c.Get(key)
			if err != nil {
				return err
			}

			if rawFlag {
				fmt.Println(val)
				return nil
			}

			comment := ""
			for _, e := range c.AllEntries() {
				if e.Key == key {
					comment = e.Comment
					break
				}
			}

			ui.PrintConfig("tsuki config", []ui.ConfigEntry{
				{Key: key, Value: val, Comment: comment},
			}, false)

			return nil
		},
	}

	cmd.Flags().BoolVar(&rawFlag, "raw", false, "print raw value only (no styling)")
	return cmd
}

// ── config show ───────────────────────────────────────────────────────────────

func newConfigShowCmd() *cobra.Command {
	var (
		rawFlag     bool
		sectionFlag string
	)

	cmd := &cobra.Command{
		Use:     "show",
		Short:   "Show all configuration values, grouped by section",
		Aliases: []string{"list", "ls"},
		Example: `  tsuki config show
  tsuki config show --section packages
  tsuki config show --raw`,
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := config.Load()
			if err != nil {
				return err
			}

			sections := c.AllEntriesBySection()

			// Section display order
			order := []string{"core", "output", "packages"}

			if rawFlag {
				// Raw: flat key=value output
				for _, sec := range order {
					if sectionFlag != "" && sec != sectionFlag {
						continue
					}
					entries := sections[sec]
					for _, e := range entries {
						fmt.Printf("%s=%v\n", e.Key, e.Value)
					}
				}
				return nil
			}

			for _, sec := range order {
				if sectionFlag != "" && sec != sectionFlag {
					continue
				}
				entries, ok := sections[sec]
				if !ok {
					continue
				}

				uiEntries := make([]ui.ConfigEntry, len(entries))
				for i, e := range entries {
					uiEntries[i] = ui.ConfigEntry{
						Key:     e.Key,
						Value:   e.Value,
						Comment: e.Comment,
					}
				}
				ui.PrintConfig(fmt.Sprintf("tsuki config  [%s]", sec), uiEntries, false)
				fmt.Println()
			}
			return nil
		},
	}

	cmd.Flags().BoolVar(&rawFlag, "raw", false, "print raw key=value pairs")
	cmd.Flags().StringVar(&sectionFlag, "section", "", "show only one section (core, output, packages)")
	return cmd
}

// ── config path ───────────────────────────────────────────────────────────────

func newConfigPathCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "path",
		Short: "Print the path to the config file",
		RunE: func(cmd *cobra.Command, args []string) error {
			p, err := config.Path()
			if err != nil {
				return err
			}
			ui.Info(fmt.Sprintf("Config file: %s", p))
			if _, err := os.Stat(p); os.IsNotExist(err) {
				ui.Warn("File does not exist yet — it will be created on first `tsuki config set`")
			}
			return nil
		},
	}
}

// ── config registry ───────────────────────────────────────────────────────────
//
// Manages the ordered list of package registry URLs (packages.registry_urls).
// First entry has highest priority — on name collision, the first registry wins.

func newConfigRegistryCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "registry",
		Short: "Manage package registry URLs",
		Long: `Manage the ordered list of package registry URLs.

Registries are consulted in priority order — the first one wins on package
name collisions. The built-in default registry is always the last fallback.

These settings live under the "packages" section of tsuki config.

Priority chain (highest → lowest):
  1. tsuki_REGISTRY env var  (single URL, highest — overrides everything)
  2. packages.registry_urls  (managed by this command)
  3. Built-in default        (https://raw.githubusercontent.com/s7lver2/tsuki/…/packages.json)`,
		Example: `  tsuki config registry list
  tsuki config registry add https://raw.githubusercontent.com/you/tsuki/refs/heads/v6.0/pkg/packages.json
  tsuki config registry remove <url>
  tsuki config registry up   <url>
  tsuki config registry down <url>
  tsuki config registry clear`,
	}

	cmd.AddCommand(
		newRegistryListCmd(),
		newRegistryAddCmd(),
		newRegistryRemoveCmd(),
		newRegistryUpCmd(),
		newRegistryDownCmd(),
		newRegistryClearCmd(),
	)
	return cmd
}

func newRegistryListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "list",
		Aliases: []string{"ls"},
		Short:   "List configured registries in priority order",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := config.Load()
			if err != nil {
				return err
			}
			effective := c.ResolvedRegistryURLs()
			if len(effective) == 0 {
				ui.Info("No registries configured — built-in default will be used")
				return nil
			}
			ui.SectionTitle(fmt.Sprintf("Registries (%d, priority order)", len(effective)))
			fmt.Println()
			for i, u := range effective {
				label := ""
				if i == 0 {
					label = "  ← highest priority"
				}
				if i == len(effective)-1 {
					label = "  ← fallback"
				}
				ui.ColorKey.Printf("  %d. ", i+1)
				fmt.Printf("%s", u)
				ui.ColorMuted.Printf("%s\n", label)
			}
			fmt.Println()
			ui.Info("First registry wins on package name collision.")
			ui.Info("Boards and library packages share the same registry.")
			return nil
		},
	}
}

func newRegistryAddCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "add <url>",
		Short: "Add a registry URL (prepended = highest priority by default)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			url := args[0]
			c, err := config.Load()
			if err != nil {
				return err
			}
			added := c.AddRegistry(url)
			if !added {
				ui.Warn(fmt.Sprintf("Registry already in list: %s", url))
				return nil
			}
			if err := c.Save(); err != nil {
				return fmt.Errorf("saving config: %w", err)
			}
			ui.Success(fmt.Sprintf("Registry added (priority 1): %s", url))
			printRegistryList(c)
			return nil
		},
	}
	return cmd
}

func newRegistryRemoveCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "remove <url>",
		Aliases: []string{"rm", "del"},
		Short:   "Remove a registry URL from the list",
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			url := args[0]
			c, err := config.Load()
			if err != nil {
				return err
			}
			removed := c.RemoveRegistry(url)
			if !removed {
				ui.Warn(fmt.Sprintf("Registry not found in list: %s", url))
				ui.Info("Run `tsuki config registry list` to see current registries")
				return nil
			}
			if err := c.Save(); err != nil {
				return fmt.Errorf("saving config: %w", err)
			}
			ui.Success(fmt.Sprintf("Registry removed: %s", url))
			printRegistryList(c)
			return nil
		},
	}
}

func newRegistryUpCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "up <url>",
		Short: "Raise the priority of a registry",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return moveRegistry(args[0], -1)
		},
	}
}

func newRegistryDownCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "down <url>",
		Short: "Lower the priority of a registry",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return moveRegistry(args[0], +1)
		},
	}
}

func moveRegistry(url string, direction int) error {
	c, err := config.Load()
	if err != nil {
		return err
	}
	moved := c.MoveRegistry(url, direction)
	if !moved {
		if direction < 0 {
			ui.Warn("Registry not found or already at highest priority")
		} else {
			ui.Warn("Registry not found or already at lowest priority")
		}
		return nil
	}
	if err := c.Save(); err != nil {
		return fmt.Errorf("saving config: %w", err)
	}
	ui.Success("Registry priority updated")
	printRegistryList(c)
	return nil
}

func newRegistryClearCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "clear",
		Short: "Remove all custom registries (revert to built-in default only)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !yes {
				fmt.Print("  Remove all custom registries? [y/N] ")
				var input string
				fmt.Scanln(&input)
				if input != "y" && input != "Y" && input != "yes" {
					fmt.Println("  Cancelled.")
					return nil
				}
			}
			c, err := config.Load()
			if err != nil {
				return err
			}
			c.Packages.RegistryURLs = []string{}
			c.Packages.RegistryURL = ""
			if err := c.Save(); err != nil {
				return fmt.Errorf("saving config: %w", err)
			}
			ui.Success("Custom registries cleared — built-in default will be used")
			return nil
		},
	}
	cmd.Flags().BoolVarP(&yes, "yes", "y", false, "skip confirmation")
	return cmd
}

func printRegistryList(c *config.Config) {
	effective := c.ResolvedRegistryURLs()
	fmt.Println()
	ui.ColorMuted.Println("  Current registry order (highest → lowest priority):")
	for i, u := range effective {
		ui.ColorKey.Printf("    %d. ", i+1)
		fmt.Println(u)
	}
	fmt.Println()
}
