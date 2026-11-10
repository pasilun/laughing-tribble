//! DSL patches: `apply(plan, patch, dry_run)` (spec §10 and §10.1).
//!
//! A patch is DSL text with one statement per line. Each statement replaces the
//! statement of the plan with the same key (§10.1), or is added when there is
//! none. A line `- <statement>` removes the statement with that key. Blank lines
//! are skipped, and so are comments the DSL allows.
//!
//! Each line is parsed on its own, against the rooms the plan has at that point
//! (so a patch can add a room and then use it). An indented relation or align
//! belongs to the last `room` line of the patch, as in the file parser (§7.1).
//! The plan given to [`apply`] is
//! never changed. The result is all-or-nothing: if any line fails to parse or
//! resolving the new plan gives an Error, `ok` is false and `plan` and
//! `resolved` are `None`.
//!
//! `dry_run` changes nothing in the result: the same plan and resolved model are
//! returned as when it is false. The caller must not write the returned plan
//! when `dry_run` is true; writing it is the caller's job.

use serde::Serialize;

use crate::diagnostics::{Code, Diagnostic, Severity, Span, message};
use crate::dsl::{parse, print};
use crate::intent::{
    FaceRef, Fixture, FixtureKind, Measure, Opening, OpeningKind, Plan, Relation, Room, RoomName,
    Side, WallOverride,
};
use crate::resolved::{Resolved, has_error, resolve};
use crate::units::Mm;

/// One statement of a patch, in the form the plan stores it.
#[derive(Clone, Debug, PartialEq)]
pub enum Statement {
    /// A `room` line.
    Room(Room),
    /// An `east_of`, `west_of`, `south_of`, `north_of` or `align` line.
    Relation(Relation),
    /// A `measure` line.
    Measure(Measure),
    /// A `door`, `window` or `passage` line.
    Opening(Opening),
    /// A `wall` line.
    Wall(WallOverride),
    /// A `fixture` line.
    Fixture(Fixture),
}

/// A change to a plan, as read from a patch line.
#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    /// Replace the statement with the same key, or add it.
    Set(Statement),
    /// Remove the statement with the same key.
    Remove(Statement),
}

/// What a patch did to one statement.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeOp {
    /// A new statement was added.
    Added,
    /// An existing statement was replaced.
    Replaced,
    /// A statement was removed.
    Removed,
}

/// One entry of the diff: a statement that a patch added, replaced or removed.
#[derive(Clone, Debug, Serialize)]
pub struct Change {
    /// What happened.
    pub op: ChangeOp,
    /// The kind of statement: `room`, `relation`, `align`, `measure`, `opening`,
    /// `wall`, `fixture` or `title`.
    pub kind: &'static str,
    /// The key of the statement, written as in the DSL, for example `room Hall`
    /// or `measure Garderob.north to Sovrum.south`.
    pub target: String,
}

/// The outcome of [`apply`].
#[derive(Clone, Debug, Serialize)]
pub struct ApplyResult {
    /// False if any Error diagnostic results; the plan is then unchanged.
    pub ok: bool,
    /// The new plan when `ok`, otherwise `None`.
    pub plan: Option<Plan>,
    /// The resolved model of the new plan when `ok`, otherwise `None`.
    pub resolved: Option<Resolved>,
    /// The statements the patch added, replaced or removed. Filled in even when
    /// `ok` is false, so a client can show what was rejected.
    pub diff: Vec<Change>,
    /// Every diagnostic: parse errors of the patch, then those of the resolved
    /// new plan.
    pub diagnostics: Vec<Diagnostic>,
}

/// Apply the DSL `patch` to `plan` (spec §10 and §10.1).
///
/// `plan` is not changed. See the module docs for `dry_run`.
pub fn apply(plan: &Plan, patch: &str, dry_run: bool) -> ApplyResult {
    // The result does not depend on `dry_run`; the caller decides whether to write.
    let _ = dry_run;

    let mut working = plan.clone();
    let mut diagnostics = Vec::new();
    let mut diff = Vec::new();
    // The last `room` line set by the patch so far. An indented line belongs to it (§7.1).
    let mut last_room: Option<RoomName> = None;

    for (index, raw) in patch.lines().enumerate() {
        let line = u32::try_from(index + 1).unwrap_or(u32::MAX);
        let text = raw.trim();
        if text.is_empty() {
            continue;
        }
        let indent = &raw[..raw.len() - raw.trim_start().len()];
        let (remove, body) = match text.strip_prefix('-') {
            Some(rest) if rest.starts_with(char::is_whitespace) => (true, rest.trim_start()),
            _ => (false, text),
        };
        // A title line is keyed by its KEY (§15 D41), not by a statement kind.
        if body.split_whitespace().next() == Some("title") {
            match parse_title(body, remove, line) {
                Ok((key, text)) => {
                    diff.extend(set_title(&mut working, key, text, remove));
                }
                Err(diagnostic) => diagnostics.push(diagnostic),
            }
            continue;
        }
        let source = match anchored(body, indent, last_room.as_ref(), line) {
            Ok(source) => source,
            Err(diagnostic) => {
                diagnostics.push(diagnostic);
                continue;
            }
        };
        match parse_statement(&working, &source, line) {
            Ok(statement) => {
                if let (false, Statement::Room(room)) = (remove, &statement) {
                    last_room = Some(room.name.clone());
                }
                let command = if remove {
                    Command::Remove(statement)
                } else {
                    Command::Set(statement)
                };
                run_command(&mut working, command, line, &mut diff, &mut diagnostics);
            }
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }

    let (resolved, resolve_diagnostics) = if has_error(&diagnostics) {
        (None, Vec::new())
    } else {
        resolve(&working)
    };
    diagnostics.extend(resolve_diagnostics);

    let ok = !has_error(&diagnostics) && resolved.is_some();
    ApplyResult {
        ok,
        plan: ok.then_some(working),
        resolved: if ok { resolved } else { None },
        diff,
        diagnostics,
    }
}

/// Apply one command to `working`, recording the change or an E001 for a room
/// that a remaining statement still uses.
fn run_command(
    working: &mut Plan,
    command: Command,
    line: u32,
    diff: &mut Vec<Change>,
    diagnostics: &mut Vec<Diagnostic>,
) {
    match command {
        Command::Set(statement) => {
            let change = set_statement(working, statement);
            diff.push(change);
        }
        Command::Remove(statement) => {
            if let Some(change) = remove_statement(working, statement, line, diagnostics) {
                diff.push(change);
            }
        }
    }
}

/// Parse a `title KEY "TEXT"` line (without any `- ` prefix) into its key and
/// text. For a removal the text is ignored, so `- title KEY` is enough.
fn parse_title(body: &str, remove: bool, line: u32) -> Result<(String, String), Diagnostic> {
    let words: Vec<&str> = body.split_whitespace().collect();
    let source = match (remove, words.get(1)) {
        (true, Some(key)) => format!("{}title {key} \"\"\n", padding(line)),
        _ => format!("{}{body}\n", padding(line)),
    };
    let parsed = parse(&source)?;
    parsed
        .title
        .into_iter()
        .next()
        .ok_or_else(|| not_a_statement(body, line))
}

/// Set or remove the title text for `key`. Setting replaces or adds. Removing
/// a key that is not in the plan gives no change, as for other statements.
fn set_title(plan: &mut Plan, key: String, text: String, remove: bool) -> Option<Change> {
    let target = format!("title {key}");
    let op = if remove {
        plan.title.remove(&key)?;
        ChangeOp::Removed
    } else if plan.title.insert(key, text).is_some() {
        ChangeOp::Replaced
    } else {
        ChangeOp::Added
    };
    Some(Change {
        op,
        kind: "title",
        target,
    })
}

/// Replace or add a statement, by its key.
fn set_statement(plan: &mut Plan, statement: Statement) -> Change {
    let target = describe(&statement);
    let kind = kind_of(&statement);
    let op = match statement {
        Statement::Room(room) => {
            let name = room.name.clone();
            let op = if plan.rooms.contains_key(&name) {
                ChangeOp::Replaced
            } else {
                plan.order.push(name.clone());
                ChangeOp::Added
            };
            plan.rooms.insert(name, room);
            op
        }
        Statement::Relation(relation) => upsert(&mut plan.relations, relation, relation_key),
        Statement::Measure(measure) => upsert(&mut plan.measures, measure, measure_key),
        Statement::Opening(opening) => upsert(&mut plan.openings, opening, opening_key),
        Statement::Wall(wall) => upsert(&mut plan.wall_overrides, wall, wall_key),
        Statement::Fixture(fixture) => upsert(&mut plan.fixtures, fixture, fixture_key),
    };
    Change { op, kind, target }
}

/// Remove the statement with the same key. A statement that is not in the plan
/// is left alone and gives no change. A room that another statement still uses
/// gives E001 at the patch line, and nothing is removed.
fn remove_statement(
    plan: &mut Plan,
    statement: Statement,
    line: u32,
    diagnostics: &mut Vec<Diagnostic>,
) -> Option<Change> {
    let target = describe(&statement);
    let kind = kind_of(&statement);
    let removed = match statement {
        Statement::Room(room) => {
            if !plan.rooms.contains_key(&room.name) {
                return None;
            }
            if refers_to(plan, &room.name) {
                diagnostics.push(unknown_room_after_removal(&room.name, line));
                return None;
            }
            plan.rooms.remove(&room.name);
            plan.order.retain(|name| name != &room.name);
            true
        }
        Statement::Relation(relation) => {
            remove(&mut plan.relations, &relation_key(&relation), relation_key)
        }
        Statement::Measure(measure) => {
            remove(&mut plan.measures, &measure_key(&measure), measure_key)
        }
        Statement::Opening(opening) => {
            remove(&mut plan.openings, &opening_key(&opening), opening_key)
        }
        Statement::Wall(wall) => remove(&mut plan.wall_overrides, &wall_key(&wall), wall_key),
        Statement::Fixture(fixture) => {
            remove(&mut plan.fixtures, &fixture_key(&fixture), fixture_key)
        }
    };
    removed.then_some(Change {
        op: ChangeOp::Removed,
        kind,
        target,
    })
}

/// Replace the first item with the same key, or push the item.
fn upsert<T>(list: &mut Vec<T>, item: T, key_of: fn(&T) -> Key) -> ChangeOp {
    let key = key_of(&item);
    match list.iter().position(|existing| key_of(existing) == key) {
        Some(index) => {
            if let Some(slot) = list.get_mut(index) {
                *slot = item;
            }
            ChangeOp::Replaced
        }
        None => {
            list.push(item);
            ChangeOp::Added
        }
    }
}

/// Remove the first item with the key. True when one was removed.
fn remove<T>(list: &mut Vec<T>, key: &Key, key_of: fn(&T) -> Key) -> bool {
    match list.iter().position(|existing| &key_of(existing) == key) {
        Some(index) => {
            list.remove(index);
            true
        }
        None => false,
    }
}

/// The key of a statement (§10.1). Two statements with equal keys replace each other.
#[derive(Clone, Debug, PartialEq)]
enum Key {
    /// A relation, by (subject, kind, of).
    Relation(RoomName, &'static str, RoomName),
    /// An align, by (side, first room).
    Align(Side, Option<RoomName>),
    /// A measure, by (from, to).
    Measure(FaceRef, FaceRef),
    /// An opening, by (face, at in mm).
    Opening(FaceRef, Mm),
    /// A wall override, by face.
    Wall(FaceRef),
    /// A fixture, by (face, at, kind) (spec §10.1, §15 D44).
    Fixture(FaceRef, Mm, FixtureKind),
}

fn relation_key(relation: &Relation) -> Key {
    match relation {
        Relation::EastOf { subject, of, .. } => {
            Key::Relation(subject.clone(), "east_of", of.clone())
        }
        Relation::WestOf { subject, of, .. } => {
            Key::Relation(subject.clone(), "west_of", of.clone())
        }
        Relation::SouthOf { subject, of, .. } => {
            Key::Relation(subject.clone(), "south_of", of.clone())
        }
        Relation::NorthOf { subject, of, .. } => {
            Key::Relation(subject.clone(), "north_of", of.clone())
        }
        Relation::Align { side, rooms } => Key::Align(*side, rooms.first().cloned()),
    }
}

fn measure_key(measure: &Measure) -> Key {
    Key::Measure(measure.from.clone(), measure.to.clone())
}

fn opening_key(opening: &Opening) -> Key {
    Key::Opening(opening.face.clone(), opening.at.value)
}

fn wall_key(wall: &WallOverride) -> Key {
    Key::Wall(wall.face.clone())
}

fn fixture_key(fixture: &Fixture) -> Key {
    Key::Fixture(fixture.face.clone(), fixture.at, fixture.kind)
}

/// Parse one patch line (without its `- ` prefix) into one statement, using the
/// rooms of `working` as the names it may refer to.
///
/// The line is placed on its patch line number, so diagnostics point at the
/// patch. A line that is not one of the six statement kinds gives E006.
fn parse_statement(working: &Plan, body: &str, line: u32) -> Result<Statement, Diagnostic> {
    // A `room` line declares its own name, so that name is left out of the
    // context. Any other line sees every room of the plan.
    let declared = body
        .split_whitespace()
        .nth(1)
        .filter(|_| body.split_whitespace().next() == Some("room"))
        .map(str::to_string);

    let mut context = working.clone();
    context.title.clear();
    context.relations.clear();
    context.measures.clear();
    context.openings.clear();
    context.wall_overrides.clear();
    context.fixtures.clear();
    if let Some(name) = &declared {
        context.rooms.retain(|room, _| room.as_str() != name);
        context.order.retain(|room| room.as_str() != name);
    }
    let known: Vec<RoomName> = context.rooms.keys().cloned().collect();

    // The statement goes on its own patch line, with blank lines before it, so
    // parser messages name the right line. The room context follows it.
    let context_text = print(&context);
    let source = format!("{}{body}\n{context_text}", padding(line));
    let parsed = parse(&source)?;

    let mut found = Vec::new();
    for (name, room) in &parsed.rooms {
        if !known.contains(name) {
            found.push(Statement::Room(room.clone()));
        }
    }
    found.extend(parsed.relations.into_iter().map(Statement::Relation));
    found.extend(parsed.measures.into_iter().map(Statement::Measure));
    found.extend(parsed.openings.into_iter().map(Statement::Opening));
    found.extend(parsed.wall_overrides.into_iter().map(Statement::Wall));
    found.extend(parsed.fixtures.into_iter().map(Statement::Fixture));

    if found.len() != 1 {
        return Err(not_a_statement(body, line));
    }
    found.pop().ok_or_else(|| not_a_statement(body, line))
}

/// Blank lines that put the next text on patch line `line`, so parser messages
/// name the right line.
fn padding(line: u32) -> String {
    "\n".repeat(usize::try_from(line.saturating_sub(1)).unwrap_or(0))
}

/// The text the parser reads for a patch line body (§7.1).
///
/// An indented relation without a subject, or an indented align, belongs to the
/// last `room` line of the patch. The room is written in as the subject, or as
/// the first room of the align, which gives the statement the file parser gives
/// for the same text. With no room before it, the file parser's E006 is returned.
/// Other lines are returned as they are.
fn anchored(
    body: &str,
    indent: &str,
    room: Option<&RoomName>,
    line: u32,
) -> Result<String, Diagnostic> {
    let words: Vec<&str> = body.split_whitespace().collect();
    let first = words.first().copied().unwrap_or_default();
    let belongs_to_room = !indent.is_empty()
        && (first == "align" || matches!(first, "east_of" | "west_of" | "south_of" | "north_of"));
    if !belongs_to_room {
        return Ok(body.to_string());
    }
    let Some(room) = room else {
        // The parser has no room to give this line, so it gives its E006.
        let source = format!("{}{indent}{body}\n", padding(line));
        return match parse(&source) {
            Err(diagnostic) => Err(diagnostic),
            Ok(_) => Err(not_a_statement(body, line)),
        };
    };
    match words.get(1) {
        Some(side) if first == "align" => {
            let rest: Vec<&str> = words.iter().skip(2).copied().collect();
            Ok(format!("align {side} {room} {}", rest.join(" ")))
        }
        _ if first == "align" => Ok(body.to_string()),
        _ => Ok(format!("{room} {body}")),
    }
}

/// E006 for a patch line that is not a room, relation, align, measure, opening or wall.
fn not_a_statement(body: &str, line: u32) -> Diagnostic {
    let span = Span { line, col: 1 };
    let found = body.split_whitespace().next().unwrap_or("end of line");
    let expected = "a room, relation, align, measure, opening or wall statement";
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
        data: serde_json::json!({ "expected": expected, "found": found }),
    }
}

/// E001 for a room removed by a patch while another statement still uses it.
fn unknown_room_after_removal(name: &RoomName, line: u32) -> Diagnostic {
    let span = Span { line, col: 1 };
    let args = [("name", name.to_string()), ("line", line.to_string())];
    Diagnostic {
        code: Code::E001,
        severity: Severity::Error,
        message: message(Code::E001, &args),
        span: Some(span),
        refs: vec![name.to_string()],
        data: serde_json::json!({ "name": name.to_string() }),
    }
}

/// True when a relation, measure, opening or wall override still names `name`.
fn refers_to(plan: &Plan, name: &RoomName) -> bool {
    let relation_uses = plan.relations.iter().any(|relation| match relation {
        Relation::EastOf { subject, of, .. }
        | Relation::WestOf { subject, of, .. }
        | Relation::SouthOf { subject, of, .. }
        | Relation::NorthOf { subject, of, .. } => subject == name || of == name,
        Relation::Align { rooms, .. } => rooms.contains(name),
    });
    relation_uses
        || plan
            .measures
            .iter()
            .any(|m| &m.from.room == name || &m.to.room == name)
        || plan
            .openings
            .iter()
            .any(|o| &o.face.room == name || o.opens_into.as_ref() == Some(name))
        || plan.wall_overrides.iter().any(|w| &w.face.room == name)
        || plan.fixtures.iter().any(|f| &f.face.room == name)
}

/// The kind word of a statement, for the diff.
fn kind_of(statement: &Statement) -> &'static str {
    match statement {
        Statement::Room(_) => "room",
        Statement::Relation(Relation::Align { .. }) => "align",
        Statement::Relation(_) => "relation",
        Statement::Measure(_) => "measure",
        Statement::Opening(_) => "opening",
        Statement::Wall(_) => "wall",
        Statement::Fixture(_) => "fixture",
    }
}

/// The key of a statement written as in the DSL, for the diff.
fn describe(statement: &Statement) -> String {
    match statement {
        Statement::Room(room) => format!("room {}", room.name),
        Statement::Relation(relation) => match relation {
            Relation::EastOf { subject, of, .. } => format!("{subject} east_of {of}"),
            Relation::WestOf { subject, of, .. } => format!("{subject} west_of {of}"),
            Relation::SouthOf { subject, of, .. } => format!("{subject} south_of {of}"),
            Relation::NorthOf { subject, of, .. } => format!("{subject} north_of {of}"),
            Relation::Align { side, rooms } => {
                let names: Vec<String> = rooms.iter().map(ToString::to_string).collect();
                format!("align {} {}", side_word(*side), names.join(" "))
            }
        },
        Statement::Measure(measure) => format!(
            "measure {} to {}",
            face_text(&measure.from),
            face_text(&measure.to)
        ),
        Statement::Opening(opening) => format!(
            "{} {} at {}",
            opening_word(opening.kind),
            face_text(&opening.face),
            opening.at.value
        ),
        Statement::Wall(wall) => format!("wall {}", face_text(&wall.face)),
        Statement::Fixture(fixture) => format!(
            "fixture {} {} at {}",
            fixture.kind.word(),
            face_text(&fixture.face),
            fixture.at
        ),
    }
}

/// `Room.side`, as the DSL writes a face.
fn face_text(face: &FaceRef) -> String {
    format!("{}.{}", face.room, side_word(face.side))
}

fn side_word(side: Side) -> &'static str {
    match side {
        Side::North => "north",
        Side::East => "east",
        Side::South => "south",
        Side::West => "west",
    }
}

fn opening_word(kind: OpeningKind) -> &'static str {
    match kind {
        OpeningKind::Door => "door",
        OpeningKind::Window => "window",
        OpeningKind::Passage => "passage",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");
    const FIXTURE_B: &str = include_str!("../../../fixtures/lgh154-b.plan");
    const FIXTURE_B_LINE: &str = "measure Garderob.north to Sovrum.south = 4490 source laser";

    fn fixture(src: &str) -> Plan {
        parse(src).expect("fixture parses")
    }

    fn count(diagnostics: &[Diagnostic], code: Code) -> usize {
        diagnostics.iter().filter(|d| d.code == code).count()
    }

    #[test]
    fn fixture_b_line_on_fixture_a_is_rejected_with_one_e003()
    -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_A);
        let original = plan.clone();
        let result = apply(&plan, FIXTURE_B_LINE, false);
        assert!(!result.ok);
        assert!(result.plan.is_none());
        assert!(result.resolved.is_none());
        assert_eq!(
            count(&result.diagnostics, Code::E003),
            1,
            "{:?}",
            result.diagnostics
        );
        assert_eq!(plan, original, "the input plan must not change");
        Ok(())
    }

    #[test]
    fn room_size_replacement_resolves_and_prints_back() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_A);
        let result = apply(&plan, "room Hall 1200 x ?", false);
        assert!(result.ok, "{:?}", result.diagnostics);
        assert!(result.resolved.is_some());
        let new_plan = result.plan.ok_or("ok result has no plan")?;
        let hall = RoomName::new("Hall")?;
        assert_eq!(
            new_plan
                .rooms
                .get(&hall)
                .and_then(|r| r.width.map(|q| q.value)),
            Some(1200)
        );
        assert_eq!(
            new_plan.order, plan.order,
            "replacement keeps the room order"
        );
        let printed = print(&new_plan);
        assert_eq!(
            parse(&printed)
                .expect("printed plan parses")
                .rooms
                .get(&hall),
            new_plan.rooms.get(&hall)
        );
        assert_eq!(result.diff.len(), 1);
        assert_eq!(result.diff[0].op, ChangeOp::Replaced);
        Ok(())
    }

    #[test]
    fn dash_line_removes_the_matching_statement() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_B);
        let expected = fixture(FIXTURE_A);
        let result = apply(
            &plan,
            "- measure Garderob.north to Sovrum.south = 4490 source laser",
            false,
        );
        assert!(result.ok, "{:?}", result.diagnostics);
        assert_eq!(result.plan.as_ref(), Some(&expected));
        assert_eq!(result.diff.len(), 1);
        assert_eq!(result.diff[0].op, ChangeOp::Removed);
        Ok(())
    }

    #[test]
    fn dry_run_gives_the_same_result_and_changes_nothing() -> Result<(), Box<dyn std::error::Error>>
    {
        let plan = fixture(FIXTURE_A);
        let original = plan.clone();
        let patch = "room Hall 1200 x ?";
        let wet = apply(&plan, patch, false);
        let dry = apply(&plan, patch, true);
        assert_eq!(plan, original);
        assert_eq!(serde_json::to_string(&wet)?, serde_json::to_string(&dry)?);

        let bad_wet = apply(&plan, FIXTURE_B_LINE, false);
        let bad_dry = apply(&plan, FIXTURE_B_LINE, true);
        assert_eq!(plan, original);
        assert_eq!(
            serde_json::to_string(&bad_wet)?,
            serde_json::to_string(&bad_dry)?
        );
        Ok(())
    }

    #[test]
    fn unknown_room_in_patch_is_e001() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_A);
        let result = apply(
            &plan,
            "\nmeasure Nowhere.north to Sovrum.south = 4490 source laser",
            false,
        );
        assert!(!result.ok);
        assert_eq!(
            count(&result.diagnostics, Code::E001),
            1,
            "{:?}",
            result.diagnostics
        );
        let span = result.diagnostics.first().and_then(|d| d.span);
        assert_eq!(span.map(|s| s.line), Some(2));
        Ok(())
    }

    #[test]
    fn indented_align_after_a_room_line_belongs_to_that_room()
    -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_A);
        let patch = "room WC 2370 x 990 source laser\n  align north Hall";
        let result = apply(&plan, patch, false);
        assert!(result.ok, "{:?}", result.diagnostics);

        // The file parser reads the same text as an align of WC and Hall.
        let file = parse("room Hall 1100 x ?\nroom WC 2370 x 990 source laser\n  align north Hall")
            .expect("file parses");
        let wc = RoomName::new("WC")?;
        let hall = RoomName::new("Hall")?;
        let align = Relation::Align {
            side: Side::North,
            rooms: vec![wc, hall],
        };
        assert_eq!(file.relations, vec![align.clone()]);

        let new_plan = result.plan.ok_or("ok result has no plan")?;
        assert!(new_plan.relations.contains(&align));
        assert_eq!(
            new_plan, plan,
            "the patch restates fixture A's WC lines, so the plan is unchanged"
        );
        let ops: Vec<ChangeOp> = result.diff.iter().map(|c| c.op).collect();
        assert_eq!(ops, vec![ChangeOp::Replaced, ChangeOp::Replaced]);
        Ok(())
    }

    #[test]
    fn indented_line_with_no_room_before_it_is_e006() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_A);
        let patch = "  align north Hall";
        let result = apply(&plan, patch, false);
        assert!(!result.ok);
        assert!(result.plan.is_none());
        assert!(result.resolved.is_none());
        assert_eq!(
            count(&result.diagnostics, Code::E006),
            1,
            "{:?}",
            result.diagnostics
        );

        // The text is the file parser's E006 for the same input.
        let file_message = match parse(&format!("{patch}\n")) {
            Err(diagnostic) => diagnostic.message,
            Ok(_) => return Err("the file parser accepts an align with no room".into()),
        };
        assert_eq!(
            file_message,
            "Line 1, column 3: expected a room name, found \"align\"."
        );
        let message = result.diagnostics.first().map(|d| d.message.as_str());
        assert_eq!(message, Some(file_message.as_str()));
        Ok(())
    }

    #[test]
    fn title_patch_replaces_the_text_of_its_key() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_A);
        let with_title = apply(&plan, "title drawing \"A-01\"", false);
        assert!(with_title.ok, "{:?}", with_title.diagnostics);
        let base = with_title.plan.ok_or("ok result has no plan")?;

        let result = apply(&base, "title drawing \"A-02\"", false);
        assert!(result.ok, "{:?}", result.diagnostics);
        let new_plan = result.plan.ok_or("ok result has no plan")?;
        assert_eq!(
            new_plan.title.get("drawing").map(String::as_str),
            Some("A-02")
        );
        assert_eq!(new_plan.title.len(), 1);
        assert_eq!(result.diff.len(), 1);
        assert_eq!(result.diff[0].op, ChangeOp::Replaced);
        assert_eq!(result.diff[0].kind, "title");
        Ok(())
    }

    #[test]
    fn dash_title_removes_its_key_and_ignores_the_text() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_A);
        let with_title = apply(&plan, "title drawing \"A-01\"", false);
        let base = with_title.plan.ok_or("ok result has no plan")?;

        let result = apply(&base, "- title drawing \"\"", false);
        assert!(result.ok, "{:?}", result.diagnostics);
        assert_eq!(result.plan.as_ref(), Some(&plan));
        assert_eq!(result.diff.len(), 1);
        assert_eq!(result.diff[0].op, ChangeOp::Removed);
        Ok(())
    }

    #[test]
    fn fixture_line_adds_and_dash_line_removes_by_face_at_kind()
    -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_A);
        let added = apply(&plan, "fixture stove Garderob.north at 200", false);
        assert!(added.ok, "{:?}", added.diagnostics);
        let with = added.plan.ok_or("ok result has no plan")?;
        assert_eq!(with.fixtures.len(), 1);
        assert_eq!(added.diff[0].kind, "fixture");
        assert_eq!(added.diff[0].op, ChangeOp::Added);

        // Same face and at but another kind is another key, so it is added too.
        let other = apply(&with, "fixture sink Garderob.north at 200", false);
        assert_eq!(other.plan.as_ref().map(|p| p.fixtures.len()), Some(2));

        let removed = apply(&with, "- fixture stove Garderob.north at 200", false);
        assert!(removed.ok, "{:?}", removed.diagnostics);
        assert_eq!(removed.plan.as_ref(), Some(&plan));
        assert_eq!(removed.diff[0].op, ChangeOp::Removed);
        Ok(())
    }

    #[test]
    fn fixture_replaces_the_one_with_the_same_key() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_A);
        let first = apply(&plan, "fixture stove Garderob.north at 200", false);
        let base = first.plan.ok_or("ok result has no plan")?;
        let result = apply(
            &base,
            "fixture stove Garderob.north at 200 width 500",
            false,
        );
        assert!(result.ok, "{:?}", result.diagnostics);
        let new_plan = result.plan.ok_or("ok result has no plan")?;
        assert_eq!(new_plan.fixtures.len(), 1);
        assert_eq!(new_plan.fixtures[0].width, 500);
        assert_eq!(result.diff[0].op, ChangeOp::Replaced);
        Ok(())
    }

    #[test]
    fn title_with_unknown_key_is_e006() {
        let result = apply(&fixture(FIXTURE_A), "title colour \"red\"", false);
        assert!(!result.ok);
        assert_eq!(
            count(&result.diagnostics, Code::E006),
            1,
            "{:?}",
            result.diagnostics
        );
    }
}
