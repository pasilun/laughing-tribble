//! Preview plan for loose rooms (spec §6.4, §15 D39).
//!
//! A room that is not tied is drawn on top of the first room. For the picture
//! only, [`preview_missing`] adds the relation that each room's first "Not
//! tied" W001 suggests, so the room is drawn where the measurement says it
//! goes. The plan the user wrote is not changed.

use crate::diagnostics::{Code, Diagnostic, Severity};
use crate::intent::{Gap, Plan, Relation, RoomName, Side};
use crate::resolved::resolve_draft;
use crate::units::{Quantity, Source};

/// The plan with the assumed relations added, and the W001s that were used.
#[derive(Clone, Debug, PartialEq)]
pub struct Preview {
    /// The plan with the assumed relations added.
    pub plan: Plan,
    /// The W001s that were used, in the order used.
    pub assumed: Vec<Diagnostic>,
}

/// Whether `d` is the "Not tied" form of W001: it names a relation, the room it
/// is placed against, the room and the gap. The "width/depth unknown" form has
/// none of these and is skipped.
fn is_not_tied(d: &Diagnostic) -> bool {
    d.code == Code::W001
        && d.severity == Severity::Warning
        && ["relation", "of", "room", "gap"]
            .iter()
            .all(|key| d.data.get(*key).is_some())
}

/// The string value of `key` in a W001's `data`.
fn text<'a>(d: &'a Diagnostic, key: &str) -> Option<&'a str> {
    d.data.get(key).and_then(|v| v.as_str())
}

/// The relation a "Not tied" W001 names, with the side of the alignment it
/// implies on the other axis (D39): east/west placements align north faces,
/// north/south placements align west faces.
fn placement(d: &Diagnostic) -> Option<(Relation, Side)> {
    let room = RoomName::new(text(d, "room")?).ok()?;
    let of = RoomName::new(text(d, "of")?).ok()?;
    let mm = d.data.get("gap")?.as_i64()?;
    let gap = Gap::Wall(Quantity {
        value: mm,
        source: Source::Assumed,
        tolerance: Source::Assumed.default_tolerance(),
    });
    let relation = match text(d, "relation")? {
        "east_of" => Relation::EastOf {
            subject: room,
            of,
            gap,
        },
        "west_of" => Relation::WestOf {
            subject: room,
            of,
            gap,
        },
        "south_of" => Relation::SouthOf {
            subject: room,
            of,
            gap,
        },
        "north_of" => Relation::NorthOf {
            subject: room,
            of,
            gap,
        },
        _ => return None,
    };
    let side = match relation {
        Relation::EastOf { .. } | Relation::WestOf { .. } => Side::North,
        _ => Side::West,
    };
    Some((relation, side))
}

/// Add, for every room that is not tied, the relation its first W001 suggests
/// (D39). Pure: `plan` is not changed. At most `plan.order.len()` rounds run.
pub fn preview_missing(plan: &Plan) -> Preview {
    let mut current = plan.clone();
    let mut assumed = Vec::new();
    for _ in 0..plan.order.len() {
        let (_, diags) = resolve_draft(&current);
        let Some(first) = diags.iter().find(|d| is_not_tied(d)) else {
            break;
        };
        let Some((relation, side)) = placement(first) else {
            break;
        };
        let room = first.data["room"].as_str().unwrap_or_default().to_string();
        let axis = text(first, "axis").unwrap_or_default().to_string();
        let other_axis = match axis.as_str() {
            "x" => "y",
            "y" => "x",
            _ => "",
        };
        let other_tied = diags.iter().any(|d| {
            is_not_tied(d)
                && text(d, "room") == Some(room.as_str())
                && text(d, "axis") == Some(other_axis)
        });
        let of = text(first, "of").unwrap_or_default().to_string();
        let first = first.clone();
        current.relations.push(relation);
        if other_tied && let (Ok(a), Ok(b)) = (RoomName::new(of), RoomName::new(room)) {
            current.relations.push(Relation::Align {
                side,
                rooms: vec![a, b],
            });
        }
        assumed.push(first);
    }
    Preview {
        plan: current,
        assumed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::resolved::resolve;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");

    fn room_plan(rooms: &str) -> Result<Plan, Box<dyn std::error::Error>> {
        let src = format!(
            "plan \"preview\"\ndefault_wall 90 source assumed\ndefault_outer_wall 300 source assumed\n{rooms}"
        );
        Ok(parse(&src).map_err(|d| format!("{d:?}"))?)
    }

    fn has_not_tied(diags: &[Diagnostic]) -> bool {
        diags.iter().any(is_not_tied)
    }

    #[test]
    fn two_rooms_are_placed_where_w001_suggests() -> Result<(), Box<dyn std::error::Error>> {
        let plan = room_plan("room A 2000 x 1000 source laser\nroom B 1500 x 1000 source laser\n")?;
        let preview = preview_missing(&plan);

        assert_eq!(preview.assumed.len(), 1, "{:?}", preview.assumed);
        assert_eq!(preview.assumed[0].data["room"], "B");
        assert_eq!(preview.assumed[0].data["relation"], "east_of");

        let (resolved, diags) = resolve(&preview.plan);
        assert!(!has_not_tied(&diags), "{diags:?}");
        let resolved = resolved.ok_or("preview plan does not resolve")?;
        let b = resolved.rooms[&RoomName::new("B")?];
        assert_eq!(b.west, 2090);
        assert_eq!(b.east, 3590);
        assert_eq!(b.north, 0);
        assert_eq!(b.south, 1000);
        Ok(())
    }

    #[test]
    fn fixture_a_needs_no_preview() -> Result<(), Box<dyn std::error::Error>> {
        let plan = parse(FIXTURE_A).map_err(|d| format!("{d:?}"))?;
        let preview = preview_missing(&plan);
        assert!(preview.assumed.is_empty(), "{:?}", preview.assumed);
        assert_eq!(preview.plan, plan);
        Ok(())
    }

    #[test]
    fn three_rooms_are_all_tied_in_the_preview() -> Result<(), Box<dyn std::error::Error>> {
        let plan = room_plan(
            "room A 2000 x 1000 source laser\nroom B 1500 x 1000 source laser\nroom C 1200 x 1000 source laser\n",
        )?;
        let preview = preview_missing(&plan);

        let (_, diags) = resolve(&preview.plan);
        assert!(!has_not_tied(&diags), "{diags:?}");
        assert_eq!(preview.assumed.len(), 2, "{:?}", preview.assumed);
        Ok(())
    }
}
