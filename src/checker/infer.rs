// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: checker :: infer
//  Fast, O(n) type inference from AST expressions.
//  Returns Go type strings ("int", "float32", "string", "bool") or None.
// ─────────────────────────────────────────────────────────────────────────────

use crate::parser::ast::{Expr, Type};
use super::scope::ScopeStack;

/// Infer the Go type of an expression without doing any I/O.
///
/// This is intentionally shallow — it handles the common cases that appear
/// in typical Arduino firmware and returns `None` for everything else.
/// The caller should treat `None` as "unknown" rather than an error.
pub fn infer_expr(expr: &Expr, scope: &ScopeStack) -> Option<String> {
    match expr {
        // Literals → fixed Go types
        Expr::Int(_)   => Some("int".into()),
        Expr::Float(_) => Some("float32".into()),
        Expr::Str(_)   => Some("string".into()),
        Expr::Rune(_)  => Some("rune".into()),
        Expr::Bool(_)  => Some("bool".into()),
        Expr::Nil      => None,

        // Identifier → look up in scope
        Expr::Ident { name, .. } => {
            scope.lookup(name).and_then(|s| s.ty.clone())
        }

        // Binary operation → propagate LHS type (works for arithmetic chains)
        Expr::Binary { lhs, op, .. } => {
            use crate::parser::ast::BinOp;
            match op {
                // Comparisons always produce bool
                BinOp::Eq | BinOp::Ne | BinOp::Lt | BinOp::Le
                | BinOp::Gt | BinOp::Ge => Some("bool".into()),
                // Logical operators always produce bool
                BinOp::And | BinOp::Or => Some("bool".into()),
                // Arithmetic → inherit from LHS
                _ => infer_expr(lhs, scope),
            }
        }

        // Unary operation → propagate operand type, except `!` → bool
        Expr::Unary { op, expr, .. } => {
            use crate::parser::ast::UnOp;
            match op {
                UnOp::Not => Some("bool".into()),
                _         => infer_expr(expr, scope),
            }
        }

        // Typed composite literal → use the declared type
        Expr::Composite { ty, .. } => Some(type_to_go_string(ty)),

        // Everything else (calls, index, select, etc.) → unknown
        _ => None,
    }
}

/// Convert an AST `Type` node to a Go-style string for diagnostic messages.
pub fn type_to_go_string(ty: &Type) -> String {
    match ty {
        Type::Bool         => "bool".into(),
        Type::Int          => "int".into(),
        Type::Int8         => "int8".into(),
        Type::Int16        => "int16".into(),
        Type::Int32        => "int32".into(),
        Type::Int64        => "int64".into(),
        Type::Uint         => "uint".into(),
        Type::Uint8        => "uint8".into(),
        Type::Uint16       => "uint16".into(),
        Type::Uint32       => "uint32".into(),
        Type::Uint64       => "uint64".into(),
        Type::Float32      => "float32".into(),
        Type::Float64      => "float64".into(),
        Type::String       => "string".into(),
        Type::Byte         => "byte".into(),
        Type::Rune         => "rune".into(),
        Type::Named(n)     => n.clone(),
        Type::Ptr(inner)   => format!("*{}", type_to_go_string(inner)),
        Type::Slice(elem)  => format!("[]{}", type_to_go_string(elem)),
        Type::Array { len: Some(n), elem } => format!("[{}]{}", n, type_to_go_string(elem)),
        Type::Array { len: None,    elem } => format!("[]{}", type_to_go_string(elem)),
        Type::Map { key, val } => format!("map[{}]{}", type_to_go_string(key), type_to_go_string(val)),
        Type::Void    => "void".into(),
        Type::Infer   => "auto".into(),
        _             => "unknown".into(),
    }
}

/// Infer the type from an AST `Type` annotation, if present.
/// Used when a variable is declared with an explicit type.
pub fn type_annotation_to_go_string(ty: &Option<Type>) -> Option<String> {
    ty.as_ref().map(|t| type_to_go_string(t))
}
