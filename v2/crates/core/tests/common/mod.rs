//! Proptest strategies shared by the integration tests (spec §15 D7).
//!
//! [`arb_plan`] makes random plans that the DSL can express. Every plan is
//! canonical: it goes through `canonicalize` before it is returned.
//!
//! Limits, each set by what the DSL text can carry:
//! - Names are `[A-Za-z0-9 ]` (plan name) or room names that are not keywords.
//! - A room's width and depth share one `source` clause, as the printer writes
//!   one clause per room.
//! - An opening's width shares the source and tolerance of its `at`, as the
//!   printer writes one clause from `at`.

use plan_core::dsl::canonicalize;
use plan_core::intent::{Fixture, FixtureKind};
use plan_core::{
    FaceRef, Gap, Measure, Mm, Opening, OpeningKind, Phase, Plan, Quantity, Relation, Room,
    RoomName, Side, Source, WallOverride,
};
use proptest::prelude::*;
use std::collections::{BTreeMap, HashSet};

/// Keywords of the DSL. A generated room name must not be one of these.
const KEYWORDS: &[&str] = &[
    "plan",
    "title",
    "default_wall",
    "default_outer_wall",
    "room",
    "x",
    "apartment",
    "existing",
    "demolish",
    "new",
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
    "at",
    "width",
    "depth",
    "offset",
    "label",
    "height",
    "hinge",
    "opens",
    "source",
    "tol",
    "wall",
    "thickness",
    "bearing",
    "fire",
    "north",
    "east",
    "south",
    "west",
    "laser",
    "tape",
    "printed",
    "drawing",
    "estimated",
    "assumed",
];

/// A random plan the DSL can express, in canonical form.
pub fn arb_plan() -> impl Strategy<Value = Plan> {
    room_names()
        .prop_flat_map(|names| {
            (
                plan_name(),
                qty(),
                qty(),
                names.iter().cloned().map(room).collect::<Vec<_>>(),
                relations(names.clone()),
                collection_measures(names.clone()),
                collection_walls(names.clone()),
                collection_openings(names.clone()),
                collection_fixtures(names.clone()),
                title(),
            )
                .prop_map(
                    move |(
                        name,
                        default_wall,
                        default_outer_wall,
                        rooms,
                        relations,
                        measures,
                        wall_overrides,
                        openings,
                        fixtures,
                        title,
                    )| {
                        Plan {
                            name,
                            default_wall,
                            default_outer_wall,
                            rooms: rooms.iter().map(|r| (r.name.clone(), r.clone())).collect(),
                            order: names.clone(),
                            relations,
                            measures,
                            openings,
                            fixtures,
                            wall_overrides,
                            title,
                        }
                    },
                )
        })
        .prop_map(|mut plan| {
            canonicalize(&mut plan);
            plan
        })
}

/// The title block: zero to two of the seven keys, each with a fixed text that
/// has no double quotes.
fn title() -> impl Strategy<Value = BTreeMap<String, String>> {
    const KEYS: [&str; 7] = [
        "property",
        "address",
        "applicant",
        "drawing",
        "drawn_by",
        "date",
        "description",
    ];
    const TEXTS: [&str; 4] = ["Gnejsen 6", "A-01", "2026-11-10", "Stockholm"];
    prop::collection::btree_map(
        prop::sample::select(KEYS.to_vec()),
        prop::sample::select(TEXTS.to_vec()),
        0..=2,
    )
    .prop_map(|map| {
        map.into_iter()
            .map(|(key, text)| (key.to_string(), text.to_string()))
            .collect()
    })
}

/// The plan name: letters, digits and spaces, up to 20 characters.
fn plan_name() -> impl Strategy<Value = String> {
    "[A-Za-z0-9 ]{0,20}"
}

/// 1 to 6 unique room names that are not DSL keywords, in declaration order.
fn room_names() -> impl Strategy<Value = Vec<RoomName>> {
    prop::collection::vec("[A-Za-zÅÄÖåäö][A-Za-zÅÄÖåäö0-9_]{0,7}", 1..=6)
        .prop_filter("unique and not a keyword", |names| {
            let mut seen = HashSet::new();
            names
                .iter()
                .all(|n| !KEYWORDS.contains(&n.as_str()) && seen.insert(n.as_str()))
        })
        .prop_map(|names| {
            names
                .into_iter()
                .map(|n| RoomName::new(n).expect("generated room names are valid"))
                .collect()
        })
}

/// The source and tolerance that a whole clause carries.
#[derive(Clone, Copy, Debug)]
struct Spec {
    source: Source,
    tolerance: Mm,
}

fn source() -> impl Strategy<Value = Source> {
    prop::sample::select(vec![
        Source::Laser,
        Source::Tape,
        Source::Printed,
        Source::Drawing,
        Source::Estimated,
        Source::Assumed,
    ])
}

/// A source with its default tolerance, or a tolerance of 0..=100 mm.
fn spec() -> impl Strategy<Value = Spec> {
    (source(), any::<bool>(), 0..=100i64).prop_map(|(source, use_default, tol)| Spec {
        source,
        tolerance: if use_default {
            source.default_tolerance()
        } else {
            tol
        },
    })
}

fn quantity(value: Mm, spec: Spec) -> Quantity {
    Quantity {
        value,
        source: spec.source,
        tolerance: spec.tolerance,
    }
}

/// A quantity of 0..=20000 mm with any source and tolerance.
fn qty() -> impl Strategy<Value = Quantity> {
    (0..=20000i64, spec()).prop_map(|(value, spec)| quantity(value, spec))
}

fn side() -> impl Strategy<Value = Side> {
    prop::sample::select(vec![Side::North, Side::East, Side::South, Side::West])
}

fn phase() -> impl Strategy<Value = Phase> {
    prop::sample::select(vec![Phase::Existing, Phase::Demolish, Phase::New])
}

fn face(names: Vec<RoomName>) -> impl Strategy<Value = FaceRef> {
    (prop::sample::select(names), side()).prop_map(|(room, side)| FaceRef { room, side })
}

/// A room of 1..=20000 mm per side (`None` = `?`), one shared source spec,
/// an optional apartment and any phase.
fn room(name: RoomName) -> impl Strategy<Value = Room> {
    (
        prop::option::of(1..=20000i64),
        prop::option::of(1..=20000i64),
        spec(),
        prop::option::of("[A-Za-z0-9 ]{1,8}"),
        phase(),
    )
        .prop_map(move |(width, depth, spec, apartment, phase)| Room {
            name: name.clone(),
            width: width.map(|v| quantity(v, spec)),
            depth: depth.map(|v| quantity(v, spec)),
            apartment,
            phase,
        })
}

fn gap() -> impl Strategy<Value = Gap> {
    prop_oneof![Just(Gap::Open), qty().prop_map(Gap::Wall)]
}

/// A directional relation of `subject` to one of `earlier` rooms.
fn directional(subject: RoomName, earlier: Vec<RoomName>) -> impl Strategy<Value = Relation> {
    (prop::sample::select(earlier), 0..4usize, gap()).prop_map(move |(of, kind, gap)| {
        let subject = subject.clone();
        match kind {
            0 => Relation::EastOf { subject, of, gap },
            1 => Relation::WestOf { subject, of, gap },
            2 => Relation::SouthOf { subject, of, gap },
            _ => Relation::NorthOf { subject, of, gap },
        }
    })
}

/// An align of 1 to 3 distinct rooms, in random order (so the first room is
/// any room).
fn align(names: Vec<RoomName>) -> impl Strategy<Value = Relation> {
    let max = names.len().min(3);
    (
        side(),
        prop::sample::subsequence(names, 1..=max).prop_shuffle(),
    )
        .prop_map(|(side, rooms)| Relation::Align { side, rooms })
}

/// Directional relations for each room after the first (0 to 2 each), then
/// 0 to 2 aligns.
fn relations(names: Vec<RoomName>) -> impl Strategy<Value = Vec<Relation>> {
    let per_room: Vec<BoxedStrategy<Vec<Relation>>> = (0..names.len())
        .map(|i| {
            if i == 0 {
                Just(Vec::<Relation>::new()).boxed()
            } else {
                prop::collection::vec(directional(names[i].clone(), names[..i].to_vec()), 0..=2)
                    .boxed()
            }
        })
        .collect();
    (per_room, prop::collection::vec(align(names.clone()), 0..=2)).prop_map(|(per_room, aligns)| {
        per_room
            .into_iter()
            .flatten()
            .chain(aligns)
            .collect::<Vec<Relation>>()
    })
}

/// A measure between two faces on the same axis, north and south or east and
/// west.
fn measure(names: Vec<RoomName>) -> impl Strategy<Value = Measure> {
    (
        any::<bool>(),
        prop::sample::select(names.clone()),
        prop::sample::select(names),
        any::<bool>(),
        any::<bool>(),
        qty(),
        any::<bool>(),
    )
        .prop_map(
            |(ns_axis, from_room, to_room, from_second, to_second, value, reference)| {
                let axis = if ns_axis {
                    [Side::North, Side::South]
                } else {
                    [Side::East, Side::West]
                };
                Measure {
                    from: FaceRef {
                        room: from_room,
                        side: axis[usize::from(from_second)],
                    },
                    to: FaceRef {
                        room: to_room,
                        side: axis[usize::from(to_second)],
                    },
                    value,
                    reference,
                }
            },
        )
}

fn collection_measures(names: Vec<RoomName>) -> impl Strategy<Value = Vec<Measure>> {
    prop::collection::vec(measure(names), 0..=3)
}

fn wall_override(names: Vec<RoomName>) -> impl Strategy<Value = WallOverride> {
    (
        face(names),
        qty(),
        any::<bool>(),
        prop::option::of(Just("EI60".to_string())),
        phase(),
    )
        .prop_map(|(face, thickness, bearing, fire, phase)| WallOverride {
            face,
            thickness: Some(thickness),
            bearing,
            fire,
            phase,
        })
}

fn collection_walls(names: Vec<RoomName>) -> impl Strategy<Value = Vec<WallOverride>> {
    prop::collection::vec(wall_override(names), 0..=2)
}

fn opening_kind() -> impl Strategy<Value = OpeningKind> {
    prop::sample::select(vec![
        OpeningKind::Door,
        OpeningKind::Window,
        OpeningKind::Passage,
    ])
}

/// An opening. Its width shares the source and tolerance of its `at`.
fn opening(names: Vec<RoomName>) -> impl Strategy<Value = Opening> {
    (
        opening_kind(),
        face(names.clone()),
        (0..=20000i64, spec()),
        1..=3000i64,
        prop::option::of(1..=3000i64),
        prop::option::of(side()),
        prop::option::of(prop::sample::select(names)),
        phase(),
    )
        .prop_map(
            |(kind, face, (at, spec), width, height, hinge, opens_into, phase)| Opening {
                kind,
                face,
                at: quantity(at, spec),
                width: quantity(width, spec),
                height,
                hinge,
                opens_into,
                phase,
            },
        )
}

fn collection_openings(names: Vec<RoomName>) -> impl Strategy<Value = Vec<Opening>> {
    prop::collection::vec(opening(names), 0..=3)
}

/// A fixture on a face of a generated room: a stove with the default size, or
/// a kitchen of 1800 by 600. `at` is 0..2000, no offset, no label, any phase.
fn fixture(names: Vec<RoomName>) -> impl Strategy<Value = Fixture> {
    (any::<bool>(), face(names), 0..2000i64, phase()).prop_map(|(kitchen, face, at, phase)| {
        let (kind, width, depth) = if kitchen {
            (FixtureKind::Kitchen, 1800, 600)
        } else {
            (FixtureKind::Stove, 600, 600)
        };
        Fixture {
            kind,
            face,
            at,
            width,
            depth,
            offset: 0,
            label: None,
            phase,
        }
    })
}

fn collection_fixtures(names: Vec<RoomName>) -> impl Strategy<Value = Vec<Fixture>> {
    prop::collection::vec(fixture(names), 0..=2)
}
