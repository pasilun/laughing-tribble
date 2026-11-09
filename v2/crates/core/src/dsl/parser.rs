//! Parser for the plan DSL (spec §7.1): statements to [`Plan`].
//!
//! Decisions:
//! - [`parse`] stops at the first error and returns one diagnostic, like the
//!   lexer. Lexer errors pass through unchanged. Parse errors are E006.
//! - A duplicate room name gives E002 at the second declaration (spec §7.4),
//!   so a room is never silently overwritten.
//! - Indentation matters only for relations and `align`. An indented relation
//!   without a subject applies to the last declared room. An indented `align`
//!   puts that room first in its list.
//! - Defaults: `default_wall` 90 mm and `default_outer_wall` 300 mm, both
//!   `assumed` (spec §5.2 field comments). A plain `gap` takes `default_wall`
//!   once the whole file is read, so a `default_wall` line after the relation
//!   also applies.
//! - A quantity with no `source` clause is `assumed`. Without `tol`, the
//!   tolerance is the source's default.
//! - A room or opening with no phase is `existing`.
//! - A later `plan` or `default_*` line replaces an earlier one.
//! - A `found` token that is a number is shown by its mm value, so `1.86m`
//!   shows as `"1860"`.

use std::collections::BTreeMap;

use serde_json::json;

use crate::diagnostics::{Code, Diagnostic, Severity, Span, message};
use crate::intent::{
    FaceRef, Gap, Measure, Opening, OpeningKind, Phase, Plan, Relation, Room, RoomName, Side,
    WallOverride,
};
use crate::units::{Mm, Quantity, Source};

use super::resolve::{NameRef, resolve_names};
use super::{Token, TokenKind, lex};

/// What the grammar accepts after `relation`'s `rel_kw`, shown in E006 text.
const REL_LIST: &str = r#""east_of", "west_of", "south_of" or "north_of""#;
const GAP_LIST: &str = r#""open" or "gap""#;
const SIDE_LIST: &str = r#""north", "east", "south" or "west""#;
const SOURCE_LIST: &str = r#""laser", "tape", "printed", "drawing", "estimated" or "assumed""#;
const SIZE: &str = r#"a number or "?""#;

/// Parse DSL source into a [`Plan`].
///
/// Returns the first error as a diagnostic: an E006 for a lexical or grammar
/// error, an E002 for a room declared twice, or an E001 for a name that is not
/// a declared room (checked after the whole file is read).
pub fn parse(src: &str) -> Result<Plan, Diagnostic> {
    let tokens = lex(src)?;
    let mut builder = Builder::new();
    for line in split_lines(tokens) {
        let mut cur = Cursor {
            toks: line.toks,
            pos: 0,
            end: line.end,
        };
        statement(&mut cur, &mut builder, line.indented)?;
    }
    let refs = std::mem::take(&mut builder.refs);
    let plan = builder.finish();
    if let Err(errors) = resolve_names(&plan, &refs)
        && let Some(first) = errors.into_iter().next()
    {
        return Err(first);
    }
    Ok(plan)
}

/// One statement line without its `Indent`, `Comment` and `Newline` tokens.
struct Line {
    toks: Vec<Token>,
    indented: bool,
    /// Position of the line end, for "found end of line".
    end: Span,
}

fn split_lines(tokens: Vec<Token>) -> Vec<Line> {
    let mut lines = Vec::new();
    let mut toks = Vec::new();
    let mut indented = false;
    for token in tokens {
        match token.kind {
            TokenKind::Newline => {
                if !toks.is_empty() {
                    lines.push(Line {
                        toks: std::mem::take(&mut toks),
                        indented,
                        end: token.span,
                    });
                }
                indented = false;
            }
            TokenKind::Indent => indented = true,
            TokenKind::Comment(_) => {}
            _ => toks.push(token),
        }
    }
    lines
}

/// Parser state for the whole file.
struct Builder {
    plan: Plan,
    /// Line of each declared room, for E002.
    room_lines: BTreeMap<RoomName, u32>,
    /// The room an indented relation or align refers to.
    last_room: Option<RoomName>,
    /// Indexes into `plan.relations` whose plain `gap` takes `default_wall`.
    plain_gaps: Vec<usize>,
    /// Room names used in references, with their positions, for E001.
    refs: Vec<NameRef>,
}

impl Builder {
    fn new() -> Self {
        Builder {
            plan: Plan {
                name: String::new(),
                default_wall: assumed(90),
                default_outer_wall: assumed(300),
                rooms: BTreeMap::new(),
                order: Vec::new(),
                relations: Vec::new(),
                measures: Vec::new(),
                openings: Vec::new(),
                wall_overrides: Vec::new(),
            },
            room_lines: BTreeMap::new(),
            last_room: None,
            plain_gaps: Vec::new(),
            refs: Vec::new(),
        }
    }

    fn add_room(&mut self, span: Span, room: Room) -> Result<(), Diagnostic> {
        if let Some(first) = self.room_lines.get(&room.name) {
            return Err(duplicate_room(&room.name, *first, span));
        }
        self.room_lines.insert(room.name.clone(), span.line);
        self.last_room = Some(room.name.clone());
        self.plan.order.push(room.name.clone());
        self.plan.rooms.insert(room.name.clone(), room);
        Ok(())
    }

    fn finish(mut self) -> Plan {
        let wall = self.plan.default_wall;
        for index in self.plain_gaps {
            if let Some(relation) = self.plan.relations.get_mut(index) {
                set_gap(relation, Gap::Wall(wall));
            }
        }
        self.plan
    }
}

/// Cursor over the tokens of one line.
struct Cursor {
    toks: Vec<Token>,
    pos: usize,
    end: Span,
}

/// A `source` clause: the source and an optional explicit tolerance.
struct SrcSpec {
    source: Source,
    tolerance: Option<Mm>,
}

/// The direction of a relation keyword.
#[derive(Clone, Copy)]
enum Dir {
    East,
    West,
    South,
    North,
}

impl Cursor {
    /// The current token's kind, copied out. `None` at the end of the line.
    fn kind(&self) -> Option<TokenKind> {
        self.toks.get(self.pos).map(|t| t.kind.clone())
    }

    fn span(&self) -> Span {
        self.toks.get(self.pos).map_or(self.end, |t| t.span)
    }

    fn found(&self) -> String {
        match self.kind() {
            Some(kind) => describe(&kind),
            None => "end of line".to_string(),
        }
    }

    /// E006 at the current token.
    fn fail(&self, expected: &str) -> Diagnostic {
        e006(self.span(), expected, &self.found())
    }

    /// Step over the current token. Only call after it has been matched.
    fn skip(&mut self) {
        self.pos += 1;
    }

    fn opt_kw(&mut self, kw: &str) -> bool {
        if matches!(self.kind(), Some(TokenKind::Keyword(k)) if k == kw) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect_kw(&mut self, kw: &str) -> Result<(), Diagnostic> {
        if self.opt_kw(kw) {
            Ok(())
        } else {
            Err(self.fail(&quoted_text(kw)))
        }
    }

    /// Consume a punctuation token. `shown` is its text, without quotes.
    fn expect_tok(&mut self, want: TokenKind, shown: &str) -> Result<(), Diagnostic> {
        if self.kind().as_ref() == Some(&want) {
            self.pos += 1;
            Ok(())
        } else {
            Err(self.fail(&quoted_text(shown)))
        }
    }

    /// A room name. Names the lexer accepts but `RoomName` rejects (for
    /// example `é`) are E006 too.
    fn name(&mut self) -> Result<RoomName, Diagnostic> {
        match self.kind() {
            Some(TokenKind::Name(text)) => match RoomName::new(text.clone()) {
                Ok(name) => {
                    self.pos += 1;
                    Ok(name)
                }
                Err(_) => Err(e006(self.span(), "a room name", &quoted_text(&text))),
            },
            _ => Err(self.fail("a room name")),
        }
    }

    fn int(&mut self, expected: &str) -> Result<Mm, Diagnostic> {
        match self.kind() {
            Some(TokenKind::Int(value)) => {
                self.pos += 1;
                Ok(value)
            }
            _ => Err(self.fail(expected)),
        }
    }

    /// A room size: a number, or `?` for unknown (`None`).
    fn size(&mut self) -> Result<Option<Mm>, Diagnostic> {
        match self.kind() {
            Some(TokenKind::Int(value)) => {
                self.pos += 1;
                Ok(Some(value))
            }
            Some(TokenKind::Question) => {
                self.pos += 1;
                Ok(None)
            }
            _ => Err(self.fail(SIZE)),
        }
    }

    fn string(&mut self) -> Result<String, Diagnostic> {
        match self.kind() {
            Some(TokenKind::Str(text)) => {
                self.pos += 1;
                Ok(text)
            }
            _ => Err(self.fail("a quoted string")),
        }
    }

    fn side(&mut self) -> Result<Side, Diagnostic> {
        let side = match self.kind() {
            Some(TokenKind::Keyword("north")) => Side::North,
            Some(TokenKind::Keyword("east")) => Side::East,
            Some(TokenKind::Keyword("south")) => Side::South,
            Some(TokenKind::Keyword("west")) => Side::West,
            _ => return Err(self.fail(SIDE_LIST)),
        };
        self.pos += 1;
        Ok(side)
    }

    fn dir(&mut self) -> Result<Dir, Diagnostic> {
        let dir = match self.kind() {
            Some(TokenKind::Keyword("east_of")) => Dir::East,
            Some(TokenKind::Keyword("west_of")) => Dir::West,
            Some(TokenKind::Keyword("south_of")) => Dir::South,
            Some(TokenKind::Keyword("north_of")) => Dir::North,
            _ => return Err(self.fail(REL_LIST)),
        };
        self.pos += 1;
        Ok(dir)
    }

    /// A face: `NAME "." side`.
    fn face(&mut self) -> Result<FaceRef, Diagnostic> {
        let room = self.name()?;
        self.expect_tok(TokenKind::Dot, ".")?;
        let side = self.side()?;
        Ok(FaceRef { room, side })
    }

    /// `[ "source" kind [ "tol" INT ] ]`.
    fn src(&mut self) -> Result<Option<SrcSpec>, Diagnostic> {
        if !self.opt_kw("source") {
            return Ok(None);
        }
        let source = match self.kind() {
            Some(TokenKind::Keyword(kw)) => source_of(kw),
            _ => None,
        };
        let Some(source) = source else {
            return Err(self.fail(SOURCE_LIST));
        };
        self.pos += 1;
        let tolerance = if self.opt_kw("tol") {
            Some(self.int("a number")?)
        } else {
            None
        };
        Ok(Some(SrcSpec { source, tolerance }))
    }

    /// `[ phase ]`, or `None` when the line has no phase word.
    fn phase(&mut self) -> Option<Phase> {
        let phase = match self.kind() {
            Some(TokenKind::Keyword("existing")) => Phase::Existing,
            Some(TokenKind::Keyword("demolish")) => Phase::Demolish,
            Some(TokenKind::Keyword("new")) => Phase::New,
            _ => return None,
        };
        self.pos += 1;
        Some(phase)
    }

    /// `"open" | "gap" [ INT [ src ] ]`. `None` is a plain `gap`, which takes
    /// `default_wall` later.
    fn gapspec(&mut self) -> Result<Option<Gap>, Diagnostic> {
        if self.opt_kw("open") {
            return Ok(Some(Gap::Open));
        }
        if !self.opt_kw("gap") {
            return Err(self.fail(GAP_LIST));
        }
        if !matches!(self.kind(), Some(TokenKind::Int(_))) {
            return Ok(None);
        }
        let value = self.int("a number")?;
        let src = self.src()?;
        Ok(Some(Gap::Wall(quantity(value, src.as_ref()))))
    }

    /// Fails if tokens are left over on the line.
    fn finish(&self) -> Result<(), Diagnostic> {
        if self.pos < self.toks.len() {
            Err(self.fail("end of line"))
        } else {
            Ok(())
        }
    }
}

fn statement(cur: &mut Cursor, b: &mut Builder, indented: bool) -> Result<(), Diagnostic> {
    if matches!(cur.kind(), Some(TokenKind::Name(_))) {
        return relation(cur, b, indented);
    }
    let keyword = match cur.kind() {
        Some(TokenKind::Keyword(kw)) => kw,
        _ => {
            let expected = if indented {
                "a relation or align"
            } else {
                "a statement"
            };
            return Err(cur.fail(expected));
        }
    };
    match keyword {
        "east_of" | "west_of" | "south_of" | "north_of" => relation(cur, b, indented),
        "align" => align(cur, b, indented),
        _ if indented => Err(cur.fail("a relation or align")),
        "plan" => plan(cur, b),
        "default_wall" | "default_outer_wall" => default_stmt(cur, b, keyword),
        "room" => room(cur, b),
        "measure" => measure(cur, b),
        "door" => opening(cur, b, OpeningKind::Door),
        "window" => opening(cur, b, OpeningKind::Window),
        "passage" => opening(cur, b, OpeningKind::Passage),
        "wall" => wall(cur, b),
        _ => Err(cur.fail("a statement")),
    }
}

fn plan(cur: &mut Cursor, b: &mut Builder) -> Result<(), Diagnostic> {
    cur.skip();
    let name = cur.string()?;
    cur.finish()?;
    b.plan.name = name;
    Ok(())
}

fn default_stmt(cur: &mut Cursor, b: &mut Builder, keyword: &str) -> Result<(), Diagnostic> {
    cur.skip();
    let value = cur.int("a number")?;
    let src = cur.src()?;
    cur.finish()?;
    let quantity = quantity(value, src.as_ref());
    if keyword == "default_wall" {
        b.plan.default_wall = quantity;
    } else {
        b.plan.default_outer_wall = quantity;
    }
    Ok(())
}

fn room(cur: &mut Cursor, b: &mut Builder) -> Result<(), Diagnostic> {
    cur.skip();
    let span = cur.span();
    let name = cur.name()?;
    let width = cur.size()?;
    cur.expect_tok(TokenKind::X, "x")?;
    let depth = cur.size()?;
    let src = cur.src()?;
    let apartment = if cur.opt_kw("apartment") {
        Some(cur.string()?)
    } else {
        None
    };
    let phase = cur.phase().unwrap_or(Phase::Existing);
    cur.finish()?;
    let room = Room {
        name,
        width: width.map(|value| quantity(value, src.as_ref())),
        depth: depth.map(|value| quantity(value, src.as_ref())),
        apartment,
        phase,
    };
    b.add_room(span, room)
}

/// A room name used as a reference, kept for name resolution (E001).
fn reference(cur: &mut Cursor, b: &mut Builder) -> Result<RoomName, Diagnostic> {
    let span = cur.span();
    let name = cur.name()?;
    b.refs.push(NameRef {
        name: name.clone(),
        span,
    });
    Ok(name)
}

/// A face used as a reference; its room is kept for name resolution (E001).
fn face_ref(cur: &mut Cursor, b: &mut Builder) -> Result<FaceRef, Diagnostic> {
    let span = cur.span();
    let face = cur.face()?;
    b.refs.push(NameRef {
        name: face.room.clone(),
        span,
    });
    Ok(face)
}

fn relation(cur: &mut Cursor, b: &mut Builder, indented: bool) -> Result<(), Diagnostic> {
    let subject = if matches!(cur.kind(), Some(TokenKind::Name(_))) {
        reference(cur, b)?
    } else {
        match (indented, &b.last_room) {
            (true, Some(room)) => room.clone(),
            _ => return Err(cur.fail("a room name")),
        }
    };
    let dir = cur.dir()?;
    let of = reference(cur, b)?;
    let gap = match cur.gapspec()? {
        Some(gap) => gap,
        None => {
            b.plain_gaps.push(b.plan.relations.len());
            // Placeholder, replaced by `default_wall` in `Builder::finish`.
            Gap::Open
        }
    };
    cur.finish()?;
    let relation = match dir {
        Dir::East => Relation::EastOf { subject, of, gap },
        Dir::West => Relation::WestOf { subject, of, gap },
        Dir::South => Relation::SouthOf { subject, of, gap },
        Dir::North => Relation::NorthOf { subject, of, gap },
    };
    b.plan.relations.push(relation);
    Ok(())
}

fn align(cur: &mut Cursor, b: &mut Builder, indented: bool) -> Result<(), Diagnostic> {
    // Indented: the last room comes first in the list.
    let last = match (indented, &b.last_room) {
        (true, Some(room)) => Some(room.clone()),
        (true, None) => return Err(cur.fail("a room name")),
        _ => None,
    };
    cur.skip();
    let side = cur.side()?;
    let mut rooms: Vec<RoomName> = last.into_iter().collect();
    rooms.push(reference(cur, b)?);
    while matches!(cur.kind(), Some(TokenKind::Name(_))) {
        rooms.push(reference(cur, b)?);
    }
    cur.finish()?;
    b.plan.relations.push(Relation::Align { side, rooms });
    Ok(())
}

fn measure(cur: &mut Cursor, b: &mut Builder) -> Result<(), Diagnostic> {
    cur.skip();
    let from = face_ref(cur, b)?;
    cur.expect_kw("to")?;
    let to = face_ref(cur, b)?;
    cur.expect_tok(TokenKind::Eq, "=")?;
    let value = cur.int("a number")?;
    let src = cur.src()?;
    let reference = cur.opt_kw("reference");
    cur.finish()?;
    b.plan.measures.push(Measure {
        from,
        to,
        value: quantity(value, src.as_ref()),
        reference,
    });
    Ok(())
}

fn opening(cur: &mut Cursor, b: &mut Builder, kind: OpeningKind) -> Result<(), Diagnostic> {
    cur.skip();
    let face = face_ref(cur, b)?;
    cur.expect_kw("at")?;
    let at = cur.int("a number")?;
    cur.expect_kw("width")?;
    let width = cur.int("a number")?;
    let height = if cur.opt_kw("height") {
        Some(cur.int("a number")?)
    } else {
        None
    };
    let hinge = if cur.opt_kw("hinge") {
        Some(cur.side()?)
    } else {
        None
    };
    let opens_into = if cur.opt_kw("opens") {
        Some(reference(cur, b)?)
    } else {
        None
    };
    let src = cur.src()?;
    let phase = cur.phase().unwrap_or(Phase::Existing);
    cur.finish()?;
    b.plan.openings.push(Opening {
        kind,
        face,
        at: quantity(at, src.as_ref()),
        width: quantity(width, src.as_ref()),
        height,
        hinge,
        opens_into,
        phase,
    });
    Ok(())
}

fn wall(cur: &mut Cursor, b: &mut Builder) -> Result<(), Diagnostic> {
    cur.skip();
    let face = face_ref(cur, b)?;
    cur.expect_kw("thickness")?;
    let value = cur.int("a number")?;
    let src = cur.src()?;
    cur.finish()?;
    b.plan.wall_overrides.push(WallOverride {
        face,
        thickness: quantity(value, src.as_ref()),
    });
    Ok(())
}

/// Replace the gap of a placement relation. `align` has no gap and is left as is.
fn set_gap(relation: &mut Relation, new_gap: Gap) {
    match relation {
        Relation::EastOf { gap, .. }
        | Relation::WestOf { gap, .. }
        | Relation::SouthOf { gap, .. }
        | Relation::NorthOf { gap, .. } => *gap = new_gap,
        Relation::Align { .. } => {}
    }
}

/// Quantity from a value and an optional `source` clause. No clause means
/// `assumed`.
fn quantity(value: Mm, src: Option<&SrcSpec>) -> Quantity {
    let (source, tolerance) = match src {
        Some(spec) => (
            spec.source,
            spec.tolerance
                .unwrap_or_else(|| spec.source.default_tolerance()),
        ),
        None => (Source::Assumed, Source::Assumed.default_tolerance()),
    };
    Quantity {
        value,
        source,
        tolerance,
    }
}

fn assumed(value: Mm) -> Quantity {
    quantity(value, None)
}

fn source_of(keyword: &str) -> Option<Source> {
    match keyword {
        "laser" => Some(Source::Laser),
        "tape" => Some(Source::Tape),
        "printed" => Some(Source::Printed),
        "drawing" => Some(Source::Drawing),
        "estimated" => Some(Source::Estimated),
        "assumed" => Some(Source::Assumed),
        _ => None,
    }
}

/// Describe a token for the `found` part of an E006 message.
fn describe(kind: &TokenKind) -> String {
    match kind {
        TokenKind::Indent => "indentation".to_string(),
        TokenKind::Keyword(kw) => quoted_text(kw),
        TokenKind::Name(name) => quoted_text(name),
        TokenKind::Int(value) => quoted_text(&value.to_string()),
        TokenKind::Str(text) => format!("\"{text}\""),
        TokenKind::Dot => quoted_text("."),
        TokenKind::Eq => quoted_text("="),
        TokenKind::Question => quoted_text("?"),
        TokenKind::X => quoted_text("x"),
        TokenKind::Comment(_) => "a comment".to_string(),
        TokenKind::Newline => "end of line".to_string(),
        TokenKind::Unknown(c) => quoted_text(&c.to_string()),
    }
}

/// Text in double quotes.
fn quoted_text(text: &str) -> String {
    format!("\"{text}\"")
}

/// Build an E006 diagnostic. The text follows `Line {line}, column {col}:
/// expected {expected}, found {found}.` (spec §7.3).
fn e006(span: Span, expected: &str, found: &str) -> Diagnostic {
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

/// Build an E002 diagnostic for a room declared twice.
fn duplicate_room(name: &RoomName, first: u32, span: Span) -> Diagnostic {
    let args = [
        ("name", name.to_string()),
        ("a", first.to_string()),
        ("b", span.line.to_string()),
    ];
    Diagnostic {
        code: Code::E002,
        severity: Severity::Error,
        message: message(Code::E002, &args),
        span: Some(span),
        refs: vec![name.to_string()],
        data: json!({ "name": name.as_str(), "lines": [first, span.line] }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_A: &str = include_str!("../../../../fixtures/lgh154-a.plan");
    const FIXTURE_B: &str = include_str!("../../../../fixtures/lgh154-b.plan");
    const FIXTURE_C: &str = include_str!("../../../../fixtures/lgh154-c.plan");

    fn name(text: &str) -> RoomName {
        RoomName::new(text).expect("valid room name")
    }

    fn room<'a>(plan: &'a Plan, text: &str) -> &'a Room {
        plan.rooms.get(&name(text)).expect("room exists")
    }

    fn q(value: Mm, source: Source) -> Quantity {
        Quantity {
            value,
            source,
            tolerance: source.default_tolerance(),
        }
    }

    fn face(room: &str, side: Side) -> FaceRef {
        FaceRef {
            room: name(room),
            side,
        }
    }

    fn e006_of(src: &str) -> Diagnostic {
        parse(src).expect_err("expected an E006 error")
    }

    #[test]
    fn fixture_a_parses_rooms_relations_openings() {
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        assert_eq!(plan.name, "Gnejsen lgh 154, existing (laser 2026-11-07)");
        assert_eq!(plan.order.len(), 5);
        assert_eq!(room(&plan, "Garderob").width, Some(q(1860, Source::Laser)));
        assert_eq!(room(&plan, "Sovrum").depth, Some(q(2090, Source::Laser)));
        assert_eq!(room(&plan, "Hall").depth, None);
        assert_eq!(room(&plan, "Hall").phase, Phase::Existing);

        assert_eq!(plan.default_wall, assumed(90));
        assert_eq!(plan.default_outer_wall, assumed(300));

        assert_eq!(plan.relations.len(), 9);
        assert_eq!(
            plan.relations[0],
            Relation::SouthOf {
                subject: name("Sovrum"),
                of: name("Garderob"),
                gap: Gap::Wall(assumed(90)),
            }
        );
        // Indented align: the last room (Sovrum) comes first.
        assert_eq!(
            plan.relations[1],
            Relation::Align {
                side: Side::West,
                rooms: vec![name("Sovrum"), name("Garderob")],
            }
        );
        assert_eq!(
            plan.relations[2],
            Relation::EastOf {
                subject: name("Hall"),
                of: name("Garderob"),
                gap: Gap::Wall(q(121, Source::Drawing)),
            }
        );
        assert_eq!(
            plan.relations[6],
            Relation::SouthOf {
                subject: name("Vardagsrum"),
                of: name("Hall"),
                gap: Gap::Open,
            }
        );

        assert_eq!(plan.openings.len(), 4);
        let door = &plan.openings[2];
        assert_eq!(door.kind, OpeningKind::Door);
        assert_eq!(door.face, face("WC", Side::West));
        assert_eq!(door.at, q(240, Source::Estimated));
        assert_eq!(door.width, q(450, Source::Estimated));
        assert_eq!(door.height, None);
        assert_eq!(door.hinge, Some(Side::South));
        assert_eq!(door.opens_into, Some(name("Hall")));
        assert!(plan.measures.is_empty());
        assert!(plan.wall_overrides.is_empty());
    }

    #[test]
    fn fixture_b_parses_measure() {
        let plan = parse(FIXTURE_B).expect("fixture B parses");
        assert_eq!(plan.rooms.len(), 5);
        assert_eq!(plan.measures.len(), 1);
        assert_eq!(
            plan.measures[0],
            Measure {
                from: face("Garderob", Side::North),
                to: face("Sovrum", Side::South),
                value: q(4490, Source::Laser),
                reference: false,
            }
        );
    }

    #[test]
    fn fixture_c_parses_align() {
        let plan = parse(FIXTURE_C).expect("fixture C parses");
        assert_eq!(plan.relations.len(), 10);
        assert_eq!(
            plan.relations.last(),
            Some(&Relation::Align {
                side: Side::South,
                rooms: vec![name("Sovrum"), name("Vardagsrum")],
            })
        );
    }

    #[test]
    fn defaults_apply_when_not_stated() {
        let plan =
            parse("room A 1000 x 2000\nroom B 1000 x 2000\n  east_of A gap\n").expect("parse");
        assert_eq!(plan.name, "");
        assert_eq!(plan.default_wall, assumed(90));
        assert_eq!(plan.default_outer_wall, assumed(300));
        assert_eq!(
            plan.relations[0],
            Relation::EastOf {
                subject: name("B"),
                of: name("A"),
                gap: Gap::Wall(assumed(90)),
            }
        );
    }

    #[test]
    fn plain_gap_takes_default_wall_stated_later() {
        let plan =
            parse("room A 1000 x 2000\nroom B 1000 x 2000\n  east_of A gap\ndefault_wall 120\n")
                .expect("parse");
        assert_eq!(
            plan.relations[0],
            Relation::EastOf {
                subject: name("B"),
                of: name("A"),
                gap: Gap::Wall(assumed(120)),
            }
        );
    }

    #[test]
    fn metre_lengths_and_source_clause() {
        let plan = parse("room Hall 1.86m x 2.1m source laser tol 5 existing\n").expect("parse");
        let hall = room(&plan, "Hall");
        assert_eq!(
            hall.width,
            Some(Quantity {
                value: 1860,
                source: Source::Laser,
                tolerance: 5,
            })
        );
        // One `source` clause covers both sizes, so the explicit tol applies to both.
        assert_eq!(
            hall.depth,
            Some(Quantity {
                value: 2100,
                source: Source::Laser,
                tolerance: 5,
            })
        );
        assert_eq!(hall.phase, Phase::Existing);
    }

    #[test]
    fn duplicate_room_is_e002() {
        let d = e006_of("room A 1 x 2\nroom A 3 x 4\n");
        assert_eq!(d.code, Code::E002);
        assert_eq!(d.message, r#"Room "A" is declared twice (lines 1 and 2)."#);
    }

    #[test]
    fn e006_statement_must_start_with_keyword_or_name() {
        let d = e006_of("1100 x 2000\n");
        assert_eq!(d.code, Code::E006);
        assert_eq!(
            d.message,
            r#"Line 1, column 1: expected a statement, found "1100"."#
        );
    }

    #[test]
    fn e006_room_size_separator_is_x() {
        let d = e006_of("room Hall 1100 2000\n");
        assert_eq!(d.code, Code::E006);
        assert_eq!(
            d.message,
            r#"Line 1, column 16: expected "x", found "2000"."#
        );
    }

    #[test]
    fn e006_unknown_character_where_size_separator_is_needed() {
        let d = e006_of("room A 3000 * 2000\n");
        assert_eq!(d.code, Code::E006);
        assert_eq!(d.message, r#"Line 1, column 13: expected "x", found "*"."#);
    }

    #[test]
    fn e006_room_size_must_be_number_or_question_mark() {
        let d = e006_of("room Hall abc x 2000\n");
        assert_eq!(d.code, Code::E006);
        assert_eq!(
            d.message,
            r#"Line 1, column 11: expected a number or "?", found "abc"."#
        );
    }

    #[test]
    fn e006_source_needs_a_kind_at_end_of_line() {
        let d = e006_of("room Hall 1100 x 2000 source\n");
        assert_eq!(d.code, Code::E006);
        assert_eq!(
            d.message,
            r#"Line 1, column 29: expected "laser", "tape", "printed", "drawing", "estimated" or "assumed", found end of line."#
        );
    }

    #[test]
    fn e006_measure_face_needs_a_dot_and_side() {
        let d = e006_of("measure Garderob.north to Sovrum = 4490\n");
        assert_eq!(d.code, Code::E006);
        assert_eq!(d.message, r#"Line 1, column 34: expected ".", found "="."#);
    }

    #[test]
    fn e006_opening_needs_at() {
        let d = e006_of("window Sovrum.south 380 width 1350\n");
        assert_eq!(d.code, Code::E006);
        assert_eq!(
            d.message,
            r#"Line 1, column 21: expected "at", found "380"."#
        );
    }

    #[test]
    fn e006_relation_needs_open_or_gap() {
        let d = e006_of("room A 1 x 2\n  south_of B\n");
        assert_eq!(d.code, Code::E006);
        assert_eq!(
            d.message,
            r#"Line 2, column 13: expected "open" or "gap", found end of line."#
        );
    }

    #[test]
    fn e006_string_token_found_is_quoted_once() {
        // `"A"` starts at column 6 (r=1 ... space=5, quote=6).
        let d = e006_of("room \"A\" 1 x 2\n");
        assert_eq!(d.code, Code::E006);
        assert_eq!(
            d.message,
            r#"Line 1, column 6: expected a room name, found "A"."#
        );
    }

    #[test]
    fn e006_plan_needs_a_quoted_name() {
        let d = e006_of("plan Villa\n");
        assert_eq!(d.code, Code::E006);
        assert_eq!(
            d.message,
            r#"Line 1, column 6: expected a quoted string, found "Villa"."#
        );
    }
}
