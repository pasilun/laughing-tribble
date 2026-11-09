//! Wall steps 3–7 and wall ids (spec §9.2 steps 3–7, §5.3).
//!
//! Runs on the segments of [`wall_segments`](super::walls::wall_segments), in
//! this order: bridge, extend, corner continuation, merge, deduplicate. Then
//! each surviving interior or outer segment becomes a [`BuiltWall`] with its
//! id and its body extents in mm.
//!
//! Where the spec leaves a choice open, the room pair that sorts first decides
//! (the rule given for extend). That rule is also applied to bridge, because a
//! bridged piece touches two interior segments and must join one of them.

use std::collections::BTreeMap;

use crate::intent::{FaceRef, Plan, RoomName, Side};
use crate::units::{Mm, Source};

use super::faces::Coords;
use super::walls::{SegmentKind, WallSegment, face_key, wall_segments};

/// Longest uncovered segment that a bridge may close (§9.2 step 3).
pub const BRIDGE_MAX: Mm = 600;
/// Longest uncovered segment that an extend may absorb (§9.2 step 4).
pub const EXTEND_MAX: Mm = 150;

/// Sides in the order used for every listing: north, east, south, west.
const SIDES: [Side; 4] = [Side::North, Side::East, Side::South, Side::West];

/// A wall after steps 3–7, with its id (§5.3) and its body in mm.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BuiltWall {
    /// The semantic id: `W:<A>.<side>|<B>.<side>` with room names sorted for
    /// interior walls, `W:<Room>.<side>:outer` for outer walls, `#n` appended
    /// when one face has several walls of the same id.
    pub id: String,
    /// `Interior` or `Outer`.
    pub kind: SegmentKind,
    /// Wall thickness in mm.
    pub thickness: Mm,
    /// Where the thickness comes from.
    pub source: Source,
    /// `true` when the interior thickness is derived from the distance between
    /// the faces (the I010 marker).
    pub derived: bool,
    /// The room face the wall was produced from.
    pub face: FaceRef,
    /// The facing face across an interior wall; `None` for outer walls.
    pub other: Option<FaceRef>,
    /// Extent along x in mm, as `(min, max)`.
    pub x: (Mm, Mm),
    /// Extent along y in mm, as `(min, max)`.
    pub y: (Mm, Mm),
}

/// Interior and outer walls of `plan` after §9.2 steps 3–7, sorted by id.
///
/// Open stretches produce no wall. Pure: no I/O.
pub fn built_walls(plan: &Plan, coords: &Coords) -> Vec<BuiltWall> {
    let mut segs = wall_segments(plan, coords);
    bridge(&mut segs);
    extend(&mut segs);
    corner_continuation(&mut segs, coords);
    merge(&mut segs);
    deduplicate(&mut segs);
    let mut out: Vec<BuiltWall> = segs.iter().filter_map(|seg| build(seg, coords)).collect();
    number_ids(&mut out);
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

/// Step 3. An outer segment no longer than [`BRIDGE_MAX`] whose neighbours on
/// the same face are interior with the same thickness becomes interior.
fn bridge(segs: &mut [WallSegment]) {
    let before = segs.to_vec();
    for (i, seg) in before.iter().enumerate() {
        if seg.kind != SegmentKind::Outer || length(seg) > BRIDGE_MAX {
            continue;
        }
        let (Some(left), Some(right)) = (neighbour(&before, i, false), neighbour(&before, i, true))
        else {
            continue;
        };
        if left.kind != SegmentKind::Interior
            || right.kind != SegmentKind::Interior
            || left.thickness != right.thickness
        {
            continue;
        }
        let from = first_pair(left, right).clone();
        adopt(&mut segs[i], &from);
    }
}

/// Step 4. An outer segment no longer than [`EXTEND_MAX`] that touches an
/// interior segment joins it and takes its thickness. With two such neighbours
/// it joins the one whose room pair sorts first.
fn extend(segs: &mut [WallSegment]) {
    let before = segs.to_vec();
    for (i, seg) in before.iter().enumerate() {
        if seg.kind != SegmentKind::Outer || length(seg) > EXTEND_MAX {
            continue;
        }
        let touching: Vec<&WallSegment> = [false, true]
            .into_iter()
            .filter_map(|forward| neighbour(&before, i, forward))
            .filter(|n| n.kind == SegmentKind::Interior)
            .collect();
        let chosen = match touching.as_slice() {
            [] => continue,
            [only] => *only,
            [a, b, ..] => first_pair(a, b),
        };
        let from = chosen.clone();
        adopt(&mut segs[i], &from);
    }
}

/// Step 5. For each compass side, consecutive outer segments whose gap is
/// covered across its whole length by interior walls that end at the facade
/// line are continued: the earlier one is extended to the start of the later.
fn corner_continuation(segs: &mut [WallSegment], coords: &Coords) {
    let bodies: Vec<Body> = segs
        .iter()
        .filter(|s| s.kind == SegmentKind::Interior)
        .filter_map(|s| body(s, coords))
        .collect();
    for side in SIDES {
        let horizontal = matches!(side, Side::North | Side::South);
        let mut idx: Vec<usize> = (0..segs.len())
            .filter(|&i| segs[i].kind == SegmentKind::Outer && segs[i].face.side == side)
            .collect();
        idx.sort_by_key(|&i| segs[i].start);
        for pair in idx.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            let (from, to) = (segs[a].end, segs[b].start);
            if from >= to {
                continue;
            }
            let Some(line) = line_of(&segs[a].face, coords) else {
                continue;
            };
            let spans: Vec<(Mm, Mm)> = bodies
                .iter()
                .filter(|w| {
                    let (across, along) = if horizontal { (w.y, w.x) } else { (w.x, w.y) };
                    across.0 <= line && line <= across.1 && along.0 <= from && to <= along.1
                })
                .map(|w| if horizontal { w.x } else { w.y })
                .collect();
            if covers(spans, from, to) {
                segs[a].end = to;
            }
        }
    }
}

/// Step 6. Adjacent segments on one face with the same kind, thickness, source,
/// derived flag and room pair become one segment.
fn merge(segs: &mut Vec<WallSegment>) {
    let mut out: Vec<WallSegment> = Vec::with_capacity(segs.len());
    for seg in segs.drain(..) {
        if let Some(last) = out.last_mut()
            && same_run(last, &seg)
        {
            last.end = seg.end;
            continue;
        }
        out.push(seg);
    }
    *segs = out;
}

/// Step 7. An interior wall is produced once: when segment `i` and a later
/// segment `j` are the two faces of one wall (each covered by the other, same
/// thickness, overlapping), the earlier one is kept, spanning both.
fn deduplicate(segs: &mut Vec<WallSegment>) {
    let mut removed = vec![false; segs.len()];
    for i in 0..segs.len() {
        if removed[i] || segs[i].kind != SegmentKind::Interior {
            continue;
        }
        for j in (i + 1)..segs.len() {
            if removed[j] || !is_copy(&segs[i], &segs[j]) {
                continue;
            }
            let (start, end) = (segs[j].start, segs[j].end);
            segs[i].start = segs[i].start.min(start);
            segs[i].end = segs[i].end.max(end);
            removed[j] = true;
        }
    }
    let mut k = 0;
    segs.retain(|_| {
        let keep = !removed[k];
        k += 1;
        keep
    });
}

/// Body of a wall in mm: the along-face span, and the thickness measured
/// outward from the face line.
#[derive(Clone, Copy, Debug)]
struct Body {
    x: (Mm, Mm),
    y: (Mm, Mm),
}

/// The body of `seg`, or `None` when its line or thickness is missing.
fn body(seg: &WallSegment, coords: &Coords) -> Option<Body> {
    let thickness = seg.thickness?;
    let line = line_of(&seg.face, coords)?;
    let (near, far) = match seg.face.side {
        Side::East | Side::South => (line, line + thickness),
        Side::West | Side::North => (line - thickness, line),
    };
    let span = (seg.start, seg.end);
    Some(match seg.face.side {
        Side::North | Side::South => Body {
            x: span,
            y: (near, far),
        },
        Side::East | Side::West => Body {
            x: (near, far),
            y: span,
        },
    })
}

/// The face line of `face`: its y for a north or south face, its x for an east
/// or west face.
fn line_of(face: &FaceRef, coords: &Coords) -> Option<Mm> {
    let key = face_key(&face.room, face.side);
    match face.side {
        Side::North | Side::South => coords.y.get(&key).copied(),
        Side::East | Side::West => coords.x.get(&key).copied(),
    }
}

/// Build the wall for one surviving segment, or `None` for an open stretch.
fn build(seg: &WallSegment, coords: &Coords) -> Option<BuiltWall> {
    let kind = match seg.kind {
        SegmentKind::Open => return None,
        kind => kind,
    };
    let thickness = seg.thickness?;
    let source = seg.source?;
    let extent = body(seg, coords)?;
    let other = match kind {
        SegmentKind::Interior => seg.covered_by.clone(),
        _ => None,
    };
    Some(BuiltWall {
        id: base_id(&seg.face, other.as_ref()),
        kind,
        thickness,
        source,
        derived: seg.derived,
        face: seg.face.clone(),
        other,
        x: extent.x,
        y: extent.y,
    })
}

/// The id before numbering: interior walls name both faces with the room names
/// sorted; outer walls name their own face.
fn base_id(face: &FaceRef, other: Option<&FaceRef>) -> String {
    match other {
        Some(other) => {
            let mut pair = [face_label(face), face_label(other)];
            let names = [face.room.as_str(), other.room.as_str()];
            if names[1] < names[0] {
                pair.swap(0, 1);
            }
            format!("W:{}|{}", pair[0], pair[1])
        }
        None => format!("W:{}:outer", face_label(face)),
    }
}

/// `Room.side`, as used in wall ids.
fn face_label(face: &FaceRef) -> String {
    let side = match face.side {
        Side::North => "north",
        Side::East => "east",
        Side::South => "south",
        Side::West => "west",
    };
    format!("{}.{}", face.room.as_str(), side)
}

/// Append `#n` to the second and later walls that share an id.
fn number_ids(walls: &mut [BuiltWall]) {
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    for wall in walls {
        let count = seen.entry(wall.id.clone()).or_insert(0);
        *count += 1;
        if *count > 1 {
            wall.id = format!("{}#{}", wall.id, count);
        }
    }
}

/// The segment after `i` (`forward`) or before it, when it lies on the same face.
fn neighbour(segs: &[WallSegment], i: usize, forward: bool) -> Option<&WallSegment> {
    let j = if forward {
        i.checked_add(1)?
    } else {
        i.checked_sub(1)?
    };
    let other = segs.get(j)?;
    (other.face == segs[i].face).then_some(other)
}

/// The one of `a` and `b` whose room pair sorts first; `a` on a tie.
fn first_pair<'a>(a: &'a WallSegment, b: &'a WallSegment) -> &'a WallSegment {
    if pair_key(b) < pair_key(a) { b } else { a }
}

/// The sorted room pair of an interior segment, `None` for other kinds.
fn pair_key(seg: &WallSegment) -> Option<(RoomName, RoomName)> {
    let other = seg.covered_by.as_ref()?;
    let (a, b) = (seg.face.room.clone(), other.room.clone());
    Some(if b < a { (b, a) } else { (a, b) })
}

/// Make `seg` an interior segment with the thickness, source, derived flag and
/// covering face of `from`.
fn adopt(seg: &mut WallSegment, from: &WallSegment) {
    seg.kind = SegmentKind::Interior;
    seg.thickness = from.thickness;
    seg.source = from.source;
    seg.derived = from.derived;
    seg.covered_by = from.covered_by.clone();
}

/// Length of a segment in mm.
fn length(seg: &WallSegment) -> Mm {
    seg.end - seg.start
}

/// `true` when `b` continues `a` on the same face with the same kind,
/// thickness, source, derived flag and room pair.
fn same_run(a: &WallSegment, b: &WallSegment) -> bool {
    a.face == b.face
        && a.end == b.start
        && a.kind == b.kind
        && a.thickness == b.thickness
        && a.source == b.source
        && a.derived == b.derived
        && a.covered_by.as_ref().map(|f| &f.room) == b.covered_by.as_ref().map(|f| &f.room)
}

/// `true` when `a` and `b` are the two faces of one interior wall.
fn is_copy(a: &WallSegment, b: &WallSegment) -> bool {
    a.kind == SegmentKind::Interior
        && b.kind == SegmentKind::Interior
        && a.covered_by.as_ref() == Some(&b.face)
        && b.covered_by.as_ref() == Some(&a.face)
        && a.thickness == b.thickness
        && a.start < b.end
        && b.start < a.end
}

/// `true` when the intervals in `spans` together cover `[from, to]`.
fn covers(mut spans: Vec<(Mm, Mm)>, from: Mm, to: Mm) -> bool {
    spans.sort_unstable();
    let mut reach = from;
    for (start, end) in spans {
        if start <= reach && end > reach {
            reach = end;
        }
    }
    reach >= to
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::solve::{Axis, Edge, assign_coords, components, edges};
    use serde_json::json;

    const FIXTURE_A: &str = include_str!("../../../../fixtures/lgh154-a.plan");
    const EXPECTED_A: &str = include_str!("../../../../fixtures/lgh154-a.expected.json");

    /// Solve one axis the way `tree.rs` does: edges, components, coordinates.
    fn solve_axis(
        plan: &Plan,
        edge_list: &[Edge],
        axis: Axis,
    ) -> std::collections::BTreeMap<crate::solve::FaceKey, Mm> {
        let (comps, _) = components(edge_list, plan, axis);
        let (coord, _) = assign_coords(edge_list, &comps, axis);
        coord
    }

    /// Solved coordinates of both axes for `plan`.
    fn solved(plan: &Plan) -> Coords {
        let (edge_list, _) = edges(plan);
        Coords {
            x: solve_axis(plan, &edge_list, Axis::X),
            y: solve_axis(plan, &edge_list, Axis::Y),
        }
    }

    /// The walls of `plan` with the given id, in id order.
    fn walls_with_id(plan: &Plan, id: &str) -> Vec<BuiltWall> {
        built_walls(plan, &solved(plan))
            .into_iter()
            .filter(|w| w.id == id)
            .collect()
    }

    #[test]
    fn fixture_a_interior_walls_match_expected_json() {
        let expected: serde_json::Value =
            serde_json::from_str(EXPECTED_A).expect("expected JSON parses");
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let walls = built_walls(&plan, &solved(&plan));
        // Compared fields: id, thickness, x and y (exact). The expected file
        // carries no source or derived fields, so those are not compared here.
        let got: Vec<serde_json::Value> = walls
            .iter()
            .filter(|w| w.kind == SegmentKind::Interior)
            .map(|w| {
                json!({
                    "id": w.id,
                    "thickness": w.thickness,
                    "x": [w.x.0, w.x.1],
                    "y": [w.y.0, w.y.1],
                })
            })
            .collect();
        let want: Vec<serde_json::Value> = expected["interior_walls"]
            .as_array()
            .expect("interior_walls is a list")
            .iter()
            .map(|w| {
                json!({
                    "id": w["id"],
                    "thickness": w["thickness"],
                    "x": w["x"],
                    "y": w["y"],
                })
            })
            .collect();
        assert_eq!(got, want);
    }

    /// Room A (2000 x 3000) with B at the north end and C at the south end of
    /// its east face, both 90 mm off it. B is 1000 deep, so the uncovered piece
    /// between them runs from y 1000 to C's north end; `c_depth` sets C's depth.
    fn bridge_plan(c_depth: i64) -> Plan {
        let src = format!(
            "room A 2000 x 3000\n\
             room B 1000 x 1000\n  east_of A gap 90\n  align north A\n\
             room C 1000 x {c_depth}\n  east_of A gap 90\n  align south A\n"
        );
        parse(&src).expect("bridge plan parses")
    }

    #[test]
    fn bridge_closes_a_600_mm_gap_but_not_601_mm() {
        // 600 mm between B (ends at y 1000) and C (starts at y 1600): bridged,
        // so A's east wall to B runs from y 0 to y 1600 and no outer wall is left.
        let plan = bridge_plan(1400);
        let walls = built_walls(&plan, &solved(&plan));
        assert!(!walls.iter().any(|w| w.kind == SegmentKind::Outer
            && w.face.room.as_str() == "A"
            && w.face.side == Side::East));
        let ab = walls_with_id(&plan, "W:A.east|B.west");
        assert_eq!(ab.len(), 1);
        assert_eq!(
            (ab[0].thickness, ab[0].x, ab[0].y),
            (90, (2000, 2090), (0, 1600))
        );
        let ac = walls_with_id(&plan, "W:A.east|C.west");
        assert_eq!(ac.len(), 1);
        assert_eq!(ac[0].y, (1600, 3000));

        // 601 mm: not bridged. The piece stays an outer wall, and B and C keep
        // their own spans.
        let plan = bridge_plan(1399);
        let walls = built_walls(&plan, &solved(&plan));
        let outer: Vec<&BuiltWall> = walls
            .iter()
            .filter(|w| {
                w.kind == SegmentKind::Outer
                    && w.face.room.as_str() == "A"
                    && w.face.side == Side::East
            })
            .collect();
        assert_eq!(outer.len(), 1);
        assert_eq!(outer[0].id, "W:A.east:outer");
        let ab = walls_with_id(&plan, "W:A.east|B.west");
        assert_eq!(ab.len(), 1);
        assert_eq!(ab[0].y, (0, 1000));
        let ac = walls_with_id(&plan, "W:A.east|C.west");
        assert_eq!(ac.len(), 1);
        assert_eq!(ac[0].y, (1601, 3000));
    }

    #[test]
    fn extended_piece_merges_with_its_neighbour() {
        // A's east face is 1100 deep; B covers 0..1000 of it. The 100 mm piece
        // 1000..1100 touches B's wall, extends it, and must merge into it: one
        // wall A.east|B.west from y 0 to y 1100, not a second copy.
        let plan =
            parse("room A 1000 x 1100\nroom B 1000 x 1000\n  east_of A gap 90\n  align north A\n")
                .expect("merge plan parses");
        let walls = built_walls(&plan, &solved(&plan));
        let ab: Vec<&BuiltWall> = walls
            .iter()
            .filter(|w| w.id.starts_with("W:A.east|B.west"))
            .collect();
        assert_eq!(ab.len(), 1, "one wall, no #2 copy: {ab:?}");
        assert_eq!(ab[0].kind, SegmentKind::Interior);
        assert_eq!(ab[0].thickness, 90);
        assert_eq!(ab[0].y, (0, 1100));
        assert_eq!(ab[0].x, (1000, 1090));
    }

    #[test]
    fn number_ids_suffixes_repeats_only() {
        let face = FaceRef {
            room: RoomName::new("A").expect("name"),
            side: Side::North,
        };
        let wall = |id: &str| BuiltWall {
            id: id.to_string(),
            kind: SegmentKind::Outer,
            thickness: 90,
            source: Source::Assumed,
            derived: false,
            face: face.clone(),
            other: None,
            x: (0, 1),
            y: (0, 1),
        };
        let mut walls = vec![
            wall("W:A.north:outer"),
            wall("W:A.north:outer"),
            wall("W:B.north:outer"),
        ];
        number_ids(&mut walls);
        let ids: Vec<&str> = walls.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(
            ids,
            ["W:A.north:outer", "W:A.north:outer#2", "W:B.north:outer"]
        );
    }
}
