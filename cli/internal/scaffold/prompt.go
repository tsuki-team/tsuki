// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: scaffold/prompt  —  helper de terminal compartido
// ─────────────────────────────────────────────────────────────────────────────

package scaffold

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// newPrompter devuelve una función que lee una línea de stdin mostrando
// `label` y el valor por defecto `def`. Si el usuario pulsa Enter sin
// escribir nada se devuelve `def`.
func newPrompter() func(label, def string) string {
	r := bufio.NewReader(os.Stdin)
	return func(label, def string) string {
		if def != "" {
			fmt.Printf("  %s [%s]: ", label, def)
		} else {
			fmt.Printf("  %s: ", label)
		}
		line, _ := r.ReadString('\n')
		line = strings.TrimSpace(line)
		if line == "" {
			return def
		}
		return line
	}
}