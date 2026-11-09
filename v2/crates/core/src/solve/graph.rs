//! Constraint edges from a plan (spec §6.1).
//!
//! Each statement becomes an [`Edge`] meaning `coord(to) − coord(from) = value`.
//! Coordinates: x grows east, y grows south, so the north face has the smaller
//! y. Lengths are [`Mm`]. Edges come out in declaration order: room sizes
//! (width, then depth, per room in declaration order), then relations, then
//! measures. Nothing here is solved; that is the next step.

use serde_json::json;

use crate::diagnostics::{Code, Diagnostic, Severity, message};
use crate::intent::{Gap, Plan, Relation, RoomName, Side};
use crate::units::{Mm, Source};

/// The axis an edge lies on. `X` is east–west, `Y` is north–south.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Axis {
    /// East–west (x).
    X,
    /// North–south (y).
    Y,
}

/// One face of one room, a solver variable. Its coordinate is in mm.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FaceId {
    /// The room.
    pub room: RoomName,
    /// Which of its faces.
    pub side: Side,
}

/// The statement an edge came from, written as in the DSL, for example
/// `room Garderob width` or `align west Sovrum Garderob`.
pub type Origin = String;

/// A constraint `coord(to) − coord(from) = value` (mm), with its tolerance and origin.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Edge {
    /// The axis the faces lie on.
    pub axis: Axis,
    /// Start face.
    pub from: FaceId,
    /// End face.
    pub to: FaceId,
    /// Required difference `coord(to) − coord(from)` in mm.
    pub value: Mm,
    /// Allowed error in mm, symmetric. Exact edges have 0.
    pub tolerance: Mm,
    /// The statement this edge came from.
    pub origin: Origin,
    /// Where the value came from; `None` for exact edges (`align`, `open`).
    pub source: Option<Source>,
}

/// Build the edges of `plan` by the §6.1 table, in declaration order.
///
/// Returns the edges and the diagnostics found while building them. Unknown
/// sizes (`?`) give no edge. A `reference` measure gives no edge (W020 is
/// checked after solving). A measure whose two faces are not on the same axis
/// gives no edge and an E010 diagnostic. Values and tolerances are in mm.
pub fn edges(plan: &Plan) -> (Vec<Edge>, Vec<Diagnostic>) {
    let mut out = Vec::new();
    let mut diagnostics = Vec::new();

    for name in &plan.order {
        let Some(room) = plan.rooms.get(name) else {
            continue;
        };
        if let Some(width) = &room.width {
            out.push(Edge {
                axis: Axis::X,
                from: face(name, Side::West),
                to: face(name, Side::East),
                value: width.value,
                tolerance: width.tolerance,
                origin: format!("room {name} width"),
                source: Some(width.source),
            });
        }
        if let Some(depth) = &room.depth {
            out.push(Edge {
                axis: Axis::Y,
                from: face(name, Side::North),
                to: face(name, Side::South),
                value: depth.value,
                tolerance: depth.tolerance,
                origin: format!("room {name} depth"),
                source: Some(depth.source),
            });
        }
    }

    for relation in &plan.relations {
        match relation {
            Relation::EastOf { subject, of, gap } => out.push(gap_edge(
                Axis::X,
                face(of, Side::East),
                face(subject, Side::West),
                gap,
                format!("{subject} east_of {of} {}", gap_word(gap)),
            )),
            Relation::WestOf { subject, of, gap } => out.push(gap_edge(
                Axis::X,
                face(subject, Side::East),
                face(of, Side::West),
                gap,
                format!("{subject} west_of {of} {}", gap_word(gap)),
            )),
            Relation::SouthOf { subject, of, gap } => out.push(gap_edge(
                Axis::Y,
                face(of, Side::South),
                face(subject, Side::North),
                gap,
                format!("{subject} south_of {of} {}", gap_word(gap)),
            )),
            Relation::NorthOf { subject, of, gap } => out.push(gap_edge(
                Axis::Y,
                face(subject, Side::South),
                face(of, Side::North),
                gap,
                format!("{subject} north_of {of} {}", gap_word(gap)),
            )),
            Relation::Align { side, rooms } => {
                // Every other room's face is tied to the first room's face, exactly.
                if let Some((first, others)) = rooms.split_first() {
                    for other in others {
                        out.push(Edge {
                            axis: axis_of(*side),
                            from: face(first, *side),
                            to: face(other, *side),
                            value: 0,
                            tolerance: 0,
                            origin: format!("align {} {first} {other}", side_name(*side)),
                            source: None,
                        });
                    }
                }
            }
        }
    }

    for measure in &plan.measures {
        let from = &measure.from;
        let to = &measure.to;
        if axis_of(from.side) != axis_of(to.side) {
            diagnostics.push(not_parallel(&face_text(from), &face_text(to)));
            continue;
        }
        if measure.reference {
            continue;
        }
        out.push(Edge {
            axis: axis_of(from.side),
            from: face(&from.room, from.side),
            to: face(&to.room, to.side),
            value: measure.value.value,
            tolerance: measure.value.tolerance,
            origin: format!("measure {} to {}", face_text(from), face_text(to)),
            source: Some(measure.value.source),
        });
    }

    (out, diagnostics)
}

/// The edge for a gap between two faces. `open` is an exact zero gap.
fn gap_edge(axis: Axis, from: FaceId, to: FaceId, gap: &Gap, origin: Origin) -> Edge {
    let (value, tolerance, source) = match gap {
        Gap::Wall(quantity) => (quantity.value, quantity.tolerance, Some(quantity.source)),
        Gap::Open => (0, 0, None),
    };
    Edge {
        axis,
        from,
        to,
        value,
        tolerance,
        origin,
        source,
    }
}

/// The DSL word for a gap: `open` or `gap`.
fn gap_word(gap: &Gap) -> &'static str {
    match gap {
        Gap::Wall(_) => "gap",
        Gap::Open => "open",
    }
}

/// The axis a side lies on: east and west are x, north and south are y.
fn axis_of(side: Side) -> Axis {
    match side {
        Side::East | Side::West => Axis::X,
        Side::North | Side::South => Axis::Y,
    }
}

/// The compass word for a side, as written in the DSL.
fn side_name(side: Side) -> &'static str {
    match side {
        Side::North => "north",
        Side::East => "east",
        Side::South => "south",
        Side::West => "west",
    }
}

fn face(room: &RoomName, side: Side) -> FaceId {
    FaceId {
        room: room.clone(),
        side,
    }
}

/// A face as written in the DSL, for example `Garderob.north`.
fn face_text(face: &crate::intent::FaceRef) -> String {
    format!("{}.{}", face.room, side_name(face.side))
}

/// E010 for a measure between faces on different axes.
fn not_parallel(from: &str, to: &str) -> Diagnostic {
    let args = [("from", from.to_string()), ("to", to.to_string())];
    Diagnostic {
        code: Code::E010,
        severity: Severity::Error,
        message: message(Code::E010, &args),
        span: None,
        refs: vec![from.to_string(), to.to_string()],
        data: json!({ "from": from, "to": to }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;

    const FIXTURE_A: &str = include_str!("../../../../fixtures/lgh154-a.plan");
    const EXPECTED_A: &str = include_str!("../../../../fixtures/lgh154-a.expected.json");

    fn name(text: &str) -> RoomName {
        RoomName::new(text).expect("valid room name")
    }

    fn fid(room: &str, side: Side) -> FaceId {
        FaceId {
            room: name(room),
            side,
        }
    }

    fn e(
        axis: Axis,
        from: FaceId,
        to: FaceId,
        value: Mm,
        tolerance: Mm,
        origin: &str,
        source: Option<Source>,
    ) -> Edge {
        Edge {
            axis,
            from,
            to,
            value,
            tolerance,
            origin: origin.to_string(),
            source,
        }
    }

    /// Fixture A's edges, derived by hand from the DSL and the §6.1 table
    /// (the expected JSON has no edge list).
    fn fixture_a_edges() -> Vec<Edge> {
        use Axis::{X, Y};
        use Side::{East, North, South, West};
        vec![
            e(
                X,
                fid("Garderob", West),
                fid("Garderob", East),
                1860,
                3,
                "room Garderob width",
                Some(Source::Laser),
            ),
            e(
                Y,
                fid("Garderob", North),
                fid("Garderob", South),
                2360,
                3,
                "room Garderob depth",
                Some(Source::Laser),
            ),
            e(
                X,
                fid("Sovrum", West),
                fid("Sovrum", East),
                1860,
                3,
                "room Sovrum width",
                Some(Source::Laser),
            ),
            e(
                Y,
                fid("Sovrum", North),
                fid("Sovrum", South),
                2090,
                3,
                "room Sovrum depth",
                Some(Source::Laser),
            ),
            e(
                X,
                fid("Hall", West),
                fid("Hall", East),
                1100,
                10,
                "room Hall width",
                Some(Source::Assumed),
            ),
            e(
                X,
                fid("WC", West),
                fid("WC", East),
                2370,
                3,
                "room WC width",
                Some(Source::Laser),
            ),
            e(
                Y,
                fid("WC", North),
                fid("WC", South),
                990,
                3,
                "room WC depth",
                Some(Source::Laser),
            ),
            e(
                X,
                fid("Vardagsrum", West),
                fid("Vardagsrum", East),
                3560,
                3,
                "room Vardagsrum width",
                Some(Source::Laser),
            ),
            e(
                Y,
                fid("Vardagsrum", North),
                fid("Vardagsrum", South),
                3480,
                3,
                "room Vardagsrum depth",
                Some(Source::Laser),
            ),
            e(
                Y,
                fid("Garderob", South),
                fid("Sovrum", North),
                90,
                10,
                "Sovrum south_of Garderob gap",
                Some(Source::Assumed),
            ),
            e(
                X,
                fid("Sovrum", West),
                fid("Garderob", West),
                0,
                0,
                "align west Sovrum Garderob",
                None,
            ),
            e(
                X,
                fid("Garderob", East),
                fid("Hall", West),
                121,
                30,
                "Hall east_of Garderob gap",
                Some(Source::Drawing),
            ),
            e(
                Y,
                fid("Hall", North),
                fid("Garderob", North),
                0,
                0,
                "align north Hall Garderob",
                None,
            ),
            e(
                X,
                fid("Hall", East),
                fid("WC", West),
                90,
                10,
                "WC east_of Hall gap",
                Some(Source::Assumed),
            ),
            e(
                Y,
                fid("WC", North),
                fid("Hall", North),
                0,
                0,
                "align north WC Hall",
                None,
            ),
            e(
                Y,
                fid("Hall", South),
                fid("Vardagsrum", North),
                0,
                0,
                "Vardagsrum south_of Hall open",
                None,
            ),
            e(
                Y,
                fid("WC", South),
                fid("Vardagsrum", North),
                123,
                30,
                "Vardagsrum south_of WC gap",
                Some(Source::Drawing),
            ),
            e(
                X,
                fid("Vardagsrum", West),
                fid("Hall", West),
                0,
                0,
                "align west Vardagsrum Hall",
                None,
            ),
        ]
    }

    #[test]
    fn fixture_a_edge_list_is_exact() {
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let (got, diagnostics) = edges(&plan);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        assert_eq!(got, fixture_a_edges());
    }

    #[test]
    fn fixture_a_edge_sources() {
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let (got, _) = edges(&plan);
        let source_of = |origin: &str| {
            got.iter()
                .find(|edge| edge.origin == origin)
                .unwrap_or_else(|| panic!("no edge with origin {origin}"))
                .source
        };
        assert_eq!(source_of("room Garderob width"), Some(Source::Laser));
        assert_eq!(
            source_of("Hall east_of Garderob gap"),
            Some(Source::Drawing)
        );
        let aligns: Vec<&Edge> = got
            .iter()
            .filter(|edge| edge.origin.starts_with("align"))
            .collect();
        assert_eq!(aligns.len(), 4, "fixture A has four align edges");
        for edge in aligns {
            assert_eq!(edge.source, None, "{}", edge.origin);
        }
    }

    #[test]
    fn fixture_a_edges_agree_with_expected_faces() {
        let expected: serde_json::Value =
            serde_json::from_str(EXPECTED_A).expect("expected JSON parses");
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let (got, _) = edges(&plan);
        let coord = |f: &FaceId| {
            expected["faces"][f.room.as_str()][side_name(f.side)]
                .as_i64()
                .expect("face in expected JSON")
        };
        for edge in &got {
            assert_eq!(
                coord(&edge.to) - coord(&edge.from),
                edge.value,
                "edge {}",
                edge.origin
            );
        }
    }

    #[test]
    fn reference_measure_gives_no_edge() {
        let base = "room A 1000 x 2000\nroom B 1000 x 2000\n  east_of A gap\n";
        let reference = parse(&format!(
            "{base}measure A.west to B.east = 2000 reference\n"
        ))
        .expect("parse");
        let (got, diagnostics) = edges(&reference);
        assert!(diagnostics.is_empty());
        assert_eq!(got.len(), 5, "room sizes and the relation only");
        assert!(got.iter().all(|edge| !edge.origin.starts_with("measure")));

        // The same measure without `reference` does give an edge.
        let plain = parse(&format!("{base}measure A.west to B.east = 2000\n")).expect("parse");
        let (got, diagnostics) = edges(&plain);
        assert!(diagnostics.is_empty());
        assert_eq!(got.len(), 6);
        assert_eq!(
            got[5],
            e(
                Axis::X,
                fid("A", Side::West),
                fid("B", Side::East),
                2000,
                10,
                "measure A.west to B.east",
                Some(Source::Assumed),
            )
        );
    }

    #[test]
    fn measure_across_axes_is_e010() {
        let plan = parse(
            "room Garderob 1860 x 2360\nroom Sovrum 1860 x 2090\nmeasure Garderob.north to Sovrum.west = 4490\n",
        )
        .expect("parse");
        let (got, diagnostics) = edges(&plan);
        assert_eq!(got.len(), 4, "room sizes only; the measure gives no edge");
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].code, Code::E010);
        assert_eq!(
            diagnostics[0].message,
            "Garderob.north and Sovrum.west are not parallel; measure between two north/south or two east/west faces."
        );
    }
}
