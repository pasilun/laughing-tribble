//! Printer: the canonical text of a plan (spec §7.2).
//!
//! Layout: the `plan` line, the two defaults and the `title` lines, a blank
//! line, the rooms in
//! declaration order each followed by its relations, a blank line, then the
//! `measure`, `wall`, `door`, `window` and `passage` lines.
//!
//! Decisions:
//! - A relation is printed under its subject, with the directional kinds in
//!   the order east_of, west_of, south_of, north_of, then `align`. An `align`
//!   is printed under the first room it lists, as `align SIDE` followed by the
//!   other rooms. The parser puts that room first again, so the list comes back
//!   the same. An align that lists only one room is printed at top level as
//!   `align SIDE ROOM`, after the rooms, since an indented align needs a room
//!   after the side.
//! - A wall gap is always a number (`gap 90`), never a plain `gap`, so the
//!   text does not depend on `default_wall`.
//! - A `source` clause is left out when the source is `assumed`, and `tol` when
//!   it equals the source's default tolerance.
//! - A room's width and depth share one `source` clause: the width's when the
//!   width is known, else the depth's. An opening's clause comes from `at`.
//! - `phase` is written only when it is not `existing`.
//! - Measures are sorted by their `from` face, then by `to`. Walls are sorted by
//!   face. Openings are sorted by kind, then face, then `at`. Fixtures are
//!   sorted by face, then `at`, then kind word. Stubs are sorted by face, then
//!   `at`. Ties keep their order.
//!   [`canonicalize`] does the sorting; the printer reads a canonical clone.
//! - A fixture's sizes are written when its kind has no default size, or when
//!   either size differs from the default. `offset` is written when not 0.
//! - A stub's `thickness` is written only when it is `Some`, and its `offset`
//!   only when not 0 (spec §15 D45).
//! - Comments are not kept (spec §7.2).

use super::parser::TITLE_KEYS;
use crate::intent::{
    FaceRef, Fixture, Gap, Measure, Opening, OpeningKind, Phase, Plan, Relation, Room, RoomName,
    Side, Stub, WallOverride,
};
use crate::units::{Quantity, Source};

/// The directional keywords, in the order the printer writes them.
const DIRECTIONS: [&str; 4] = ["east_of", "west_of", "south_of", "north_of"];

/// Put every list of `plan` in the order the printer writes it (spec §7.2, D7).
///
/// Relations: for each room in `plan.order`, its directional relations in
/// keyword order, then its aligns of at least two rooms that start with it.
/// Then every one-room align. Relations not placed by these rules go last, in
/// their current order. Only the order changes, never a value.
pub fn canonicalize(plan: &mut Plan) {
    let mut pool: Vec<Option<Relation>> = std::mem::take(&mut plan.relations)
        .into_iter()
        .map(Some)
        .collect();
    let mut relations = Vec::with_capacity(pool.len());
    for room in &plan.order {
        for keyword in DIRECTIONS {
            take_relations(&mut pool, &mut relations, |r| {
                placement(r).is_some_and(|(subject, kw, _, _)| subject == room && kw == keyword)
            });
        }
        take_relations(&mut pool, &mut relations, |r| {
            matches!(r, Relation::Align { rooms, .. }
                if rooms.len() >= 2 && rooms.first() == Some(room))
        });
    }
    take_relations(
        &mut pool,
        &mut relations,
        |r| matches!(r, Relation::Align { rooms, .. } if rooms.len() == 1),
    );
    relations.extend(pool.into_iter().flatten());
    plan.relations = relations;

    plan.measures.sort_by(|a, b| {
        (face_key(&a.from), face_key(&a.to)).cmp(&(face_key(&b.from), face_key(&b.to)))
    });
    plan.wall_overrides
        .sort_by(|a, b| face_key(&a.face).cmp(&face_key(&b.face)));
    plan.openings.sort_by(|a, b| {
        (kind_rank(a.kind), face_key(&a.face), a.at.value).cmp(&(
            kind_rank(b.kind),
            face_key(&b.face),
            b.at.value,
        ))
    });
    plan.fixtures.sort_by(|a, b| {
        (face_key(&a.face), a.at, a.kind.word()).cmp(&(face_key(&b.face), b.at, b.kind.word()))
    });
    plan.stubs
        .sort_by(|a, b| (face_key(&a.face), a.at).cmp(&(face_key(&b.face), b.at)));
}

/// Move every relation in `pool` that `keep` accepts to `out`, in pool order.
fn take_relations(
    pool: &mut [Option<Relation>],
    out: &mut Vec<Relation>,
    keep: impl Fn(&Relation) -> bool,
) {
    for slot in pool.iter_mut() {
        if slot.as_ref().is_some_and(&keep) {
            out.extend(slot.take());
        }
    }
}

/// Print a plan in canonical form. The result ends with a newline.
pub fn print(plan: &Plan) -> String {
    let mut header = vec![
        format!("plan {}", quoted(&plan.name)),
        format!(
            "default_wall {}{}",
            plan.default_wall.value,
            source_clause(&plan.default_wall)
        ),
        format!(
            "default_outer_wall {}{}",
            plan.default_outer_wall.value,
            source_clause(&plan.default_outer_wall)
        ),
    ];
    header.extend(title_lines(plan));

    let mut rooms = Vec::new();
    for name in &plan.order {
        if let Some(room) = plan.rooms.get(name) {
            rooms.push(room_line(room));
            rooms.extend(relation_lines(plan, name));
        }
    }
    rooms.extend(lone_align_lines(plan));

    let statements = statement_lines(plan);

    let mut blocks = vec![header];
    if !rooms.is_empty() {
        blocks.push(rooms);
    }
    if !statements.is_empty() {
        blocks.push(statements);
    }
    let mut out = blocks
        .iter()
        .map(|lines| lines.join("\n"))
        .collect::<Vec<String>>()
        .join("\n\n");
    out.push('\n');
    out
}

/// The `title KEY "TEXT"` lines, in the key order of spec §15 D41 (not
/// alphabetical). Keys the DSL does not know are not written.
fn title_lines(plan: &Plan) -> Vec<String> {
    TITLE_KEYS
        .iter()
        .filter_map(|key| {
            plan.title
                .get(*key)
                .map(|text| format!("title {key} {}", quoted(text)))
        })
        .collect()
}

/// The `measure`, `wall`, `stub`, `door`, `window` and `passage` lines, in that
/// order, then the `fixture` lines.
fn statement_lines(plan: &Plan) -> Vec<String> {
    let mut canon = plan.clone();
    canonicalize(&mut canon);

    let mut lines: Vec<String> = canon.measures.iter().map(measure_line).collect();
    lines.extend(canon.wall_overrides.iter().map(wall_line));
    lines.extend(canon.stubs.iter().map(stub_line));
    for kind in [OpeningKind::Door, OpeningKind::Window, OpeningKind::Passage] {
        lines.extend(
            canon
                .openings
                .iter()
                .filter(|o| o.kind == kind)
                .map(opening_line),
        );
    }
    lines.extend(canon.fixtures.iter().map(fixture_line));
    lines
}

/// `fixture KIND FACE at N [width N depth N] [offset N] [label "TEXT"] [phase]`.
/// The sizes are written when the kind has no default or a size differs from it.
fn fixture_line(fixture: &Fixture) -> String {
    let mut line = format!(
        "fixture {} {} at {}",
        fixture.kind.word(),
        face_text(&fixture.face),
        fixture.at
    );
    let differs = fixture.kind.default_size() != Some((fixture.width, fixture.depth));
    if differs {
        line.push_str(&format!(" width {} depth {}", fixture.width, fixture.depth));
    }
    if fixture.offset != 0 {
        line.push_str(&format!(" offset {}", fixture.offset));
    }
    if let Some(text) = &fixture.label {
        line.push_str(&format!(" label {}", quoted(text)));
    }
    line.push_str(phase_text(fixture.phase));
    line
}

/// `stub FACE at N length N [thickness N] [offset N] [bearing] [demolish|new]`
/// (spec §15 D45).
fn stub_line(stub: &Stub) -> String {
    let mut line = format!(
        "stub {} at {} length {}",
        face_text(&stub.face),
        stub.at,
        stub.length
    );
    if let Some(thickness) = stub.thickness {
        line.push_str(&format!(" thickness {thickness}"));
    }
    if stub.offset != 0 {
        line.push_str(&format!(" offset {}", stub.offset));
    }
    if stub.bearing {
        line.push_str(" bearing");
    }
    line.push_str(phase_text(stub.phase));
    line
}

/// `room NAME W x D [source ...] [apartment "A"] [part PARENT] [demolish|new]`.
fn room_line(room: &Room) -> String {
    let mut line = format!(
        "room {} {} x {}",
        room.name,
        size_text(room.width.as_ref()),
        size_text(room.depth.as_ref())
    );
    if let Some(q) = room.width.as_ref().or(room.depth.as_ref()) {
        line.push_str(&source_clause(q));
    }
    if let Some(apartment) = &room.apartment {
        line.push_str(&format!(" apartment {}", quoted(apartment)));
    }
    if let Some(parent) = &room.part_of {
        line.push_str(&format!(" part {parent}"));
    }
    line.push_str(phase_text(room.phase));
    line
}

/// The relations whose subject is `room`, indented under it.
fn relation_lines(plan: &Plan, room: &RoomName) -> Vec<String> {
    let mut canon = plan.clone();
    canonicalize(&mut canon);
    let plan = &canon;
    let mut lines = Vec::new();
    for keyword in DIRECTIONS {
        for relation in &plan.relations {
            if let Some((subject, kw, of, gap)) = placement(relation)
                && subject == room
                && kw == keyword
            {
                lines.push(format!("  {kw} {of} {}", gap_text(gap)));
            }
        }
    }
    for relation in &plan.relations {
        if let Relation::Align { side, rooms } = relation
            && let Some((first, rest)) = rooms.split_first()
            && first == room
            && !rest.is_empty()
        {
            let mut line = format!("  align {}", side_name(*side));
            for other in rest {
                line.push(' ');
                line.push_str(other.as_str());
            }
            lines.push(line);
        }
    }
    lines
}

/// The `align SIDE ROOM` lines for aligns that name one room. An indented
/// align needs at least one more room after the side, so these are printed at
/// top level, after the rooms.
fn lone_align_lines(plan: &Plan) -> Vec<String> {
    let mut canon = plan.clone();
    canonicalize(&mut canon);
    canon
        .relations
        .iter()
        .filter_map(|relation| match relation {
            Relation::Align { side, rooms } => match rooms.as_slice() {
                [room] => Some(format!("align {} {}", side_name(*side), room.as_str())),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

/// A directional relation as (subject, keyword, reference room, gap).
fn placement(relation: &Relation) -> Option<(&RoomName, &'static str, &RoomName, &Gap)> {
    match relation {
        Relation::EastOf { subject, of, gap } => Some((subject, "east_of", of, gap)),
        Relation::WestOf { subject, of, gap } => Some((subject, "west_of", of, gap)),
        Relation::SouthOf { subject, of, gap } => Some((subject, "south_of", of, gap)),
        Relation::NorthOf { subject, of, gap } => Some((subject, "north_of", of, gap)),
        Relation::Align { .. } => None,
    }
}

/// `open`, or `gap N [source ...]`.
fn gap_text(gap: &Gap) -> String {
    match gap {
        Gap::Open => "open".to_string(),
        Gap::Wall(q) => format!("gap {}{}", q.value, source_clause(q)),
    }
}

/// `measure FACE to FACE = N [source ...] [reference]`.
fn measure_line(measure: &Measure) -> String {
    let q = &measure.value;
    let mut line = format!(
        "measure {} to {} = {}{}",
        face_text(&measure.from),
        face_text(&measure.to),
        q.value,
        source_clause(q)
    );
    if measure.reference {
        line.push_str(" reference");
    }
    line
}

/// `wall FACE [thickness N [source ...]] [bearing] [fire "TEXT"] [demolish|new]`.
fn wall_line(wall: &WallOverride) -> String {
    let mut line = format!("wall {}", face_text(&wall.face));
    if let Some(q) = &wall.thickness {
        line.push_str(&format!(" thickness {}{}", q.value, source_clause(q)));
    }
    if wall.bearing {
        line.push_str(" bearing");
    }
    if let Some(text) = &wall.fire {
        line.push_str(&format!(" fire {}", quoted(text)));
    }
    line.push_str(phase_text(wall.phase));
    line
}

/// `door|window|passage FACE at N width N [height N] [hinge S] [opens R]
/// [source ...] [demolish|new]`.
fn opening_line(opening: &Opening) -> String {
    let keyword = match opening.kind {
        OpeningKind::Door => "door",
        OpeningKind::Window => "window",
        OpeningKind::Passage => "passage",
    };
    let mut line = format!(
        "{keyword} {} at {} width {}",
        face_text(&opening.face),
        opening.at.value,
        opening.width.value
    );
    if let Some(height) = opening.height {
        line.push_str(&format!(" height {height}"));
    }
    if let Some(side) = opening.hinge {
        line.push_str(&format!(" hinge {}", side_name(side)));
    }
    if let Some(room) = &opening.opens_into {
        line.push_str(&format!(" opens {room}"));
    }
    line.push_str(&source_clause(&opening.at));
    line.push_str(phase_text(opening.phase));
    line
}

/// The ` source KIND [tol N]` clause, or nothing when both the source and the
/// tolerance are the defaults. The clause starts with a space when present.
fn source_clause(q: &Quantity) -> String {
    let default_tol = q.source.default_tolerance();
    if q.source == Source::Assumed && q.tolerance == default_tol {
        return String::new();
    }
    let mut text = format!(" source {}", source_name(q.source));
    if q.tolerance != default_tol {
        text.push_str(&format!(" tol {}", q.tolerance));
    }
    text
}

/// The phase word, with a leading space. `existing` is the default and is left out.
fn phase_text(phase: Phase) -> &'static str {
    match phase {
        Phase::Existing => "",
        Phase::Demolish => " demolish",
        Phase::New => " new",
    }
}

/// A room size: its value, or `?` when unknown.
fn size_text(q: Option<&Quantity>) -> String {
    q.map_or_else(|| "?".to_string(), |q| q.value.to_string())
}

/// `ROOM.side`.
fn face_text(face: &FaceRef) -> String {
    format!("{}.{}", face.room, side_name(face.side))
}

/// Sort key for a face: room name, then side in compass order.
fn face_key(face: &FaceRef) -> (&str, u8) {
    (face.room.as_str(), side_rank(face.side))
}

/// Printed order of opening kinds: doors, then windows, then passages.
fn kind_rank(kind: OpeningKind) -> u8 {
    match kind {
        OpeningKind::Door => 0,
        OpeningKind::Window => 1,
        OpeningKind::Passage => 2,
    }
}

fn side_rank(side: Side) -> u8 {
    match side {
        Side::North => 0,
        Side::East => 1,
        Side::South => 2,
        Side::West => 3,
    }
}

fn side_name(side: Side) -> &'static str {
    match side {
        Side::North => "north",
        Side::East => "east",
        Side::South => "south",
        Side::West => "west",
    }
}

fn source_name(source: Source) -> &'static str {
    match source {
        Source::Laser => "laser",
        Source::Tape => "tape",
        Source::Printed => "printed",
        Source::Drawing => "drawing",
        Source::Estimated => "estimated",
        Source::Assumed => "assumed",
    }
}

fn quoted(text: &str) -> String {
    format!("\"{text}\"")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;

    const FIXTURE_A: &str = include_str!("../../../../fixtures/lgh154-a.plan");
    const FIXTURE_B: &str = include_str!("../../../../fixtures/lgh154-b.plan");
    const FIXTURE_C: &str = include_str!("../../../../fixtures/lgh154-c.plan");

    /// Canonical text of fixture A, derived from the §7.2 rules. The fixture
    /// itself is not in this form (see the report), so it is not edited.
    const CANONICAL_A: &str = r#"plan "Gnejsen lgh 154, existing (laser 2026-11-07)"
default_wall 90
default_outer_wall 300

room Garderob 1860 x 2360 source laser
room Sovrum 1860 x 2090 source laser
  south_of Garderob gap 90
  align west Garderob
room Hall 1100 x ?
  east_of Garderob gap 121 source drawing
  align north Garderob
room WC 2370 x 990 source laser
  east_of Hall gap 90
  align north Hall
room Vardagsrum 3560 x 3480 source laser
  south_of Hall open
  south_of WC gap 123 source drawing
  align west Hall

door WC.west at 240 width 450 hinge south opens Hall source estimated
window Sovrum.south at 380 width 1350 source laser
window Vardagsrum.south at 1610 width 1280 source laser
passage Garderob.east at 0 width 680 source estimated
"#;

    /// Canonical text of fixture B: A plus the measure line.
    const CANONICAL_B: &str = r#"plan "Gnejsen lgh 154, existing (laser 2026-11-07)"
default_wall 90
default_outer_wall 300

room Garderob 1860 x 2360 source laser
room Sovrum 1860 x 2090 source laser
  south_of Garderob gap 90
  align west Garderob
room Hall 1100 x ?
  east_of Garderob gap 121 source drawing
  align north Garderob
room WC 2370 x 990 source laser
  east_of Hall gap 90
  align north Hall
room Vardagsrum 3560 x 3480 source laser
  south_of Hall open
  south_of WC gap 123 source drawing
  align west Hall

measure Garderob.north to Sovrum.south = 4490 source laser
door WC.west at 240 width 450 hinge south opens Hall source estimated
window Sovrum.south at 380 width 1350 source laser
window Vardagsrum.south at 1610 width 1280 source laser
passage Garderob.east at 0 width 680 source estimated
"#;

    /// Canonical text of fixture C. The align is printed under Sovrum, its
    /// first room, not at the end of the file.
    const CANONICAL_C: &str = r#"plan "Gnejsen lgh 154, existing (laser 2026-11-07)"
default_wall 90
default_outer_wall 300

room Garderob 1860 x 2360 source laser
room Sovrum 1860 x 2090 source laser
  south_of Garderob gap 90
  align west Garderob
  align south Vardagsrum
room Hall 1100 x ?
  east_of Garderob gap 121 source drawing
  align north Garderob
room WC 2370 x 990 source laser
  east_of Hall gap 90
  align north Hall
room Vardagsrum 3560 x 3480 source laser
  south_of Hall open
  south_of WC gap 123 source drawing
  align west Hall

door WC.west at 240 width 450 hinge south opens Hall source estimated
window Sovrum.south at 380 width 1350 source laser
window Vardagsrum.south at 1610 width 1280 source laser
passage Garderob.east at 0 width 680 source estimated
"#;

    fn print_of(src: &str) -> String {
        print(&parse(src).expect("fixture parses"))
    }

    #[test]
    fn fixture_a_prints_canonical_form() {
        assert_eq!(print_of(FIXTURE_A), CANONICAL_A);
    }

    #[test]
    fn fixture_b_prints_canonical_form() {
        assert_eq!(print_of(FIXTURE_B), CANONICAL_B);
    }

    #[test]
    fn fixture_c_prints_canonical_form() {
        assert_eq!(print_of(FIXTURE_C), CANONICAL_C);
    }

    /// Both lists hold the same items, in any order.
    fn assert_same_items<T: PartialEq + std::fmt::Debug>(a: &[T], b: &[T]) {
        assert_eq!(a.len(), b.len(), "item counts differ");
        assert!(a.iter().all(|x| b.contains(x)), "{a:?} vs {b:?}");
        assert!(b.iter().all(|x| a.contains(x)), "{a:?} vs {b:?}");
    }

    /// `parse(print(plan))` equals `plan`, except that the lists the printer
    /// sorts (relations, measures, openings, wall overrides) are compared as
    /// sets. Their order in `Plan` is the declaration order, which the
    /// canonical form does not keep. Fixtures are compared without regard to
    /// order because the canonical form sorts them (spec §7.2).
    fn assert_round_trip(plan: &Plan) {
        let back = parse(&print(plan)).expect("canonical text parses");
        assert_same_items(&back.relations, &plan.relations);
        assert_same_items(&back.measures, &plan.measures);
        assert_same_items(&back.openings, &plan.openings);
        assert_same_items(&back.wall_overrides, &plan.wall_overrides);
        assert_same_items(&back.fixtures, &plan.fixtures);
        let mut rest = back;
        rest.relations = plan.relations.clone();
        rest.measures = plan.measures.clone();
        rest.openings = plan.openings.clone();
        rest.wall_overrides = plan.wall_overrides.clone();
        rest.fixtures = plan.fixtures.clone();
        assert_eq!(&rest, plan);
    }

    #[test]
    fn round_trip_holds_for_fixtures_a_b_c() {
        for src in [FIXTURE_A, FIXTURE_B, FIXTURE_C] {
            assert_round_trip(&parse(src).expect("fixture parses"));
        }
    }

    #[test]
    fn default_source_and_tol_are_omitted() {
        let laser = Source::Laser.default_tolerance();
        let assumed = Source::Assumed.default_tolerance();
        let src = format!(
            "room A 1000 x 2000 source laser tol {laser}\n\
             room B 1000 x 2000\n\
             room C 1000 x 2000 source laser tol {}\n\
             room D 1000 x 2000 source assumed tol {}\n",
            laser + 1,
            assumed + 3,
        );
        let expected = format!(
            "plan \"\"\n\
             default_wall 90\n\
             default_outer_wall 300\n\
             \n\
             room A 1000 x 2000 source laser\n\
             room B 1000 x 2000\n\
             room C 1000 x 2000 source laser tol {}\n\
             room D 1000 x 2000 source assumed tol {}\n",
            laser + 1,
            assumed + 3,
        );
        assert_eq!(print_of(&src), expected);
    }

    #[test]
    fn top_level_align_with_one_room_round_trips() {
        let src = "room A 1000 x 2000\nalign north A\n";
        let plan = parse(src).expect("source parses");
        assert!(print_of(src).lines().any(|line| line == "align north A"));
        assert_round_trip(&plan);
        assert_eq!(parse(&print(&plan)).expect("canonical text parses"), plan);
    }

    #[test]
    fn openings_are_sorted_by_face_then_at() {
        let src = "room Sovrum 1000 x 2000\n\
                   window Sovrum.south at 900 width 100\n\
                   window Sovrum.south at 100 width 100\n";
        let expected = "plan \"\"\n\
                        default_wall 90\n\
                        default_outer_wall 300\n\
                        \n\
                        room Sovrum 1000 x 2000\n\
                        \n\
                        window Sovrum.south at 100 width 100\n\
                        window Sovrum.south at 900 width 100\n";
        assert_eq!(print_of(src), expected);
    }

    #[test]
    fn canonicalize_is_idempotent() {
        for src in [FIXTURE_A, FIXTURE_B, FIXTURE_C] {
            let mut once = parse(src).expect("fixture parses");
            canonicalize(&mut once);
            let mut twice = once.clone();
            canonicalize(&mut twice);
            assert_eq!(twice, once);
        }
    }

    #[test]
    fn canonical_plan_round_trips_exactly() {
        for src in [FIXTURE_A, FIXTURE_B, FIXTURE_C] {
            let mut p = parse(src).expect("fixture parses");
            canonicalize(&mut p);
            assert_eq!(parse(&print(&p)).expect("canonical text parses"), p);
        }
    }

    #[test]
    fn openings_order_is_kind_face_at() {
        let src = "room A 1000 x 2000\n\
                   room B 1000 x 2000\n\
                   window B.south at 10 width 100\n\
                   door A.north at 5 width 100\n\
                   door A.north at 1 width 100\n";
        let mut plan = parse(src).expect("source parses");
        canonicalize(&mut plan);
        let got: Vec<(OpeningKind, String, i64)> = plan
            .openings
            .iter()
            .map(|o| (o.kind, face_text(&o.face), o.at.value))
            .collect();
        assert_eq!(
            got,
            vec![
                (OpeningKind::Door, "A.north".to_string(), 1),
                (OpeningKind::Door, "A.north".to_string(), 5),
                (OpeningKind::Window, "B.south".to_string(), 10),
            ]
        );
    }

    /// The statement lines of `src`, printed: everything after the room block.
    fn statement_text(src: &str) -> String {
        print_of(src)
            .lines()
            .filter(|line| line.starts_with("wall "))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn wall_thickness_line_prints_as_before() {
        let src = "room A 1000 x 2000\nwall A.north thickness 160 source laser\n";
        assert_eq!(
            statement_text(src),
            "wall A.north thickness 160 source laser"
        );
    }

    #[test]
    fn wall_bearing_fire_demolish_line_prints_same() {
        let src = "room A 1000 x 2000\nwall A.east bearing fire \"EI60\" demolish\n";
        assert_eq!(
            statement_text(src),
            "wall A.east bearing fire \"EI60\" demolish"
        );
    }

    #[test]
    fn wall_bearing_only_prints_bearing() {
        let src = "room A 1000 x 2000\nwall A.north bearing\n";
        assert_eq!(statement_text(src), "wall A.north bearing");
    }

    #[test]
    fn wall_all_parts_round_trip() {
        let src = "room A 1000 x 2000\n\
                   wall A.west thickness 120 source tape bearing fire \"EI60\" new\n";
        let plan = parse(src).expect("parse");
        assert_round_trip(&plan);
        assert_eq!(
            statement_text(src),
            "wall A.west thickness 120 source tape bearing fire \"EI60\" new"
        );
    }

    #[test]
    fn title_lines_print_after_defaults_in_key_order() {
        let src = "title drawing \"A-01\"\ntitle property \"Stockholm Gnejsen 6\"\n\
                   room A 1000 x 2000\n";
        let expected = "plan \"\"\n\
                        default_wall 90\n\
                        default_outer_wall 300\n\
                        title property \"Stockholm Gnejsen 6\"\n\
                        title drawing \"A-01\"\n\
                        \n\
                        room A 1000 x 2000\n";
        assert_eq!(print_of(src), expected);
        assert_round_trip(&parse(src).expect("parses"));
    }

    /// The statement lines of `src` that start with `fixture`.
    fn fixture_text(src: &str) -> String {
        print_of(src)
            .lines()
            .filter(|line| line.starts_with("fixture "))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn default_size_stove_prints_without_sizes() {
        let src = "room Kok 3000 x 3000\nfixture stove Kok.north at 200\n";
        assert_eq!(fixture_text(src), "fixture stove Kok.north at 200");
        assert_round_trip(&parse(src).expect("parses"));
    }

    #[test]
    fn kitchen_with_sizes_round_trips() {
        let src =
            "room Kok 3000 x 3000\nfixture kitchen Kok.north at 800 width 1800 depth 600 new\n";
        assert_eq!(
            fixture_text(src),
            "fixture kitchen Kok.north at 800 width 1800 depth 600 new"
        );
        assert_round_trip(&parse(src).expect("parses"));
    }

    #[test]
    fn wc_with_one_size_prints_both_when_depth_is_filled_in() {
        let src = "room WC 1500 x 2000\nfixture wc WC.east at 100 width 380\n";
        assert_eq!(
            fixture_text(src),
            "fixture wc WC.east at 100 width 380 depth 700"
        );
        assert_round_trip(&parse(src).expect("parses"));
    }

    #[test]
    fn fixture_offset_and_label_print_after_sizes() {
        let src = "room A 1000 x 2000\nfixture sink A.west at 10 offset 50 label \"Diskbänk\"\n";
        assert_eq!(
            fixture_text(src),
            "fixture sink A.west at 10 offset 50 label \"Diskbänk\""
        );
        assert_round_trip(&parse(src).expect("parses"));
    }

    #[test]
    fn fixtures_are_sorted_by_face_then_at_then_kind() {
        let src = "room A 1000 x 2000\n\
                   fixture stove A.north at 500\n\
                   fixture bath A.north at 100 width 1600 depth 700\n\
                   fixture plug A.north at 500\n";
        assert_eq!(
            fixture_text(src),
            "fixture bath A.north at 100\n\
             fixture plug A.north at 500\n\
             fixture stove A.north at 500"
        );
    }

    #[test]
    fn fixtures_print_after_the_passage_lines() {
        let src = "room A 1000 x 2000\n\
                   fixture stove A.north at 500\n\
                   passage A.east at 0 width 680\n";
        let text = print_of(src);
        let passage = text.find("passage ").expect("passage line");
        let fixture = text.find("fixture ").expect("fixture line");
        assert!(passage < fixture, "{text}");
    }

    #[test]
    fn fixtures_print_no_title_lines() {
        for src in [FIXTURE_A, FIXTURE_B, FIXTURE_C] {
            assert!(!print_of(src).contains("title "));
        }
    }

    /// The statement lines of `src` that start with `stub`.
    fn stub_text(src: &str) -> String {
        print_of(src)
            .lines()
            .filter(|line| line.starts_with("stub "))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn stub_with_length_only_round_trips() {
        let src = "room Kok 2400 x 4000\nstub Kok.west at 2000 length 600\n";
        assert_eq!(stub_text(src), "stub Kok.west at 2000 length 600");
        assert_round_trip(&parse(src).expect("parses"));
    }

    #[test]
    fn stub_with_every_part_round_trips() {
        let src = "room Kok 2400 x 4000\n\
                   stub Kok.west at 2000 length 600 thickness 150 offset 500 bearing new\n";
        assert_eq!(
            stub_text(src),
            "stub Kok.west at 2000 length 600 thickness 150 offset 500 bearing new"
        );
        assert_round_trip(&parse(src).expect("parses"));
    }

    #[test]
    fn stubs_are_sorted_by_face_then_at_and_print_after_walls() {
        let src = "room A 1000 x 2000\n\
                   stub A.west at 900 length 300\n\
                   stub A.north at 500 length 300\n\
                   stub A.north at 100 length 300\n\
                   wall A.north thickness 120\n\
                   door A.west at 100 width 800\n";
        let text = print_of(src);
        assert_eq!(
            stub_text(src),
            "stub A.north at 100 length 300\n\
             stub A.north at 500 length 300\n\
             stub A.west at 900 length 300"
        );
        let wall = text.find("wall ").expect("wall line");
        let stub = text.find("stub ").expect("stub line");
        let door = text.find("door ").expect("door line");
        assert!(wall < stub && stub < door, "{text}");
        let mut plan = parse(src).expect("parses");
        canonicalize(&mut plan);
        assert_round_trip(&plan);
    }

    #[test]
    fn room_part_round_trips() {
        let src =
            "room Kok 2400 x 4000 source laser\nroom Matvra 2400 x 1500 source laser part Kok\n";
        let plan = crate::dsl::parse(src).expect("parses");
        let text = print(&plan);
        assert!(
            text.contains("room Matvra 2400 x 1500 source laser part Kok\n"),
            "{text}"
        );
        assert_round_trip(&plan);
    }
}
