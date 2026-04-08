# Agent Guide: Transpiler Work (lexer / parser / checker / codegen)

Use this guide when your task involves any of:
- `src/lexer/` — tokenization
- `src/parser/` — AST construction
- `src/checker/` — semantic analysis
- `src/transpiler/` — C++ code generation
- `src/runtime/` — built-in / package mappings
- `src/python/` — Python sub-pipeline

---

## Mental model

The pipeline is strictly linear:

```
source text
  → Lexer (tokens)
  → Parser (AST nodes in src/parser/ast.rs)
  → Checker (TsukiError diagnostics, multi-pass — see references/checker-v2.md)
  → Transpiler + Runtime (C++ string)
```

Never skip passes. Never mutate the AST in the checker. Never read source text in the transpiler.

---

## How to add a new Go language construct

1. **Add the AST node** in `src/parser/ast.rs`.  
   - Every node must carry a `Span { file, line, col }`.
   - Keep the node data minimal — only what the transpiler needs.

2. **Parse it** in `src/parser/mod.rs`.  
   - Use the existing `peek()` / `expect()` / `consume_if()` pattern.
   - Emit `TsukiError::Parse` with the correct span on failure.

3. **Emit C++** in `src/transpiler/mod.rs`.  
   - Add a branch in the relevant `emit_stmt()` or `emit_expr()` match arm.
   - Keep output deterministic (no randomness, no timestamps).

4. **Update the checker** in `src/checker/mod.rs` (and relevant pass files).  
   - Read `references/checker-v2.md` before touching checker code.
   - New checks get new T-codes registered in `src/error.rs`.

5. **Add a runtime mapping** in `src/runtime/mod.rs` if the construct maps to an Arduino API call.

6. **Write a test** in `src/tests/` (or inline `#[test]` in the relevant module).  
   - Test: parse → no checker errors → expected C++ substring in output.

---

## Common patterns

### Register a built-in function mapping

```rust
// In Runtime::new() inside src/runtime/mod.rs:
runtime.register_fn("arduino", "DigitalWrite", "{0}.digitalWrite({1}, {2})");
// Args: package name, Go function name, C++ template
// Template tokens: {0}=first arg, {1}=second, {self}=receiver, {args}=all joined
```

### Emit a new statement type

```rust
// In src/transpiler/mod.rs, inside emit_stmt():
Stmt::MyNew(inner) => {
    write!(self.out, "/* my_new */ ")?;
    self.emit_expr(&inner.expr)?;
    writeln!(self.out, ";")?;
}
```

### Add a TsukiError variant

```rust
// In src/error.rs:
#[error("T0099: my new error at {span}")]
MyNewError { span: Span, detail: String },
```

Always include the T-code in the Display string. Never use a span with empty file/line/col.

---

## Checker v2 quick orientation

The checker is structured as 5 passes (Pass 0–4). Read `references/checker-v2.md` for the full spec. Quick orientation:

| Pass | File | Purpose |
|------|------|---------|
| Pass 0 | `src/checker/hoist.rs` | Pre-scan: collect top-level decls (HoistedSymbols) |
| Pass 1 | `src/checker/scope.rs`, `infer.rs` | Symbol resolution + TypeMap |
| Pass 2 | `src/checker/cfg.rs` | Control-flow graph per function |
| Pass 3 | `src/checker/dataflow.rs` | Live-variable + def-use analysis |
| Pass 4 | `src/checker/domain.rs` | Arduino domain checks |
| Cache | `src/checker/cache.rs` | Incremental re-check for IDE hybrid mode |

**Never emit a diagnostic in Pass 0 — it's a read-only pre-scan.**

---

## Error codes in use

See `references/error-codes.md` for the full table. New codes must:
1. Be added to `src/error.rs`
2. Be added to `references/error-codes.md`
3. Use the next available number in the appropriate range (T0001–T0099 general, T0100–T0199 CFG, T0200–T0299 type, T0300–T0399 Arduino domain, T0400–T0499 AVR memory)

---

## Build & test

```bash
# From repo root:
cargo build
cargo test
cargo clippy -- -D warnings

# Test a specific file:
cargo test --test transpiler_tests
```

Treat clippy warnings as errors before committing.