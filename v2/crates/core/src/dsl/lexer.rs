//! Lexer for the plan DSL (spec §7.1, lexical level).
//!
//! Decisions:
//! - Lines and columns are 1-based. Columns count characters, not bytes.
//! - `INDENT` is a token emitted at column 1 when a non-blank line starts with
//!   spaces or tabs. Blank lines (only whitespace) produce just a `Newline`.
//! - `NEWLINE` is emitted for every line end. A last line without a line end
//!   still gets a `Newline` at end of file if it holds any token.
//! - Spaces, tabs and `\r` between tokens are skipped.
//! - Keywords are the lower-case words from the grammar. Any other word that
//!   starts with a letter is a `Name`. The single word `x` lexes as `X`, the
//!   size separator, so a room cannot be named `x`. An `x` directly after a
//!   digit (`3000x2000`) is also `X`, even though it could start a name.
//! - `INT` is digits (mm). `digits.digits` followed by `m` is metres, converted
//!   to mm; at most three decimals are allowed so the result is exact.
//! - A `STRING` may not contain a line end. An unterminated string is an error.
//! - Comments run from `#` to the end of the line; the token text is what
//!   follows `#`.
//! - A character that starts no token (for example `*`) is not a lexer error.
//!   It becomes a `TokenKind::Unknown` token with its span, and the parser
//!   reports it as E006 with the text the grammar needs at that point.
//! - Other lexical errors stop lexing at the first error. It returns `Err` with
//!   one E006 diagnostic and no tokens. The error span is the position of the
//!   offending character.

use serde_json::json;

use crate::diagnostics::{Code, Diagnostic, Severity, Span, message};

/// Keywords from the §7.1 grammar. Lower case only.
const KEYWORDS: &[&str] = &[
    "plan",
    "title",
    "default_wall",
    "default_outer_wall",
    "room",
    "apartment",
    "part",
    "east_of",
    "west_of",
    "south_of",
    "north_of",
    "open",
    "gap",
    "align",
    "measure",
    "to",
    "reference",
    "door",
    "window",
    "passage",
    "fixture",
    "stub",
    "length",
    "at",
    "width",
    "depth",
    "offset",
    "label",
    "height",
    "hinge",
    "opens",
    "wall",
    "thickness",
    "bearing",
    "fire",
    "north",
    "east",
    "south",
    "west",
    "source",
    "laser",
    "tape",
    "printed",
    "drawing",
    "estimated",
    "assumed",
    "tol",
    "existing",
    "demolish",
    "new",
];

/// One lexical token and where its first character sits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Token {
    /// What the token is.
    pub kind: TokenKind,
    /// 1-based line and column of the first character.
    pub span: Span,
}

/// Token kinds for the §7.1 lexical level.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TokenKind {
    /// Leading whitespace at the start of a non-blank line.
    Indent,
    /// A reserved word, for example `"room"` or `"north"`.
    Keyword(&'static str),
    /// A name: a letter, then letters, digits or `_`. Case-sensitive.
    Name(String),
    /// A length in mm. `1.86m` gives `Int(1860)`.
    Int(i64),
    /// A double-quoted string, without the quotes.
    Str(String),
    /// `.`
    Dot,
    /// `=`
    Eq,
    /// `?`
    Question,
    /// The size separator `x`.
    X,
    /// A comment, without the leading `#`.
    Comment(String),
    /// End of a line.
    Newline,
    /// A character that starts no token, for example `*`. The parser reports
    /// it as E006 where the grammar needs something else.
    Unknown(char),
}

/// Lex DSL source into tokens, or return the first E006 error.
pub fn lex(src: &str) -> Result<Vec<Token>, Diagnostic> {
    Lexer {
        chars: src.chars().collect(),
        pos: 0,
        line: 1,
        col: 1,
        at_line_start: true,
        line_has_tokens: false,
        out: Vec::new(),
    }
    .run()
}

struct Lexer {
    chars: Vec<char>,
    pos: usize,
    line: u32,
    col: u32,
    at_line_start: bool,
    line_has_tokens: bool,
    out: Vec<Token>,
}

impl Lexer {
    fn run(mut self) -> Result<Vec<Token>, Diagnostic> {
        loop {
            if self.at_line_start {
                self.at_line_start = false;
                self.indent();
            }
            let Some(c) = self.peek() else {
                if self.line_has_tokens {
                    let span = self.span();
                    self.push(TokenKind::Newline, span);
                }
                break;
            };
            match c {
                '\n' => {
                    let span = self.span();
                    self.bump();
                    self.push(TokenKind::Newline, span);
                    self.at_line_start = true;
                }
                ' ' | '\t' | '\r' => {
                    self.bump();
                }
                '#' => self.comment(),
                '"' => self.string()?,
                '0'..='9' => self.number()?,
                '.' => self.punct(TokenKind::Dot),
                '=' => self.punct(TokenKind::Eq),
                '?' => self.punct(TokenKind::Question),
                c if c.is_alphabetic() => self.word(),
                _ => {
                    let span = self.span();
                    self.bump();
                    self.push(TokenKind::Unknown(c), span);
                }
            }
        }
        Ok(self.out)
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn peek_at(&self, offset: usize) -> Option<char> {
        self.chars.get(self.pos + offset).copied()
    }

    fn span(&self) -> Span {
        Span {
            line: self.line,
            col: self.col,
        }
    }

    fn bump(&mut self) {
        if let Some(c) = self.peek() {
            self.pos += 1;
            if c == '\n' {
                self.line += 1;
                self.col = 1;
            } else {
                self.col += 1;
            }
        }
    }

    fn push(&mut self, kind: TokenKind, span: Span) {
        self.line_has_tokens = !matches!(kind, TokenKind::Newline);
        self.out.push(Token { kind, span });
    }

    fn punct(&mut self, kind: TokenKind) {
        let span = self.span();
        self.bump();
        self.push(kind, span);
    }

    /// Emit `Indent` when the line starts with blank space and has content.
    fn indent(&mut self) {
        let start = self.span();
        let mut width = 0usize;
        while matches!(self.peek(), Some(' ' | '\t' | '\r')) {
            self.bump();
            width += 1;
        }
        if width > 0 && !matches!(self.peek(), None | Some('\n')) {
            self.push(TokenKind::Indent, start);
        }
    }

    fn comment(&mut self) {
        let span = self.span();
        self.bump(); // '#'
        let mut text = String::new();
        while let Some(c) = self.peek() {
            if c == '\n' {
                break;
            }
            text.push(c);
            self.bump();
        }
        let text = text.trim_end_matches('\r').to_string();
        self.push(TokenKind::Comment(text), span);
    }

    fn string(&mut self) -> Result<(), Diagnostic> {
        let span = self.span();
        self.bump(); // opening quote
        let mut text = String::new();
        loop {
            match self.peek() {
                Some('"') => {
                    self.bump();
                    self.push(TokenKind::Str(text), span);
                    return Ok(());
                }
                Some('\n') | None => {
                    let at = self.span();
                    return Err(error(at, &quoted('"'), &describe(self.peek())));
                }
                Some(c) => {
                    text.push(c);
                    self.bump();
                }
            }
        }
    }

    fn digits(&mut self) -> String {
        let mut text = String::new();
        while let Some(c) = self.peek() {
            if !c.is_ascii_digit() {
                break;
            }
            text.push(c);
            self.bump();
        }
        text
    }

    fn number(&mut self) -> Result<(), Diagnostic> {
        let span = self.span();
        let whole_text = self.digits();
        let is_metres =
            self.peek() == Some('.') && self.peek_at(1).is_some_and(|c| c.is_ascii_digit());
        if !is_metres {
            let value = whole_text.parse::<i64>().map_err(|_| {
                error(
                    span,
                    "an integer that fits in 64 bits",
                    &quoted_text(&whole_text),
                )
            })?;
            self.push(TokenKind::Int(value), span);
            return Ok(());
        }

        self.bump(); // '.'
        let frac_text = self.digits();
        let shown = format!("{whole_text}.{frac_text}");
        if frac_text.len() > 3 {
            return Err(error(
                span,
                "at most three decimals in metres",
                &quoted_text(&shown),
            ));
        }
        if self.peek() != Some('m') {
            let at = self.span();
            return Err(error(at, &quoted('m'), &describe(self.peek())));
        }
        self.bump(); // 'm'
        if self.peek().is_some_and(is_name_char) {
            let at = self.span();
            let found = describe(self.peek());
            return Err(error(at, "end of length", &found));
        }

        let value = scaled_metres(&whole_text, &frac_text)
            .ok_or_else(|| error(span, "a length that fits in 64 bits", &quoted_text(&shown)))?;
        self.push(TokenKind::Int(value), span);
        Ok(())
    }

    fn word(&mut self) {
        let span = self.span();
        // `3000x2000`: an `x` directly after a digit is the size separator,
        // not the start of a name.
        if self.peek() == Some('x') && self.pos > 0 && self.chars[self.pos - 1].is_ascii_digit() {
            self.bump();
            self.push(TokenKind::X, span);
            return;
        }
        let mut text = String::new();
        while let Some(c) = self.peek() {
            if !is_name_char(c) {
                break;
            }
            text.push(c);
            self.bump();
        }
        let kind = if text == "x" {
            TokenKind::X
        } else if let Some(keyword) = KEYWORDS.iter().find(|k| **k == text) {
            TokenKind::Keyword(keyword)
        } else {
            TokenKind::Name(text)
        };
        self.push(kind, span);
    }
}

/// Letters (including åäöÅÄÖ), ASCII digits and `_`.
fn is_name_char(c: char) -> bool {
    c.is_alphabetic() || c.is_ascii_digit() || c == '_'
}

/// Convert `whole.frac` metres (frac has 1 to 3 digits) to mm.
fn scaled_metres(whole: &str, frac: &str) -> Option<i64> {
    let whole: i64 = whole.parse().ok()?;
    let frac: i64 = format!("{frac:0<3}").parse().ok()?;
    whole.checked_mul(1000)?.checked_add(frac)
}

/// Describe a character for the `found` part of an E006 message.
fn describe(c: Option<char>) -> String {
    match c {
        None => "end of file".to_string(),
        Some('\n') => "end of line".to_string(),
        Some(' ') => "space".to_string(),
        Some('\t') => "tab".to_string(),
        Some('\r') => "carriage return".to_string(),
        Some(c) => quoted(c),
    }
}

/// A single character in double quotes.
fn quoted(c: char) -> String {
    format!("\"{c}\"")
}

/// Text in double quotes.
fn quoted_text(text: &str) -> String {
    format!("\"{text}\"")
}

/// Build an E006 diagnostic at `span`.
fn error(span: Span, expected: &str, found: &str) -> Diagnostic {
    let args = [
        ("line", span.line.to_string()),
        ("col", span.col.to_string()),
        ("expected", expected.to_string()),
        ("found", found.to_string()),
    ];
    Diagnostic {
        code: Code::E006,
        severity: Severity::Error,
        message: message(Code::E006, &args),
        span: Some(span),
        refs: Vec::new(),
        data: json!({ "expected": expected, "found": found }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Token kinds for `src`. The lexer adds a `Newline` at end of file when
    /// the source does not end in a line break; this helper drops that one so
    /// the expectations only list the tokens the source spells out.
    fn kinds(src: &str) -> Vec<TokenKind> {
        let mut out: Vec<TokenKind> = lex(src)
            .expect("lex should succeed")
            .into_iter()
            .map(|t| t.kind)
            .collect();
        if !src.ends_with('\n') && out.last() == Some(&TokenKind::Newline) {
            out.pop();
        }
        out
    }

    fn name(text: &str) -> TokenKind {
        TokenKind::Name(text.to_string())
    }

    #[test]
    fn keywords_are_lower_case_tokens() {
        assert_eq!(
            kinds("measure north to"),
            vec![
                TokenKind::Keyword("measure"),
                TokenKind::Keyword("north"),
                TokenKind::Keyword("to"),
            ]
        );
    }

    #[test]
    fn capitalised_keyword_is_a_name() {
        assert_eq!(kinds("Room"), vec![name("Room")]);
    }

    #[test]
    fn name_with_swedish_letters() {
        assert_eq!(kinds("Förråd"), vec![name("Förråd")]);
    }

    #[test]
    fn names_are_case_sensitive() {
        assert_eq!(
            kinds("Hall hall HALL"),
            vec![name("Hall"), name("hall"), name("HALL")]
        );
    }

    #[test]
    fn name_with_digits_and_underscore() {
        assert_eq!(kinds("kitchen_2"), vec![name("kitchen_2")]);
    }

    #[test]
    fn plain_integer_is_mm() {
        assert_eq!(kinds("2400"), vec![TokenKind::Int(2400)]);
    }

    #[test]
    fn metre_form_is_mm() {
        assert_eq!(kinds("1.86m"), vec![TokenKind::Int(1860)]);
        assert_eq!(kinds("1.8m"), vec![TokenKind::Int(1800)]);
        assert_eq!(kinds("2.865m"), vec![TokenKind::Int(2865)]);
    }

    #[test]
    fn size_separator_x_directly_after_digits() {
        assert_eq!(
            kinds("3000x2000"),
            vec![TokenKind::Int(3000), TokenKind::X, TokenKind::Int(2000)]
        );
    }

    #[test]
    fn size_separator_x_and_punctuation() {
        assert_eq!(
            kinds("3000x2000 ? . ="),
            vec![
                TokenKind::Int(3000),
                TokenKind::X,
                TokenKind::Int(2000),
                TokenKind::Question,
                TokenKind::Dot,
                TokenKind::Eq,
            ]
        );
    }

    #[test]
    fn string_without_quotes_in_value() {
        assert_eq!(
            kinds("plan \"Villa Norr\""),
            vec![
                TokenKind::Keyword("plan"),
                TokenKind::Str("Villa Norr".to_string()),
            ]
        );
    }

    #[test]
    fn comment_runs_to_end_of_line() {
        assert_eq!(
            kinds("room A 1 # note\n"),
            vec![
                TokenKind::Keyword("room"),
                name("A"),
                TokenKind::Int(1),
                TokenKind::Comment(" note".to_string()),
                TokenKind::Newline,
            ]
        );
    }

    #[test]
    fn indent_on_leading_space_line() {
        let tokens = lex("  north_of Kitchen open\n").expect("lex");
        assert_eq!(tokens[0].kind, TokenKind::Indent);
        assert_eq!(tokens[0].span, Span { line: 1, col: 1 });
        assert_eq!(tokens[1].kind, TokenKind::Keyword("north_of"));
        assert_eq!(tokens[1].span, Span { line: 1, col: 3 });
    }

    #[test]
    fn blank_line_is_newline_without_indent() {
        assert_eq!(
            kinds("   \nroom"),
            vec![TokenKind::Newline, TokenKind::Keyword("room")]
        );
    }

    #[test]
    fn spans_are_one_based_per_line() {
        let tokens = lex("room\n  Hall").expect("lex");
        assert_eq!(tokens[0].span, Span { line: 1, col: 1 });
        assert_eq!(tokens[1].kind, TokenKind::Newline);
        assert_eq!(tokens[1].span, Span { line: 1, col: 5 });
        assert_eq!(tokens[2].kind, TokenKind::Indent);
        assert_eq!(tokens[2].span, Span { line: 2, col: 1 });
        assert_eq!(tokens[3].kind, name("Hall"));
        assert_eq!(tokens[3].span, Span { line: 2, col: 3 });
    }

    #[test]
    fn unknown_character_is_a_token_at_its_position() {
        let src = format!("{}*", "A".repeat(17));
        let tokens = lex(&format!("{}\n{src}", "\n".repeat(5))).expect("lex should succeed");
        let star = tokens
            .iter()
            .find(|t| t.kind == TokenKind::Unknown('*'))
            .expect("Unknown('*') token");
        assert_eq!(star.span, Span { line: 7, col: 18 });
    }

    #[test]
    fn metre_with_space_before_m_is_e006() {
        let diagnostic = lex("1.86 m").expect_err("E006");
        assert_eq!(diagnostic.span, Some(Span { line: 1, col: 5 }));
        assert_eq!(
            diagnostic.message,
            "Line 1, column 5: expected \"m\", found space."
        );
    }

    #[test]
    fn metre_with_x_suffix_is_e006() {
        let diagnostic = lex("1.8x").expect_err("E006");
        assert_eq!(diagnostic.span, Some(Span { line: 1, col: 4 }));
        assert_eq!(
            diagnostic.message,
            "Line 1, column 4: expected \"m\", found \"x\"."
        );
    }

    #[test]
    fn metre_with_too_many_decimals_is_e006() {
        let diagnostic = lex("1.8655m").expect_err("E006");
        assert_eq!(diagnostic.span, Some(Span { line: 1, col: 1 }));
    }

    #[test]
    fn unterminated_string_is_e006() {
        let diagnostic = lex("plan \"Villa\n").expect_err("E006");
        assert_eq!(diagnostic.span, Some(Span { line: 1, col: 12 }));
        assert_eq!(
            diagnostic.message,
            "Line 1, column 12: expected \"\"\", found end of line."
        );
    }
}
