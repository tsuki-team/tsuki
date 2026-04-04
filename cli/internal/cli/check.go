package cli

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/check"
	"github.com/tsuki/cli/internal/manifest"
)

func newCheckCmd() *cobra.Command {
	var board string

	cmd := &cobra.Command{
		Use:   "check",
		Short: "Validate source files for errors and warnings (no output produced)",
		Example: `  tsuki check
  tsuki check --board esp32`,
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
			})
			if err != nil {
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
	return cmd
}
