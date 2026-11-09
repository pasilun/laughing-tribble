//! Plan DSL: the lexer (spec §7.1). Parser and printer come in later cards.

pub mod lexer;
pub mod parser;

pub use lexer::{Token, TokenKind, lex};
pub use parser::parse;
