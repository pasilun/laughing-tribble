//! Plan DSL: the lexer (spec §7.1). Parser and printer come in later cards.

pub mod lexer;

pub use lexer::{Token, TokenKind, lex};
