// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: checker
//  Semantic analysis pass: runs after Parse, before Transpile.
//
//  Errors always reference the Go/Python source file, never the generated C++.
//
//  Three accumulative levels:
//    none   — no checks
//    dev    — undefined vars, call arity, obvious type mismatches
//    strict — all of the above + unused vars/imports/funcs, return paths,
//             unreachable code, write-only vars, div-by-zero, infinite loops,
//             Serial domain checks
//
//  Per-file annotations (scanned in first 20 non-blank comment lines):
//    // #[tsuki(strict_mode, strict)]   ← default when annotation is absent
//    // #[tsuki(strict_mode, dev)]
//    // #[tsuki(strict_mode, none)]
//    // #[tsuki(checker, none)]         ← disables the checker for this file
//
//  Error codes:
//    T0001  unused variable                    (warning)
//    T0002  unused import                      (warning)
//    T0003  unused function                    (warning)
//    T0004  unreachable code                   (warning)
//    T0005  not all paths return a value       (error)
//    T0006  undefined identifier               (error)
//    T0007  wrong number of arguments          (error)
//    T0008  type mismatch                      (error)
//    T0010  duplicate declaration              (error)
//    T0011  variable assigned but never read   (warning)
//    T0100  division by zero                   (error)
//    T0101  infinite loop without escape       (warning)
//    T0300  Serial output without Serial.Begin (warning)
//    T0302  AnalogWrite on non-PWM pin         (warning)
// ─────────────────────────────────────────────────────────────────────────────

pub mod scope;
pub mod infer;
pub mod reporter;

use std::collections::{HashMap, HashSet};
use crate::error::{Span, TsukiError};
use crate::parser::ast::{
    AssignOp, BinOp, Block, Decl, Expr, FuncParam, FuncSig, Program, Stmt,
};
use scope::{ScopeStack, Symbol};
use infer::{infer_expr, type_annotation_to_go_string, type_to_go_string};

// ── StrictMode ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum StrictMode {
    None,
    Dev,
    Strict,
}

/// Scan the first 20 non-blank lines of `source` for a strict-mode annotation.
/// Returns `StrictMode::Strict` (the safest default) if none is found.
///
/// Recognised forms:
///   // #[tsuki(strict_mode, strict|dev|none)]
///   // #[tsuki(checker, none)]   ← completely disables the checker for this file
pub fn parse_strict_annotation(source: &str) -> StrictMode {
    let mut scanned = 0;
    for line in source.lines() {
        let t = line.trim();
        if t.is_empty() { continue; }
        scanned += 1;
        if scanned > 20 { break; }
        if !t.starts_with("//") { continue; }
        let inner = t.trim_start_matches('/').trim();

        // #[tsuki(checker, none)] — fully disable the checker for this file
        if inner.starts_with("#[tsuki(checker,") {
            let rest = inner.trim_start_matches("#[tsuki(checker,").trim();
            let arg  = rest.trim_end_matches(")]").trim();
            if arg == "none" { return StrictMode::None; }
            continue;
        }

        // #[tsuki(strict_mode, ...)]
        if !inner.starts_with("#[tsuki(strict_mode,") { continue; }
        let rest = inner.trim_start_matches("#[tsuki(strict_mode,").trim();
        let arg  = rest.trim_end_matches(")]").trim();
        return match arg {
            "none" => StrictMode::None,
            "dev"  => StrictMode::Dev,
            _      => StrictMode::Strict,
        };
    }
    StrictMode::Strict
}

// ── PWM-capable pins per board ────────────────────────────────────────────────

/// Returns the set of pin numbers that support PWM for a given board name.
/// Unknown boards fall back to the Uno set (conservative).
fn pwm_pins_for_board(board: &str) -> HashSet<u8> {
    match board {
        "mega" | "mega2560" => {
            vec![2,3,4,5,6,7,8,9,10,11,12,13,44,45,46]
                .into_iter().collect()
        }
        "nano" => vec![3,5,6,9,10,11].into_iter().collect(),
        "micro" => vec![3,5,6,9,10,11,13].into_iter().collect(),
        "esp32" => (0u8..=33).collect(),
        _ => vec![3,5,6,9,10,11].into_iter().collect(), // uno default
    }
}

// ── Free helpers (no Checker state needed) ────────────────────────────────────

/// Returns `true` if every execution path through `stmts` ends in a
/// `return`, ensuring no fall-through.  Used for T0005.
fn always_returns(stmts: &[Stmt]) -> bool {
    for stmt in stmts.iter().rev() {
        match stmt {
            Stmt::Return { .. } => return true,

            Stmt::If { then, else_: Some(else_stmt), .. } => {
                let else_returns = match else_stmt.as_ref() {
                    Stmt::Block(b) => always_returns(&b.stmts),
                    s              => always_returns(std::slice::from_ref(s)),
                };
                if always_returns(&then.stmts) && else_returns {
                    return true;
                }
            }

            Stmt::Switch { cases, .. } => {
                let has_default = cases.iter().any(|c| c.exprs.is_empty());
                if has_default && cases.iter().all(|c| always_returns(&c.body)) {
                    return true;
                }
            }

            Stmt::Block(b) => {
                if always_returns(&b.stmts) { return true; }
            }

            _ => {}
        }
    }
    false
}

/// Returns the index of the first terminating statement (`return`, `break`,
/// `continue`) in `stmts`, or `None` if there is no terminator.
/// Used to detect unreachable code (T0004).
fn first_terminator_idx(stmts: &[Stmt]) -> Option<usize> {
    for (i, stmt) in stmts.iter().enumerate() {
        match stmt {
            Stmt::Return { .. } | Stmt::Break { .. } | Stmt::Continue { .. } => {
                return Some(i);
            }
            Stmt::Expr { expr: Expr::Call { func, .. }, .. } => {
                if let Expr::Ident { name, .. } = func.as_ref() {
                    if matches!(name.as_str(), "panic" | "os.Exit") {
                        return Some(i);
                    }
                }
            }
            _ => {}
        }
    }
    None
}

/// Returns the `Span` of a statement, if available.
fn span_of_stmt(stmt: &Stmt) -> Option<Span> {
    Some(match stmt {
        Stmt::VarDecl   { span, .. } => span.clone(),
        Stmt::ConstDecl { span, .. } => span.clone(),
        Stmt::ShortDecl { span, .. } => span.clone(),
        Stmt::Assign    { span, .. } => span.clone(),
        Stmt::Inc       { span, .. } => span.clone(),
        Stmt::Dec       { span, .. } => span.clone(),
        Stmt::Return    { span, .. } => span.clone(),
        Stmt::Break     { span, .. } => span.clone(),
        Stmt::Continue  { span, .. } => span.clone(),
        Stmt::Goto      { span, .. } => span.clone(),
        Stmt::Label     { span, .. } => span.clone(),
        Stmt::If        { span, .. } => span.clone(),
        Stmt::For       { span, .. } => span.clone(),
        Stmt::Range     { span, .. } => span.clone(),
        Stmt::Switch    { span, .. } => span.clone(),
        Stmt::Defer     { span, .. } => span.clone(),
        Stmt::Go        { span, .. } => span.clone(),
        Stmt::Expr      { span, .. } => span.clone(),
        Stmt::Block(b)               => b.span.clone(),
    })
}

/// Returns `true` if any statement in `stmts` (top-level only) is a
/// `break`/`return`, or is a call to a delay-like function.
/// Used for T0101 (infinite loop without escape).
fn stmts_have_escape(stmts: &[Stmt]) -> bool {
    for stmt in stmts {
        match stmt {
            Stmt::Break { .. } | Stmt::Return { .. } => return true,
            Stmt::Expr { expr, .. } => {
                if expr_is_delay_call(expr) { return true; }
            }
            Stmt::If { then, else_, .. } => {
                if stmts_have_escape(&then.stmts) { return true; }
                if let Some(s) = else_ {
                    if stmts_have_escape(std::slice::from_ref(s)) { return true; }
                }
            }
            _ => {}
        }
    }
    false
}

/// Returns `true` if `expr` is a call to `delay`, `time.Sleep`, or similar
/// functions that prevent an infinite loop from locking up the MCU.
fn expr_is_delay_call(expr: &Expr) -> bool {
    match expr {
        Expr::Call { func, .. } => match func.as_ref() {
            Expr::Ident { name, .. } =>
                matches!(name.as_str(), "delay" | "delayMicroseconds"),
            Expr::Select { expr, field, .. } => {
                let is_time_pkg = matches!(
                    expr.as_ref(),
                    Expr::Ident { name, .. } if matches!(name.as_str(), "time" | "arduino")
                );
                is_time_pkg && matches!(
                    field.as_str(),
                    "Sleep" | "Delay" | "Milliseconds" | "Microseconds"
                )
            }
            _ => false,
        },
        _ => false,
    }
}

/// Returns `true` if `expr` is a `Serial.Begin` / `serial.Begin` call.
fn expr_is_serial_begin(expr: &Expr) -> bool {
    if let Expr::Call { func, .. } = expr {
        if let Expr::Select { expr, field, .. } = func.as_ref() {
            if field.eq_ignore_ascii_case("begin") {
                if let Expr::Ident { name, .. } = expr.as_ref() {
                    return matches!(name.as_str(), "Serial" | "serial");
                }
            }
        }
    }
    false
}

/// Returns the call-site span if `expr` produces Serial output
/// (`serial.Print`, `serial.Println`, `fmt.Print`, `fmt.Println`, …).
fn expr_is_serial_output(expr: &Expr) -> Option<Span> {
    if let Expr::Call { func, span, .. } = expr {
        if let Expr::Select { expr, field, .. } = func.as_ref() {
            let is_output = matches!(
                field.as_str(),
                "Print" | "Println" | "Printf" | "Write" | "println" | "print"
            );
            if is_output {
                if let Expr::Ident { name, .. } = expr.as_ref() {
                    if matches!(name.as_str(), "Serial" | "serial" | "fmt") {
                        return Some(span.clone());
                    }
                }
            }
        }
    }
    None
}

// ── Checker ───────────────────────────────────────────────────────────────────

pub struct Checker<'a> {
    mode:    StrictMode,
    scope:   ScopeStack,
    errors:  Vec<TsukiError>,

    /// Import local-names referenced at least once (for T0002).
    used_imports:  HashSet<String>,
    imports:       &'a Vec<crate::parser::ast::Import>,

    /// Names of user-defined functions that have been *called* (for T0003).
    called_funcs:  HashSet<String>,
    /// Spans of all declared top-level functions keyed by name (for T0003).
    func_decls:    HashMap<String, Span>,

    /// True while inside the `setup()` function body.
    in_setup:      bool,
    /// True if `setup()` contains a `Serial.Begin` call.
    serial_begin_in_setup: bool,
    /// Spans of all Serial output calls found anywhere (for T0300).
    serial_output_spans:   Vec<Span>,

    /// Board name used for T0302 (PWM pin validation).
    board: String,
}

impl<'a> Checker<'a> {
    /// Run all checks.  Returns the collected diagnostics (may be empty).
    pub fn run(program: &'a Program, mode: StrictMode) -> Vec<TsukiError> {
        Self::run_with_board(program, mode, "uno")
    }

    /// Like `run` but also accepts the target board name for hardware checks.
    pub fn run_with_board(program: &'a Program, mode: StrictMode, board: &str) -> Vec<TsukiError> {
        if matches!(mode, StrictMode::None) { return vec![]; }

        let mut c = Checker {
            mode,
            scope: ScopeStack::new(),
            errors: vec![],
            used_imports: HashSet::new(),
            imports: &program.imports,
            called_funcs: HashSet::new(),
            func_decls: HashMap::new(),
            in_setup: false,
            serial_begin_in_setup: false,
            serial_output_spans: vec![],
            board: board.to_owned(),
        };
        c.check_program(program);
        c.errors
    }

    // ── Top level ─────────────────────────────────────────────────────────────

    fn check_program(&mut self, program: &Program) {
        // Pass 1 — hoist top-level function signatures so forward calls resolve.
        for decl in &program.decls { self.hoist_decl(decl); }

        // Pass 2 — full semantic check.
        for decl in &program.decls { self.check_decl(decl); }

        // ── Post-pass checks ──────────────────────────────────────────────────

        // T0003: user-defined functions declared but never called.
        // `setup` and `loop` are invoked by the Arduino runtime — exclude them.
        if self.mode >= StrictMode::Strict {
            let runtime_fns: HashSet<&str> = ["setup", "loop"].iter().copied().collect();
            for (name, span) in &self.func_decls {
                if runtime_fns.contains(name.as_str()) { continue; }
                if !self.called_funcs.contains(name) {
                    self.errors.push(TsukiError::type_coded(
                        span.clone(),
                        3,
                        format!("function `{}` is defined but never called", name),
                    ));
                }
            }
        }

        // T0300: Serial output used without Serial.Begin in setup().
        if self.mode >= StrictMode::Dev && !self.serial_begin_in_setup {
            for span in std::mem::take(&mut self.serial_output_spans) {
                self.errors.push(TsukiError::type_coded(
                    span,
                    300,
                    "`Serial.Begin` was not called in `setup()` before Serial output",
                ));
            }
        }

        // T0001/T0011: top-level const/var declarations that are never used.
        // Functions are excluded — setup/loop are always "used" by the runtime.
        if self.mode >= StrictMode::Strict {
            let top_syms = self.scope.pop();
            for sym in top_syms {
                if sym.name == "_" { continue; }
                if sym.ty.as_deref() == Some("func") { continue; }
                self.emit_unused_or_write_only(sym);
            }
        }

        // T0002: unused imports.
        if self.mode >= StrictMode::Strict {
            for import in self.imports {
                let local = import.local_name();
                if local == "_" { continue; }
                if !self.used_imports.contains(local) {
                    self.errors.push(TsukiError::type_coded(
                        Span::synthetic(),
                        2,
                        format!("imported and not used: \"{}\"", import.path),
                    ));
                }
            }
        }
    }

    // ── Hoisting ──────────────────────────────────────────────────────────────

    fn hoist_decl(&mut self, decl: &Decl) {
        match decl {
            Decl::Func { name, sig, span, .. } => {
                let arity = sig.params.len();
                self.scope.declare_with_arity(
                    name.clone(), Some("func".into()), span.clone(), Some(arity),
                );
                self.func_decls.insert(name.clone(), span.clone());
            }
            Decl::Var { name, ty, span, .. } => {
                let inferred = type_annotation_to_go_string(ty);
                self.scope.declare(name.clone(), inferred, span.clone());
            }
            Decl::Const { name, ty, span, .. } => {
                let inferred = type_annotation_to_go_string(ty);
                self.scope.declare(name.clone(), inferred, span.clone());
            }
            _ => {}
        }
    }

    // ── Declarations ─────────────────────────────────────────────────────────

    fn check_decl(&mut self, decl: &Decl) {
        match decl {
            Decl::Func { name, recv, sig, body, span } => {
                self.in_setup = name == "setup";
                self.scope.push();

                if let Some(recv) = recv { self.register_param(recv); }
                for param in &sig.params { self.register_param(param); }

                if let Some(body) = body {
                    self.check_block(body, sig);

                    // T0005: not all code paths return a value.
                    if self.mode >= StrictMode::Dev
                        && !sig.results.is_empty()
                        && !always_returns(&body.stmts)
                    {
                        self.errors.push(TsukiError::type_coded(
                            span.clone(),
                            5,
                            format!(
                                "missing return: function `{}` does not return on all paths",
                                name
                            ),
                        ));
                    }
                }

                let syms = self.scope.pop();
                if self.mode >= StrictMode::Strict {
                    for sym in syms {
                        if sym.name == "_" { continue; }
                        self.emit_unused_or_write_only(sym);
                    }
                }
                self.in_setup = false;
            }

            Decl::Var { name, ty, init, span } => {
                let ty_str = if let Some(init_expr) = init {
                    self.check_expr(init_expr);
                    type_annotation_to_go_string(ty).or_else(|| infer_expr(init_expr, &self.scope))
                } else {
                    type_annotation_to_go_string(ty)
                };
                self.scope.declare(name.clone(), ty_str, span.clone());
            }

            Decl::Const { name, ty, val, span } => {
                self.check_expr(val);
                let ty_str = type_annotation_to_go_string(ty).or_else(|| infer_expr(val, &self.scope));
                self.scope.declare(name.clone(), ty_str, span.clone());
            }

            Decl::TypeDef { .. } | Decl::StructDef { .. } => {}
        }
    }

    fn register_param(&mut self, param: &FuncParam) {
        if let Some(name) = &param.name {
            if name != "_" {
                self.scope.declare(name.clone(), Some(type_to_go_string(&param.ty)), Span::synthetic());
            }
        }
    }

    // ── Blocks & statements ───────────────────────────────────────────────────

    fn check_block(&mut self, block: &Block, enclosing_sig: &FuncSig) {
        // T0004: detect unreachable statements inside this block.
        if self.mode >= StrictMode::Dev {
            if let Some(idx) = first_terminator_idx(&block.stmts) {
                if idx + 1 < block.stmts.len() {
                    if let Some(span) = span_of_stmt(&block.stmts[idx + 1]) {
                        self.errors.push(TsukiError::type_coded(
                            span, 4,
                            "unreachable code after return/break/continue",
                        ));
                    }
                }
            }
        }
        for stmt in &block.stmts {
            self.check_stmt(stmt, enclosing_sig);
        }
    }

    fn check_stmt(&mut self, stmt: &Stmt, sig: &FuncSig) {
        match stmt {
            // ── Declarations ──────────────────────────────────────────────────
            Stmt::VarDecl { name, ty, init, span } => {
                let ty_str = if let Some(init_expr) = init {
                    self.check_expr(init_expr);
                    type_annotation_to_go_string(ty).or_else(|| infer_expr(init_expr, &self.scope))
                } else {
                    type_annotation_to_go_string(ty)
                };
                self.scope.declare(name.clone(), ty_str, span.clone());
            }

            Stmt::ConstDecl { name, ty, val, span } => {
                self.check_expr(val);
                let ty_str = type_annotation_to_go_string(ty).or_else(|| infer_expr(val, &self.scope));
                self.scope.declare(name.clone(), ty_str, span.clone());
            }

            Stmt::ShortDecl { names, vals, span } => {
                let inferred: Vec<Option<String>> = vals.iter()
                    .map(|v| { self.check_expr(v); infer_expr(v, &self.scope) })
                    .collect();

                for (i, name) in names.iter().enumerate() {
                    if name == "_" { continue; }
                    let ty = inferred.get(i).and_then(|t| t.clone());

                    // T0010: duplicate declaration in same scope
                    if let Some(prev_span) = self.scope.declare(name.clone(), ty, span.clone()) {
                        if self.mode >= StrictMode::Dev {
                            self.errors.push(TsukiError::type_coded(
                                span.clone(), 10,
                                format!(
                                    "`{}` already declared in this scope \
                                     (first declared at {}:{})",
                                    name, prev_span.line, prev_span.col
                                ),
                            ));
                        }
                    }
                }
            }

            // ── Assignments ───────────────────────────────────────────────────
            Stmt::Assign { lhs, rhs, op, span } => {
                // T0008: type mismatch on plain assignments
                if self.mode >= StrictMode::Dev
                    && *op == AssignOp::Plain
                    && lhs.len() == 1 && rhs.len() == 1
                {
                    if let Expr::Ident { name, .. } = &lhs[0] {
                        if let Some(sym) = self.scope.lookup(name) {
                            if let (Some(lty), Some(rty)) = (
                                sym.ty.clone(),
                                infer_expr(&rhs[0], &self.scope),
                            ) {
                                if is_obviously_incompatible(&lty, &rty) {
                                    self.errors.push(TsukiError::type_coded(
                                        span.clone(), 8,
                                        format!(
                                            "cannot use {} (type {}) as type {}",
                                            name, rty, lty
                                        ),
                                    ));
                                }
                            }
                        }
                    }
                }
                // Mark LHS as *written* (not read); RHS as read.
                for e in lhs { self.check_lhs_expr(e); }
                for e in rhs { self.check_expr(e); }
            }

            // ── Inc / Dec ─────────────────────────────────────────────────────
            Stmt::Inc { expr, .. } | Stmt::Dec { expr, .. } => {
                self.check_expr(expr); // both reads and writes — counts as read
            }

            // ── Return ────────────────────────────────────────────────────────
            Stmt::Return { vals, span } => {
                for v in vals { self.check_expr(v); }

                if self.mode >= StrictMode::Strict {
                    let expected = sig.results.len();
                    let got      = vals.len();
                    if expected != got {
                        self.errors.push(TsukiError::type_coded(
                            span.clone(), 5,
                            format!(
                                "wrong number of return values: expected {}, found {}",
                                expected, got
                            ),
                        ));
                    } else if expected == 1 {
                        let exp_ty = type_annotation_to_go_string(&Some(sig.results[0].ty.clone()));
                        let got_ty = infer_expr(&vals[0], &self.scope);
                        if let (Some(exp), Some(got_t)) = (exp_ty, got_ty) {
                            if is_obviously_incompatible(&exp, &got_t) {
                                self.errors.push(TsukiError::type_coded(
                                    span.clone(), 8,
                                    format!("cannot use type {} as return type {}", got_t, exp),
                                ));
                            }
                        }
                    }
                }
            }

            // ── No-op control flow ────────────────────────────────────────────
            Stmt::Break { .. } | Stmt::Continue { .. } | Stmt::Goto { .. }
            | Stmt::Label { .. } => {}

            // ── If ────────────────────────────────────────────────────────────
            Stmt::If { init, cond, then, else_, .. } => {
                self.scope.push();
                if let Some(s) = init { self.check_stmt(s, sig); }
                self.check_expr(cond);
                self.check_block(then, sig);
                if let Some(s) = else_ { self.check_stmt(s, sig); }
                let syms = self.scope.pop();
                self.report_unused_syms(syms);
            }

            // ── For ───────────────────────────────────────────────────────────
            Stmt::For { init, cond, post, body, span } => {
                // T0101: `for {}` or `for true {}` without escape
                let is_infinite = matches!(cond, None | Some(Expr::Bool(true)));
                if is_infinite
                    && self.mode >= StrictMode::Dev
                    && !stmts_have_escape(&body.stmts)
                {
                    self.errors.push(TsukiError::type_coded(
                        span.clone(), 101,
                        "potential infinite loop: no `break`, `return`, \
                         or `delay` call in loop body",
                    ));
                }

                self.scope.push();
                if let Some(s) = init { self.check_stmt(s, sig); }
                if let Some(e) = cond { self.check_expr(e); }
                if let Some(s) = post { self.check_stmt(s, sig); }
                self.check_block(body, sig);
                let syms = self.scope.pop();
                self.report_unused_syms(syms);
            }

            // ── Range ─────────────────────────────────────────────────────────
            Stmt::Range { key, val, iter, body, span } => {
                self.check_expr(iter);
                self.scope.push();
                if let Some(k) = key {
                    if k != "_" {
                        self.scope.declare(k.clone(), Some("int".into()), span.clone());
                    }
                }
                if let Some(v) = val {
                    if v != "_" {
                        self.scope.declare(v.clone(), None, span.clone());
                    }
                }
                self.check_block(body, sig);
                let syms = self.scope.pop();
                self.report_unused_syms(syms);
            }

            // ── Switch ────────────────────────────────────────────────────────
            Stmt::Switch { init, tag, cases, .. } => {
                self.scope.push();
                if let Some(s) = init { self.check_stmt(s, sig); }
                if let Some(e) = tag  { self.check_expr(e); }
                for case in cases {
                    for e in &case.exprs { self.check_expr(e); }
                    self.scope.push();
                    for s in &case.body { self.check_stmt(s, sig); }
                    let syms = self.scope.pop();
                    self.report_unused_syms(syms);
                }
                let syms = self.scope.pop();
                self.report_unused_syms(syms);
            }

            // ── Block ─────────────────────────────────────────────────────────
            Stmt::Block(block) => {
                self.scope.push();
                self.check_block(block, sig);
                let syms = self.scope.pop();
                self.report_unused_syms(syms);
            }

            // ── Defer / Go ────────────────────────────────────────────────────
            Stmt::Defer { call, .. } | Stmt::Go { call, .. } => {
                self.check_expr(call);
            }

            // ── Expression statement ──────────────────────────────────────────
            Stmt::Expr { expr, .. } => {
                if self.in_setup && expr_is_serial_begin(expr) {
                    self.serial_begin_in_setup = true;
                }
                if let Some(span) = expr_is_serial_output(expr) {
                    self.serial_output_spans.push(span);
                }
                self.check_expr(expr);
            }
        }
    }

    // ── LHS expression handling ───────────────────────────────────────────────

    /// Check an expression on the left-hand side of an assignment.
    /// Bare identifiers are marked as *written* (not read) to enable T0011.
    fn check_lhs_expr(&mut self, expr: &Expr) {
        match expr {
            Expr::Ident { name, .. } => {
                self.scope.mark_written(name);
            }
            Expr::Index { expr, idx, .. } => {
                self.check_expr(expr);
                self.check_expr(idx);
            }
            Expr::Select { expr, .. } => {
                self.check_expr(expr);
            }
            Expr::Unary { expr, .. } => {
                self.check_expr(expr);
            }
            _ => self.check_expr(expr),
        }
    }

    // ── Expressions ──────────────────────────────────────────────────────────

    fn check_expr(&mut self, expr: &Expr) {
        match expr {
            Expr::Int(_) | Expr::Float(_) | Expr::Str(_) | Expr::Rune(_)
            | Expr::Bool(_) | Expr::Nil | Expr::Raw(_) => {}

            Expr::Ident { name, span } => {
                self.used_imports.insert(name.clone());
                if self.mode >= StrictMode::Dev {
                    if self.scope.lookup(name).is_none() {
                        let is_imported = self.imports.iter()
                            .any(|imp| imp.local_name() == name.as_str());
                        if !is_imported {
                            let first = name.chars().next().unwrap_or('_');
                            if first.is_lowercase() && name != "_" {
                                // T0006: undefined identifier
                                self.errors.push(TsukiError::type_coded(
                                    span.clone(), 6,
                                    format!("undefined: `{}`", name),
                                ));
                            }
                        }
                    } else {
                        self.scope.mark_read(name);
                    }
                }
            }

            Expr::Call { func, args, span } => {
                self.check_expr(func);
                for a in args { self.check_expr(a); }

                // Record direct calls for T0003
                if let Expr::Ident { name, .. } = func.as_ref() {
                    self.called_funcs.insert(name.clone());

                    // T0007: arity check for user-defined functions
                    if self.mode >= StrictMode::Dev {
                        if let Some(sym) = self.scope.lookup(name) {
                            if let Some(expected) = sym.arity {
                                if args.len() != expected {
                                    self.errors.push(TsukiError::type_coded(
                                        span.clone(), 7,
                                        format!(
                                            "wrong number of arguments calling `{}`: \
                                             expected {}, found {}",
                                            name, expected, args.len()
                                        ),
                                    ));
                                }
                            }
                        }
                    }
                }

                // T0302: AnalogWrite on non-PWM pin
                if self.mode >= StrictMode::Dev {
                    self.check_analog_write(func, args, span);
                }
            }

            // T0100: division by literal zero
            Expr::Binary { op: BinOp::Div, lhs, rhs, span } => {
                self.check_expr(lhs);
                self.check_expr(rhs);
                if matches!(rhs.as_ref(), Expr::Int(0)) {
                    self.errors.push(TsukiError::type_coded(
                        span.clone(), 100,
                        "division by zero",
                    ));
                }
            }

            Expr::Binary { lhs, rhs, .. } => {
                self.check_expr(lhs);
                self.check_expr(rhs);
            }

            Expr::Unary  { expr, .. }        => self.check_expr(expr),
            Expr::TypeAssert { expr, .. }     => self.check_expr(expr),
            Expr::Select { expr, .. }         => self.check_expr(expr),

            Expr::Index { expr, idx, .. } => {
                self.check_expr(expr);
                self.check_expr(idx);
            }

            Expr::Slice { expr, lo, hi, .. } => {
                self.check_expr(expr);
                if let Some(e) = lo { self.check_expr(e); }
                if let Some(e) = hi { self.check_expr(e); }
            }

            Expr::Composite { elems, .. } => {
                for elem in elems {
                    if let Some(k) = &elem.key { self.check_expr(k); }
                    self.check_expr(&elem.val);
                }
            }

            Expr::FuncLit { sig, body, .. } => {
                self.scope.push();
                for param in &sig.params { self.register_param(param); }
                self.check_block(body, sig);
                let syms = self.scope.pop();
                self.report_unused_syms(syms);
            }
        }
    }

    // ── Hardware checks ───────────────────────────────────────────────────────

    /// T0302: `arduino.AnalogWrite(pin, val)` where `pin` is a literal that
    /// does not support PWM on the target board.
    fn check_analog_write(&mut self, func: &Expr, args: &[Expr], span: &Span) {
        let is_analog_write = match func {
            Expr::Select { expr, field, .. } => {
                matches!(expr.as_ref(), Expr::Ident { name, .. } if name == "arduino")
                    && field == "AnalogWrite"
            }
            Expr::Ident { name, .. } => name == "analogWrite",
            _ => false,
        };
        if !is_analog_write || args.is_empty() { return; }

        if let Expr::Int(pin_num) = &args[0] {
            let pin = *pin_num as u8;
            let pwm_pins = pwm_pins_for_board(&self.board);
            if !pwm_pins.contains(&pin) {
                let mut sorted: Vec<u8> = pwm_pins.into_iter().collect();
                sorted.sort_unstable();
                self.errors.push(TsukiError::type_coded(
                    span.clone(), 302,
                    format!(
                        "pin {} does not support PWM on board `{}`; \
                         PWM-capable pins: {}",
                        pin,
                        self.board,
                        sorted.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(", ")
                    ),
                ));
            }
        }
    }

    // ── Diagnostic helpers ────────────────────────────────────────────────────

    /// Emit T0001 (unused) or T0011 (write-only) for a symbol, if appropriate.
    fn emit_unused_or_write_only(&mut self, sym: Symbol) {
        if sym.name == "_" { return; }
        if sym.ty.as_deref() == Some("func") { return; }

        if sym.is_unused() {
            self.errors.push(TsukiError::type_coded_ranged(
                sym.span.clone(), 1, sym.name.len(),
                format!("`{}` declared and not used", sym.name),
            ));
        } else if sym.is_write_only() {
            self.errors.push(TsukiError::type_coded_ranged(
                sym.span.clone(), 11, sym.name.len(),
                format!("`{}` is assigned but its value is never read", sym.name),
            ));
        }
    }

    /// Run T0001/T0011 on a set of symbols from a popped scope.
    fn report_unused_syms(&mut self, syms: Vec<Symbol>) {
        if self.mode < StrictMode::Strict { return; }
        for sym in syms { self.emit_unused_or_write_only(sym); }
    }
}

// ── Type compatibility ────────────────────────────────────────────────────────

/// Returns `true` when two Go type strings are obviously incompatible.
/// Intentionally conservative to avoid false positives on user-defined types.
fn is_obviously_incompatible(lhs: &str, rhs: &str) -> bool {
    if lhs == rhs { return false; }
    let numeric = |s: &str| matches!(s,
        "int" | "int8" | "int16" | "int32" | "int64"
        | "uint" | "uint8" | "uint16" | "uint32" | "uint64"
        | "float32" | "float64" | "byte" | "rune"
    );
    match (lhs, rhs) {
        ("string", r) if r != "string" => numeric(r) || r == "bool",
        ("bool",   r) if r != "bool"   => numeric(r),
        (l, "string") if l != "string" => numeric(l) || l == "bool",
        (l, "bool")   if l != "bool"   => numeric(l),
        _ => false,
    }
}