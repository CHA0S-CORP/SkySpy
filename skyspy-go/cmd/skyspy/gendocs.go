package main

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/spf13/cobra/doc"
)

var genDocsDir string

// genDocsCmd generates Markdown reference docs for the whole command tree.
// It is hidden from normal help output; it exists so `make docs` can emit
// docs/cli/*.md that the ReadMe sync job publishes. See skyspy-go/Makefile.
var genDocsCmd = &cobra.Command{
	Use:    "gen-docs",
	Short:  "Generate Markdown documentation for all commands",
	Hidden: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		if genDocsDir == "" {
			return fmt.Errorf("--dir is required")
		}
		// Strip auto-generated timestamps so regenerated docs are diff-stable.
		emptyHeader := func(string) string { return "" }
		linkHandler := func(name string) string { return name }
		if err := doc.GenMarkdownTreeCustom(rootCmd, genDocsDir, emptyHeader, linkHandler); err != nil {
			return fmt.Errorf("generate docs: %w", err)
		}
		fmt.Fprintf(cmd.OutOrStdout(), "Wrote CLI docs to %s\n", genDocsDir)
		return nil
	},
}

func init() {
	genDocsCmd.Flags().StringVar(&genDocsDir, "dir", "", "Output directory for generated Markdown")
}
