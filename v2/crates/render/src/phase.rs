//! Before and after views of a resolved plan (spec §15 D43, card W4-12).
//!
//! [`phase_view`] returns a copy of a [`Resolved`] as it looks before or after
//! the works: what is new is dropped on the "before" side, what is demolished
//! on the "after" side, and what remains is drawn as ordinary walls.

use plan_core::{Phase, Resolved};

use crate::sheet::Lang;

/// Which state of the works to draw (spec §15 D43).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PhaseView {
    /// The plan as it is, with every phase.
    All,
    /// The building today: what is new is left out.
    Before,
    /// The finished building: what is demolished is left out.
    After,
}

/// A copy of `resolved` as it looks before or after the works (D43).
///
/// - `All`: a plain clone.
/// - `Before`: walls and openings with phase `New` are removed; walls and
///   openings with phase `Demolish` stay and become `Existing`. Rooms whose
///   `room_phases` entry is `New` are removed from `rooms` and `room_phases`.
/// - `After`: walls and openings with phase `Demolish` are removed; `New` ones
///   stay and become `Existing`. Rooms whose phase is `Demolish` are removed.
///
/// In both views an opening whose wall was removed is removed too. `nodes`,
/// `spaces` and `diagnostics` are copied unchanged.
pub fn phase_view(resolved: &Resolved, view: PhaseView) -> Resolved {
    let mut out = resolved.clone();
    let (removed, kept_as_existing) = match view {
        PhaseView::All => return out,
        PhaseView::Before => (Phase::New, Phase::Demolish),
        PhaseView::After => (Phase::Demolish, Phase::New),
    };

    out.walls.retain(|_, wall| wall.phase != removed);
    for wall in out.walls.values_mut() {
        if wall.phase == kept_as_existing {
            wall.phase = Phase::Existing;
        }
    }

    let walls = &out.walls;
    out.openings
        .retain(|_, opening| opening.phase != removed && walls.contains_key(&opening.wall));
    for opening in out.openings.values_mut() {
        if opening.phase == kept_as_existing {
            opening.phase = Phase::Existing;
        }
    }

    let gone: Vec<_> = out
        .room_phases
        .iter()
        .filter(|(_, phase)| **phase == removed)
        .map(|(name, _)| name.clone())
        .collect();
    for name in &gone {
        out.rooms.remove(name);
        out.room_phases.remove(name);
    }
    out
}

/// The sheet title for a view (spec §15 D43): `name` with the suffix ` – existing`
/// (Swedish ` – före`) before, ` – proposed` (Swedish ` – efter`) after, and
/// `name` alone for `All`.
pub fn sheet_title(name: &str, view: PhaseView, lang: Lang) -> String {
    let suffix = match (view, lang) {
        (PhaseView::All, _) => "",
        (PhaseView::Before, Lang::En) => " – existing",
        (PhaseView::Before, Lang::Sv) => " – före",
        (PhaseView::After, Lang::En) => " – proposed",
        (PhaseView::After, Lang::Sv) => " – efter",
    };
    format!("{name}{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use plan_core::{RoomName, load};

    fn room(name: &str) -> RoomName {
        RoomName::new(name).expect("valid room name")
    }

    const REVIEW_1: &str = include_str!("../../../fixtures/review-1.plan");

    fn review_1() -> Resolved {
        load(REVIEW_1)
            .expect("review-1 parses")
            .resolved
            .expect("review-1 resolves")
    }

    const WALL: &str = "W:A.east|B.west";
    const DOOR: &str = "O:A.north:1";
    const WINDOW: &str = "O:B.south:1";

    #[test]
    fn fixture_has_the_expected_phases() {
        let r = review_1();
        assert_eq!(r.walls[WALL].phase, Phase::Demolish);
        assert_eq!(r.openings[DOOR].phase, Phase::New);
        assert_eq!(r.openings[WINDOW].phase, Phase::New);
        assert_eq!(r.room_phases.get(&room("B")), Some(&Phase::Demolish));
    }

    #[test]
    fn before_keeps_demolished_wall_as_existing_and_drops_new_openings() {
        let r = phase_view(&review_1(), PhaseView::Before);
        assert_eq!(r.walls[WALL].phase, Phase::Existing);
        assert!(!r.openings.contains_key(DOOR));
        assert!(!r.openings.contains_key(WINDOW));
        assert!(r.rooms.contains_key(&room("A")));
        assert!(r.rooms.contains_key(&room("B")));
    }

    #[test]
    fn after_drops_demolished_wall_and_keeps_new_openings_as_existing() {
        let r = phase_view(&review_1(), PhaseView::After);
        assert!(!r.walls.contains_key(WALL));
        assert_eq!(r.openings[DOOR].phase, Phase::Existing);
        assert_eq!(r.openings[WINDOW].phase, Phase::Existing);
        assert!(!r.rooms.contains_key(&room("B")));
        assert!(r.rooms.contains_key(&room("A")));
    }

    #[test]
    fn all_equals_the_input() {
        let input = review_1();
        assert_eq!(phase_view(&input, PhaseView::All), input);
    }

    #[test]
    fn nodes_spaces_and_diagnostics_are_unchanged() {
        let input = review_1();
        for view in [PhaseView::Before, PhaseView::After] {
            let r = phase_view(&input, view);
            assert_eq!(r.nodes, input.nodes);
            assert_eq!(r.spaces, input.spaces);
            assert_eq!(r.diagnostics, input.diagnostics);
        }
    }

    #[test]
    fn sheet_title_suffixes() {
        assert_eq!(sheet_title("Lgh 154", PhaseView::All, Lang::Sv), "Lgh 154");
        assert_eq!(
            sheet_title("Lgh 154", PhaseView::Before, Lang::Sv),
            "Lgh 154 – före"
        );
        assert_eq!(
            sheet_title("Lgh 154", PhaseView::Before, Lang::En),
            "Lgh 154 – existing"
        );
        assert_eq!(
            sheet_title("Lgh 154", PhaseView::After, Lang::En),
            "Lgh 154 – proposed"
        );
        assert_eq!(
            sheet_title("Lgh 154", PhaseView::After, Lang::Sv),
            "Lgh 154 – efter"
        );
    }
}
