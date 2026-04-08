// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: cli :: check  —  Cobra command for `tsuki check`
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/check"
	"github.com/tsuki/cli/internal/manifest"
)

func newCheckCmd() *cobra.Command {
	var board string
	var mode  string

	cmd := &cobra.Command{
		Use:   "check",
		Short: "Validate source files for errors and warnings (no output produced)",
		Example: `  tsuki check
  tsuki check --board esp32
  tsuki check --mode dev
  tsuki check --mode none`,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := projectDir()
			_, m, err := manifest.Find(dir)
			if err != nil {
				return err
			}

			report, err := check.Run(dir, m, check.Options{
				Board:   board,
				Verbose: cfg.Verbose,
				CoreBin: cfg.CoreBinary,
				Mode:    mode,
			})
			if err != nil {
				// Exit code 2 when tsuki-core is not available.
				if check.IsCoreMissing(err) {
					fmt.Fprintln(os.Stderr, err.Error())
					os.Exit(2)
				}
				return err
			}

			check.PrintReport(report)

			if len(report.Errors) > 0 {
				return fmt.Errorf("%d error(s) found", len(report.Errors))
			}
			return nil
		},
	}

	cmd.Flags().StringVarP(&board, "board", "b", "", "target board (overrides manifest)")
	cmd.Flags().StringVar(&mode, "mode", "strict",
		`checker level: strict (default), dev, or none`)
	return cmd
}
