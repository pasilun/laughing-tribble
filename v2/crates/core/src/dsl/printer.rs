//! Printer: the canonical text of a plan (spec §7.2).
//!
//! Layout: the `plan` line and the two defaults, a blank line, the rooms in
//! declaration order each followed by its relations, a blank line, then the
//! `measure`, `wall`, `door`, `window` and `passage` lines.
//!
//! Decisions:
//! - A relation is printed under its subject, with the directional kinds in
//!   the order east_of, west_of, south_of, north_of, then `align`. An `align`
//!   is printed under the first room it lists, as `align SIDE` followed by the
//!   other rooms. The parser puts that room first again, so the list comes back
//!   the same.
//! - A wall gap is always a number (`gap 90`), never a plain `gap`, so the
//!   text does not depend on `default_wall`.
//! - A `source` clause is left out when the source is `assumed`, and `tol` when
//!   it equals the source's default tolerance.
//! - A room's width and depth share one `source` clause: the width's when the
//!   width is known, else the depth's. An opening's clause comes from `at`.
//! - `phase` is written only when it is not `existing`.
//! - Measures are sorted by their `from` face, then by `to`. Walls are sorted by
//!   face. Openings are sorted by face, then by `at`. Ties keep their order.
//! - Comments are not kept (spec §7.2).

use crate::intent::{
    FaceRef, Gap, Measure, Opening, OpeningKind, Phase, Plan, Relation, Room, RoomName, Side,
    WallOverride,
};
use crate::units::{Quantity, Source};

/// Print a plan in canonical form. The result ends with a newline.
pub fn print(plan: &Plan) -> String {
    let header = vec![
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

    let mut rooms = Vec::new();
    for name in &plan.order {
        if let Some(room) = plan.rooms.get(name) {
            rooms.push(room_line(room));
            rooms.extend(relation_lines(plan, name));
        }
    }

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

/// The `measure`, `wall`, `door`, `window` and `passage` lines, in that order.
fn statement_lines(plan: &Plan) -> Vec<String> {
    let mut measures: Vec<&Measure> = plan.measures.iter().collect();
    measures.sort_by(|a, b| {
        (face_key(&a.from), face_key(&a.to)).cmp(&(face_key(&b.from), face_key(&b.to)))
    });

    let mut walls: Vec<&WallOverride> = plan.wall_overrides.iter().collect();
    walls.sort_by(|a, b| face_key(&a.face).cmp(&face_key(&b.face)));

    let mut openings: Vec<&Opening> = plan.openings.iter().collect();
    openings.sort_by(|a, b| (face_key(&a.face), a.at.value).cmp(&(face_key(&b.face), b.at.value)));

    let mut lines: Vec<String> = measures.into_iter().map(measure_line).collect();
    lines.extend(walls.into_iter().map(wall_line));
    for kind in [OpeningKind::Door, OpeningKind::Window, OpeningKind::Passage] {
        lines.extend(
            openings
                .iter()
                .filter(|o| o.kind == kind)
                .map(|o| opening_line(o)),
        );
    }
    lines
}

/// `room NAME W x D [source ...] [apartment "A"] [demolish|new]`.
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
    line.push_str(phase_text(room.phase));
    line
}

/// The relations whose subject is `room`, indented under it.
fn relation_lines(plan: &Plan, room: &RoomName) -> Vec<String> {
    let mut lines = Vec::new();
    for keyword in ["east_of", "west_of", "south_of", "north_of"] {
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

/// `wall FACE thickness N [source ...]`.
fn wall_line(wall: &WallOverride) -> String {
    let q = &wall.thickness;
    format!(
        "wall {} thickness {}{}",
        face_text(&wall.face),
        q.value,
        source_clause(q)
    )
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
    /// canonical form does not keep.
    fn assert_round_trip(plan: &Plan) {
        let back = parse(&print(plan)).expect("canonical text parses");
        assert_same_items(&back.relations, &plan.relations);
        assert_same_items(&back.measures, &plan.measures);
        assert_same_items(&back.openings, &plan.openings);
        assert_same_items(&back.wall_overrides, &plan.wall_overrides);
        let mut rest = back;
        rest.relations = plan.relations.clone();
        rest.measures = plan.measures.clone();
        rest.openings = plan.openings.clone();
        rest.wall_overrides = plan.wall_overrides.clone();
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
}
