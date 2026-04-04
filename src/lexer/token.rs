// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: lexer :: token
// ─────────────────────────────────────────────────────────────────────────────

use crate::error::Span;

// ── Token kind ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum TokenKind {
    // ── Literals ──────────────────────────────────────────────
    LitInt(i64),
    LitFloat(f64),
    LitString(String),
    LitRune(char),
    LitBool(bool),

    // ── Identifier ────────────────────────────────────────────
    Ident(String),

    // ── Keywords ──────────────────────────────────────────────
    KwPackage,
    KwImport,
    KwFunc,
    KwVar,
    KwConst,
    KwType,
    KwReturn,
    KwIf,
    KwElse,
    KwFor,
    KwRange,
    KwSwitch,
    KwCase,
    KwDefault,
    KwFallthrough,
    KwBreak,
    KwContinue,
    KwGoto,
    KwDefer,
    KwGo,
    KwSelect,
    KwMap,
    KwStruct,
    KwInterface,
    KwChan,
    KwNil,
    KwTrue,
    KwFalse,

    // ── Operators ─────────────────────────────────────────────
    // Arithmetic
    Plus,         // +
    Minus,        // -
    Star,         // *
    Slash,        // /
    Percent,      // %

    // Bitwise
    Amp,          // &
    Pipe,         // |
    Caret,        // ^
    AmpCaret,     // &^
    LShift,       // <<
    RShift,       // >>

    // Compound assignment
    PlusEq,       // +=
    MinusEq,      // -=
    StarEq,       // *=
    SlashEq,      // /=
    PercentEq,    // %=
    AmpEq,        // &=
    PipeEq,       // |=
    CaretEq,      // ^=
    LShiftEq,     // <<=
    RShiftEq,     // >>=
    AmpCaretEq,   // &^=

    // Assignment
    Assign,       // =
    DeclAssign,   // :=

    // Increment / decrement
    Inc,          // ++
    Dec,          // --

    // Comparison
    Eq,           // ==
    NotEq,        // !=
    Lt,           // <
    LtEq,         // <=
    Gt,           // >
    GtEq,         // >=

    // Logical
    AndAnd,       // &&
    OrOr,         // ||
    Bang,         // !

    // Channel
    Arrow,        // <-

    // Misc
    Ellipsis,     // ...
    Dot,          // .
    Comma,        // ,
    Semicolon,    // ;
    Colon,        // :

    // ── Delimiters ────────────────────────────────────────────
    LParen,       // (
    RParen,       // )
    LBrace,       // {
    RBrace,       // }
    LBracket,     // [
    RBracket,     // ]

    // ── Special ───────────────────────────────────────────────
    Newline,
    EOF,
}

impl TokenKind {
    /// Return whether this token can be used in an assignment-operator position.
    pub fn as_assign_op(&self) -> Option<&'static str> {
        Some(match self {
            Self::Assign      => "=",
            Self::PlusEq      => "+=",
            Self::MinusEq     => "-=",
            Self::StarEq      => "*=",
            Self::SlashEq     => "/=",
            Self::PercentEq   => "%=",
            Self::AmpEq       => "&=",
            Self::PipeEq      => "|=",
            Self::CaretEq     => "^=",
            Self::LShiftEq    => "<<=",
            Self::RShiftEq    => ">>=",
            Self::AmpCaretEq  => "&^=",
            _ => return None,
        })
    }

    /// Precedence + binary C++ operator string, if this is a binary op.
    pub fn as_binary_op(&self) -> Option<(u8, &'static str)> {
        Some(match self {
            Self::OrOr    => (1, "||"),
            Self::AndAnd  => (2, "&&"),
            Self::Eq      => (3, "=="),
            Self::NotEq   => (3, "!="),
            Self::Lt      => (3, "<"),
            Self::LtEq    => (3, "<="),
            Self::Gt      => (3, ">"),
            Self::GtEq    => (3, ">="),
            Self::Pipe    => (4, "|"),
            Self::Caret   => (5, "^"),
            Self::Amp     => (6, "&"),
            Self::LShift  => (7, "<<"),
            Self::RShift  => (7, ">>"),
            Self::Plus    => (8, "+"),
            Self::Minus   => (8, "-"),
            Self::Star    => (9, "*"),
            Self::Slash   => (9, "/"),
            Self::Percent => (9, "%"),
            _ => return None,
        })
    }
}

// ── Token ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Token {
    pub kind: TokenKind,
    pub span: Span,
    /// Raw source text (preserved for diagnostics and source maps).
    pub raw:  String,
}

impl Token {
    pub fn new(kind: TokenKind, span: Span, raw: impl Into<String>) -> Self {
        Self { kind, span, raw: raw.into() }
    }

    pub fn is_eof(&self)     -> bool { self.kind == TokenKind::EOF     }
    pub fn is_newline(&self) -> bool { self.kind == TokenKind::Newline }
}

// ── Keyword table ─────────────────────────────────────────────────────────────

pub fn keyword(s: &str) -> Option<TokenKind> {
    Some(match s {
        "package"     => TokenKind::KwPackage,
        "import"      => TokenKind::KwImport,
        "func"        => TokenKind::KwFunc,
        "var"         => TokenKind::KwVar,
        "const"       => TokenKind::KwConst,
        "type"        => TokenKind::KwType,
        "return"      => TokenKind::KwReturn,
        "if"          => TokenKind::KwIf,
        "else"        => TokenKind::KwElse,
        "for"         => TokenKind::KwFor,
        "range"       => TokenKind::KwRange,
        "switch"      => TokenKind::KwSwitch,
        "case"        => TokenKind::KwCase,
        "default"     => TokenKind::KwDefault,
        "fallthrough" => TokenKind::KwFallthrough,
        "break"       => TokenKind::KwBreak,
        "continue"    => TokenKind::KwContinue,
        "goto"        => TokenKind::KwGoto,
        "defer"       => TokenKind::KwDefer,
        "go"          => TokenKind::KwGo,
        "select"      => TokenKind::KwSelect,
        "map"         => TokenKind::KwMap,
        "struct"      => TokenKind::KwStruct,
        "interface"   => TokenKind::KwInterface,
        "chan"         => TokenKind::KwChan,
        "nil"         => TokenKind::KwNil,
        "true"        => TokenKind::LitBool(true),
        "false"       => TokenKind::LitBool(false),
        _ => return None,
    })
}