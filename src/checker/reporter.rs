// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: checker :: reporter
//  Rust-style diagnostic formatter (Paso 2b).
//
//  Produces output like:
//
//    error[T0001]: `x` declared and not used
//      --> src/main.go:5:4
//       |
//     5 |     x := 42
//       |     ^ `x` never used
//       |
//       = help: prefix with `_` to silence: `_x`
//
//    warning[T0003]: function `calcularMedia` defined but never called
//      --> src/main.go:12:6
//       |
//    12 | func calcularMedia(vals []float32) float32 {
//       |      ^^^^^^^^^^^^^ function never called
//
//    error: aborting due to 2 previous errors; 1 warning emitted
// ─────────────────────────────────────────────────────────────────────────────

use crate::error::TsukiError;

// ── Help text per error code ──────────────────────────────────────────────────

fn help_for_code(code: u16) -> Option<&'static str> {
    match code {
        1   => Some("prefix the name with `_` to silence this warning, e.g. `_x`"),
        2   => Some("remove the import or add a blank import: `import _ \"pkg\"`"),
        3   => Some("remove the function, or call it somewhere in your program"),
        4   => Some("remove the unreachable statements or restructure the control flow"),
        5   => Some("add a `return` statement on all branches"),
        6   => Some("check the spelling; make sure the variable is declared before use"),
        7   => Some("check the function signature and adjust the number of arguments"),
        8   => Some("convert the value to the correct type before assigning"),
        10  => Some("rename one of the declarations or move it to a different scope"),
        11  => Some("read the value somewhere, or remove the assignment if not needed"),
        100 => Some("the divisor is a literal 0 — this will cause a runtime crash"),
        101 => Some("add a `break`, `return`, or `delay(ms)` call inside the loop"),
        300 => Some("call `Serial.Begin(9600)` (or another baud rate) inside `setup()`"),
        302 => Some("use one of the listed PWM-capable pins for analog output"),
        _   => None,
    }
}

// ── Single diagnostic ─────────────────────────────────────────────────────────

/// Render a single `TsukiError` in Rust-style format using `source` for
/// the source-line excerpt.  Returns an empty string for non-diagnostic errors.
pub fn format_diagnostic(err: &TsukiError, source: &str) -> String {
    use std::fmt::Write;
    let mut out = String::new();

    let (kind_str, code_str, msg) = match err {
        TsukiError::Type { code, msg, .. } => {
            let kind = if err.is_warning() { "warning" } else { "error" };
            let code_label = format!("{}[T{:04}]", kind, code);
            (kind.to_owned(), code_label, msg.clone())
        }
        TsukiError::Lex { msg, .. }   => ("error".into(), "error[lex]".into(),   msg.clone()),
        TsukiError::Parse { msg, .. } => ("error".into(), "error[parse]".into(), msg.clone()),
        _ => return format!("{}\n", err),
    };

    let span = match err.span() {
        Some(s) => s,
        None    => {
            let _ = writeln!(out, "{}: {}", code_str, msg);
            return out;
        }
    };

    // ── Header ────────────────────────────────────────────────────────────────
    let _ = writeln!(out, "{}: {}", code_str, msg);

    if span.file.is_empty() && span.line == 0 {
        return out;
    }

    // ── File location ─────────────────────────────────────────────────────────
    let _ = writeln!(out, "  --> {}:{}:{}", span.file, span.line, span.col);
    let _ = writeln!(out, "   |");

    // ── Source line ───────────────────────────────────────────────────────────
    let line_num = span.line as usize;
    if let Some(line_text) = source.lines().nth(line_num.saturating_sub(1)) {
        let line_label = format!("{:>3}", line_num);
        let _ = writeln!(out, "{} | {}", line_label, line_text);

        // ── Underline ─────────────────────────────────────────────────────────
        let col_0 = span.col.saturating_sub(1) as usize; // 0-based
        let end_col = err.end_col().unwrap_or(col_0 + 1);
        let underline_len = end_col.saturating_sub(col_0).max(1);
        let caret = "^".repeat(underline_len);
        let padding = " ".repeat(col_0);
        let _ = writeln!(out, "   | {}{}", padding, caret);
    }

    let _ = writeln!(out, "   |");

    // ── Help ──────────────────────────────────────────────────────────────────
    if let TsukiError::Type { code, .. } = err {
        if let Some(help) = help_for_code(*code) {
            let _ = writeln!(out, "   = help: {}", help);
            let _ = writeln!(out, "   |");
        }
    }

    out
}

// ── Full report ───────────────────────────────────────────────────────────────

/// Format all diagnostics in `errors` using `source` for source-line context,
/// and append the Rust-style summary line.
///
/// Returns the complete formatted report as a `String`.
pub fn format_rust_style(errors: &[TsukiError], source: &str) -> String {
    let mut out = String::new();

    let mut error_count   = 0usize;
    let mut warning_count = 0usize;

    for err in errors {
        out.push_str(&format_diagnostic(err, source));
        out.push('\n');

        match err {
            TsukiError::Type { .. } => {
                if err.is_warning() { warning_count += 1; } else { error_count += 1; }
            }
            TsukiError::Lex { .. } | TsukiError::Parse { .. } => {
                error_count += 1;
            }
            _ => {}
        }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    if error_count > 0 || warning_count > 0 {
        out.push_str(&format_summary(error_count, warning_count));
    }

    out
}

/// Build the summary line that mirrors `rustc` output, e.g.:
///   `error: aborting due to 2 previous errors; 1 warning emitted`
pub fn format_summary(error_count: usize, warning_count: usize) -> String {
    match (error_count, warning_count) {
        (0, 0) => String::new(),

        (0, w) => {
            let w_str = pluralise(w, "warning");
            format!("warning: {} emitted\n", w_str)
        }

        (e, 0) => {
            let e_str = pluralise(e, "previous error");
            format!("error: aborting due to {}\n", e_str)
        }

        (e, w) => {
            let e_str = pluralise(e, "previous error");
            let w_str = pluralise(w, "warning");
            format!("error: aborting due to {}; {} emitted\n", e_str, w_str)
        }
    }
}

fn pluralise(n: usize, word: &str) -> String {
    if n == 1 {
        format!("1 {}", word)
    } else {
        format!("{} {}s", n, word)
    }
}

// ── JSON serialisable summary (for Tauri / LSP integration) ──────────────────

/// A single diagnostic ready to be serialised to JSON for the IDE / Tauri command.
#[derive(Debug, serde::Serialize)]
pub struct JsonDiagnostic {
    pub severity:      &'static str,
    pub message:       String,
    pub file:          String,
    pub line:          u32,
    pub col:           u32,
    pub code:          String,
    pub rust_formatted: String,
}

/// Convert a slice of `TsukiError` to `JsonDiagnostic` records ready for the
/// `run_checker` Tauri command response.
pub fn to_json_diagnostics(errors: &[TsukiError], source: &str) -> Vec<JsonDiagnostic> {
    errors.iter().filter_map(|err| {
        let (severity, code_str) = match err {
            TsukiError::Type { code, .. } => {
                let sev = if err.is_warning() { "warning" } else { "error" };
                (sev, format!("T{:04}", code))
            }
            TsukiError::Lex   { .. } => ("error", "lex".into()),
            TsukiError::Parse { .. } => ("error", "parse".into()),
            _ => return None,
        };

        let span = err.span()?;
        let rust_formatted = format_diagnostic(err, source);
        let message = match err {
            TsukiError::Type  { msg, .. }
            | TsukiError::Lex   { msg, .. }
            | TsukiError::Parse { msg, .. } => msg.clone(),
            _ => err.to_string(),
        };

        Some(JsonDiagnostic {
            severity,
            message,
            file:          span.file.clone(),
            line:          span.line,
            col:           span.col,
            code:          code_str,
            rust_formatted,
        })
    }).collect()
}