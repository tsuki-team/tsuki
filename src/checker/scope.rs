// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: checker :: scope
//  Symbol table with nested lexical scopes.
// ─────────────────────────────────────────────────────────────────────────────

use std::collections::HashMap;
use crate::error::Span;

// ── Symbol ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Symbol {
    pub name:        String,
    pub ty:          Option<String>,  // inferred Go type string, e.g. "int", "string"
    pub span:        Span,
    /// Number of times this symbol has been *read* (appears in expression context).
    pub read_count:  u32,
    /// Number of times this symbol has been *written* (appears as assignment LHS
    /// after its initial declaration).
    pub write_count: u32,
    /// For function symbols: the number of declared parameters (used for arity checks).
    pub arity:       Option<usize>,
}

impl Symbol {
    /// True if the symbol has been read at least once.
    pub fn is_read(&self) -> bool { self.read_count > 0 }
    /// True if the symbol has been assigned after declaration.
    pub fn is_written(&self) -> bool { self.write_count > 0 }
    /// True if referenced in any way (read or written after declaration).
    pub fn is_used(&self) -> bool { self.read_count > 0 || self.write_count > 0 }
    /// T0001: declared but never referenced at all.
    pub fn is_unused(&self) -> bool { !self.is_used() }
    /// T0011: assigned after declaration but the value is never read.
    pub fn is_write_only(&self) -> bool { self.read_count == 0 && self.write_count > 0 }
}

// ── Scope ─────────────────────────────────────────────────────────────────────

/// A single lexical scope.  Scopes are stored as a `Vec<Frame>` stack in
/// `ScopeStack` rather than as a linked list, so operations are O(1) push/pop
/// and O(depth) lookup — depth rarely exceeds 8–10 for typical Arduino firmware.
#[derive(Debug, Default)]
struct Frame {
    symbols: HashMap<String, Symbol>,
}

/// A stack of lexical scope frames.
///
/// The bottom frame (index 0) is the module / top-level scope.  Each nested
/// block (function body, `if`, `for`, `{…}`) pushes a new frame on entry and
/// pops it on exit.
#[derive(Debug, Default)]
pub struct ScopeStack {
    frames: Vec<Frame>,
}

impl ScopeStack {
    pub fn new() -> Self {
        Self { frames: vec![Frame::default()] }  // module-level frame
    }

    /// Enter a new nested scope.
    pub fn push(&mut self) {
        self.frames.push(Frame::default());
    }

    /// Exit the current scope.  Returns **all** `Symbol`s from that frame so
    /// the caller can emit diagnostics (T0001 unused, T0011 write-only, etc.).
    pub fn pop(&mut self) -> Vec<Symbol> {
        match self.frames.pop() {
            Some(frame) => frame.symbols.into_values().collect(),
            None => vec![],
        }
    }

    /// Declare a symbol in the *current* (innermost) scope.
    ///
    /// Returns `Some(prev_span)` if the name was already declared **in the
    /// same scope** (duplicate declaration → T0010), `None` on success.
    pub fn declare(
        &mut self,
        name: impl Into<String>,
        ty: Option<String>,
        span: Span,
    ) -> Option<Span> {
        self.declare_with_arity(name, ty, span, None)
    }

    /// Like `declare` but also stores the function arity for T0007 checks.
    pub fn declare_with_arity(
        &mut self,
        name: impl Into<String>,
        ty: Option<String>,
        span: Span,
        arity: Option<usize>,
    ) -> Option<Span> {
        let name = name.into();
        let frame = self.frames.last_mut().expect("scope stack is empty");
        if let Some(prev) = frame.symbols.get(&name) {
            return Some(prev.span.clone());
        }
        frame.symbols.insert(name.clone(), Symbol {
            name,
            ty,
            span,
            read_count: 0,
            write_count: 0,
            arity,
        });
        None
    }

    /// Resolve a name by walking the scope stack from innermost to outermost.
    pub fn lookup(&self, name: &str) -> Option<&Symbol> {
        for frame in self.frames.iter().rev() {
            if let Some(sym) = frame.symbols.get(name) {
                return Some(sym);
            }
        }
        None
    }

    /// Mark a symbol as *read* (appears in an expression context).
    /// Walks from innermost scope outwards.  Returns `true` if found.
    pub fn mark_read(&mut self, name: &str) -> bool {
        for frame in self.frames.iter_mut().rev() {
            if let Some(sym) = frame.symbols.get_mut(name) {
                sym.read_count += 1;
                return true;
            }
        }
        false
    }

    /// Mark a symbol as *written* (appears as the LHS of an assignment after
    /// its initial declaration).  Returns `true` if found.
    pub fn mark_written(&mut self, name: &str) -> bool {
        for frame in self.frames.iter_mut().rev() {
            if let Some(sym) = frame.symbols.get_mut(name) {
                sym.write_count += 1;
                return true;
            }
        }
        false
    }

    /// Alias for `mark_read` — kept for call-sites that don't distinguish
    /// read from write (e.g. `Inc`/`Dec`, which both read and write).
    pub fn mark_used(&mut self, name: &str) -> bool {
        self.mark_read(name)
    }
}