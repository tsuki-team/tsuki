// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: transpiler :: config
// ─────────────────────────────────────────────────────────────────────────────

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranspileConfig {
    /// Target board id (from Board::catalog()).
    pub board: String,

    /// C++ standard: "c++11" | "c++14" | "c++17" (default c++11 for AVR).
    pub cpp_std: String,

    /// Use Arduino `String` class for Go `string` (true) or `const char*` (false).
    pub arduino_string: bool,

    /// Annotate unsupported Go features (goroutines, defer, channels) with
    /// `/* ... */` comments instead of silently skipping them.
    pub annotate_unsupported: bool,

    /// Emit `#line N "file"` pragmas for IDE source-map support.
    pub emit_source_map: bool,

    /// Pass through unknown package calls as raw C++ instead of erroring.
    pub passthrough_unknown: bool,
}

impl Default for TranspileConfig {
    fn default() -> Self {
        Self {
            board:                "uno".into(),
            cpp_std:              "c++11".into(),
            arduino_string:       true,
            annotate_unsupported: true,
            emit_source_map:      false,
            passthrough_unknown:  true,
        }
    }
}