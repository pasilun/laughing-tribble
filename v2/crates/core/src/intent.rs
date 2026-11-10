//! Intent document: the source of truth the user writes (spec §5.2).
//!
//! Phase 1 is room-first: rooms are axis-aligned rectangles given by clear
//! size and placed relative to each other. Walls are generated from rooms.
//! Coordinates: x grows east, y grows south. Lengths are [`Mm`](crate::Mm).

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::units::{Mm, Quantity};

/// A whole plan as written by the user.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Plan {
    /// Plan name.
    pub name: String,
    /// Interior wall thickness, e.g. 90 mm assumed.
    pub default_wall: Quantity,
    /// Outer wall thickness, e.g. 300 mm assumed.
    pub default_outer_wall: Quantity,
    /// Rooms by name.
    pub rooms: BTreeMap<RoomName, Room>,
    /// Room names in declaration order.
    pub order: Vec<RoomName>,
    /// Placement relations between rooms, in declaration order.
    pub relations: Vec<Relation>,
    /// Direct measurements between parallel faces.
    pub measures: Vec<Measure>,
    /// Doors, windows and passages.
    pub openings: Vec<Opening>,
    /// Per-face wall thickness overrides.
    pub wall_overrides: Vec<WallOverride>,
    /// Title block text by key (spec §15 D41): `property`, `address`,
    /// `applicant`, `drawing`, `drawn_by`, `date` or `description`.
    #[serde(default)]
    pub title: BTreeMap<String, String>,
}

/// A room name: unique, case-sensitive, matching `[A-Za-zÅÄÖåäö0-9_]+`.
///
/// Construct with [`RoomName::new`] or `TryFrom<String>`; invalid names are
/// rejected, including during deserialization.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct RoomName(String);

/// Error returned when a string is not a valid [`RoomName`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoomNameError {
    /// The rejected input.
    pub input: String,
}

impl fmt::Display for RoomNameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "invalid room name {:?}: use letters A-Z, a-z, Å Ä Ö å ä ö, digits and '_' (at least one character)",
            self.input
        )
    }
}

impl std::error::Error for RoomNameError {}

impl RoomName {
    /// Validate and wrap a room name.
    pub fn new(name: impl Into<String>) -> Result<Self, RoomNameError> {
        let name = name.into();
        let valid = !name.is_empty()
            && name.chars().all(|c| {
                c.is_ascii_alphanumeric()
                    || c == '_'
                    || matches!(c, 'Å' | 'Ä' | 'Ö' | 'å' | 'ä' | 'ö')
            });
        if valid {
            Ok(RoomName(name))
        } else {
            Err(RoomNameError { input: name })
        }
    }

    /// The name as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for RoomName {
    type Error = RoomNameError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        RoomName::new(value)
    }
}

impl From<RoomName> for String {
    fn from(value: RoomName) -> Self {
        value.0
    }
}

impl fmt::Display for RoomName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A room given by its clear size. Unknown sizes are `None` (written `?`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Room {
    /// Unique room name.
    pub name: RoomName,
    /// East–west clear size; `None` = unknown.
    pub width: Option<Quantity>,
    /// North–south clear size; `None` = unknown.
    pub depth: Option<Quantity>,
    /// Apartment the room belongs to, if any.
    pub apartment: Option<String>,
    /// Existing, to be demolished, or new.
    pub phase: Phase,
}

/// Construction phase of a room or opening.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// Exists today.
    Existing,
    /// Exists today and will be removed.
    Demolish,
    /// Will be built.
    New,
}

/// A compass side of a room.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    /// North side (y smaller).
    North,
    /// East side (x larger).
    East,
    /// South side (y larger).
    South,
    /// West side (x smaller).
    West,
}

/// The inner face of a room on one side.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FaceRef {
    /// The room.
    pub room: RoomName,
    /// Which of its faces.
    pub side: Side,
}

/// A placement relation between rooms.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Relation {
    /// `subject` lies east of `of`; gap = wall thickness between subject.west and of.east.
    EastOf {
        /// Room being placed.
        subject: RoomName,
        /// Reference room.
        of: RoomName,
        /// Gap between the faces.
        gap: Gap,
    },
    /// `subject` lies west of `of`; gap = wall thickness between subject.east and of.west.
    WestOf {
        /// Room being placed.
        subject: RoomName,
        /// Reference room.
        of: RoomName,
        /// Gap between the faces.
        gap: Gap,
    },
    /// `subject` lies south of `of`; gap = wall thickness between subject.north and of.south.
    SouthOf {
        /// Room being placed.
        subject: RoomName,
        /// Reference room.
        of: RoomName,
        /// Gap between the faces.
        gap: Gap,
    },
    /// `subject` lies north of `of`; gap = wall thickness between subject.south and of.north.
    NorthOf {
        /// Room being placed.
        subject: RoomName,
        /// Reference room.
        of: RoomName,
        /// Gap between the faces.
        gap: Gap,
    },
    /// Faces on the same side are collinear (exact).
    Align {
        /// Side whose faces are aligned.
        side: Side,
        /// Rooms whose faces on `side` are collinear.
        rooms: Vec<RoomName>,
    },
}

/// The gap between two rooms in a placement relation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Gap {
    /// A wall of this thickness. `gap 90` or `gap 121 source drawing`; plain `gap` uses `default_wall`.
    Wall(Quantity),
    /// `open`: no wall, the two rooms form one space.
    Open,
}

/// A direct measurement between two parallel faces, e.g. a laser reading across two rooms.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Measure {
    /// Start face.
    pub from: FaceRef,
    /// End face.
    pub to: FaceRef,
    /// Measured distance in mm.
    pub value: Quantity,
    /// `true` = checked and reported, never drives geometry.
    pub reference: bool,
}

/// A door, window or passage in a room face.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Opening {
    /// Door, window or passage.
    pub kind: OpeningKind,
    /// The room side it sits in.
    pub face: FaceRef,
    /// Offset along the face in mm; origin rule in spec §9.3.
    pub at: Quantity,
    /// Opening width in mm.
    pub width: Quantity,
    /// Opening height in mm, if known.
    pub height: Option<Mm>,
    /// Doors: compass side of the jamb with the hinge.
    pub hinge: Option<Side>,
    /// Doors: the room the leaf swings into.
    pub opens_into: Option<RoomName>,
    /// Existing, to be demolished, or new.
    pub phase: Phase,
}

/// Kind of opening.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpeningKind {
    /// Door.
    Door,
    /// Window.
    Window,
    /// Passage (opening without a door).
    Passage,
}

/// Attributes of the wall on one face, e.g. an outer wall measured 160 mm, or a
/// load-bearing wall (spec §15 D34).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WallOverride {
    /// The face whose wall is overridden.
    pub face: FaceRef,
    /// Measured wall thickness in mm. `None`: keep the default or the gap.
    pub thickness: Option<Quantity>,
    /// Load-bearing wall.
    pub bearing: bool,
    /// Fire rating text, e.g. "EI60".
    pub fire: Option<String>,
    /// Existing, demolished or new.
    pub phase: Phase,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::units::Source;

    fn q(value: Mm, source: Source) -> Quantity {
        Quantity {
            value,
            source,
            tolerance: source.default_tolerance(),
        }
    }

    #[test]
    fn plan_round_trips_through_json() -> Result<(), Box<dyn std::error::Error>> {
        let kitchen = RoomName::new("Kök")?;
        let hall = RoomName::new("Hall_1")?;
        let room = |n: &RoomName, w: Mm| Room {
            name: n.clone(),
            width: Some(q(w, Source::Laser)),
            depth: None,
            apartment: Some("A".to_string()),
            phase: Phase::Existing,
        };
        let face = |r: &RoomName, side| FaceRef {
            room: r.clone(),
            side,
        };
        let plan = Plan {
            name: "Test".to_string(),
            default_wall: q(90, Source::Assumed),
            default_outer_wall: q(300, Source::Assumed),
            rooms: BTreeMap::from([
                (kitchen.clone(), room(&kitchen, 3200)),
                (hall.clone(), room(&hall, 1500)),
            ]),
            order: vec![kitchen.clone(), hall.clone()],
            relations: vec![
                Relation::EastOf {
                    subject: hall.clone(),
                    of: kitchen.clone(),
                    gap: Gap::Wall(q(121, Source::Drawing)),
                },
                Relation::Align {
                    side: Side::North,
                    rooms: vec![kitchen.clone(), hall.clone()],
                },
            ],
            measures: vec![Measure {
                from: face(&kitchen, Side::West),
                to: face(&hall, Side::East),
                value: q(4800, Source::Laser),
                reference: true,
            }],
            openings: vec![Opening {
                kind: OpeningKind::Door,
                face: face(&hall, Side::West),
                at: q(400, Source::Tape),
                width: q(800, Source::Tape),
                height: Some(2100),
                hinge: Some(Side::North),
                opens_into: Some(kitchen.clone()),
                phase: Phase::New,
            }],
            wall_overrides: vec![WallOverride {
                face: face(&kitchen, Side::North),
                thickness: Some(q(160, Source::Tape)),
                bearing: false,
                fire: None,
                phase: Phase::Existing,
            }],
            title: BTreeMap::from([("drawing".to_string(), "A-01".to_string())]),
        };

        let json = serde_json::to_string(&plan)?;
        let back: Plan = serde_json::from_str(&json)?;
        assert_eq!(plan, back);
        Ok(())
    }

    #[test]
    fn room_name_rejects_invalid_input() {
        assert!(RoomName::new("").is_err());
        assert!(RoomName::new("a b").is_err());
        assert!(RoomName::new("a-b").is_err());
        assert!(RoomName::new("Åäö_09").is_ok());
    }
}

#[cfg(test)]
mod type_roundtrip_tests {
    use super::*;
    use crate::units::Source;
    use serde::de::DeserializeOwned;
    use std::fmt::Debug;

    fn round_trip<T>(value: &T) -> Result<(), Box<dyn std::error::Error>>
    where
        T: Serialize + DeserializeOwned + PartialEq + Debug,
    {
        let json = serde_json::to_string(value)?;
        let back: T = serde_json::from_str(&json)?;
        assert_eq!(value, &back, "json was {json}");
        Ok(())
    }

    fn q(value: Mm, source: Source) -> Quantity {
        Quantity {
            value,
            source,
            tolerance: source.default_tolerance(),
        }
    }

    #[test]
    fn phase_round_trips() -> Result<(), Box<dyn std::error::Error>> {
        for p in [Phase::Existing, Phase::Demolish, Phase::New] {
            round_trip(&p)?;
        }
        assert_eq!(serde_json::to_string(&Phase::Demolish)?, "\"demolish\"");
        Ok(())
    }

    #[test]
    fn opening_kind_round_trips() -> Result<(), Box<dyn std::error::Error>> {
        for k in [OpeningKind::Door, OpeningKind::Window, OpeningKind::Passage] {
            round_trip(&k)?;
        }
        Ok(())
    }

    #[test]
    fn side_round_trips() -> Result<(), Box<dyn std::error::Error>> {
        for s in [Side::North, Side::East, Side::South, Side::West] {
            round_trip(&s)?;
        }
        Ok(())
    }

    #[test]
    fn room_name_round_trips_and_rejects_invalid_json() -> Result<(), Box<dyn std::error::Error>> {
        round_trip(&RoomName::new("Hall_1")?)?;
        round_trip(&RoomName::new("Kök")?)?;
        assert!(serde_json::from_str::<RoomName>("\"a b\"").is_err());
        Ok(())
    }

    #[test]
    fn face_ref_round_trips() -> Result<(), Box<dyn std::error::Error>> {
        round_trip(&FaceRef {
            room: RoomName::new("Kök")?,
            side: Side::South,
        })
    }

    #[test]
    fn room_round_trips() -> Result<(), Box<dyn std::error::Error>> {
        round_trip(&Room {
            name: RoomName::new("Hall")?,
            width: None,
            depth: None,
            apartment: None,
            phase: Phase::New,
        })?;
        round_trip(&Room {
            name: RoomName::new("Kök")?,
            width: Some(q(3200, Source::Laser)),
            depth: Some(q(2600, Source::Tape)),
            apartment: Some("B".to_string()),
            phase: Phase::Demolish,
        })
    }

    #[test]
    fn relation_round_trips_all_variants() -> Result<(), Box<dyn std::error::Error>> {
        let a = RoomName::new("A")?;
        let b = RoomName::new("B")?;
        let gap = Gap::Wall(q(90, Source::Assumed));
        let variants = [
            Relation::EastOf {
                subject: a.clone(),
                of: b.clone(),
                gap: gap.clone(),
            },
            Relation::WestOf {
                subject: a.clone(),
                of: b.clone(),
                gap: Gap::Open,
            },
            Relation::SouthOf {
                subject: a.clone(),
                of: b.clone(),
                gap: gap.clone(),
            },
            Relation::NorthOf {
                subject: a.clone(),
                of: b.clone(),
                gap: Gap::Open,
            },
            Relation::Align {
                side: Side::East,
                rooms: vec![a, b],
            },
        ];
        for r in &variants {
            round_trip(r)?;
        }
        Ok(())
    }

    #[test]
    fn gap_round_trips_both_variants() -> Result<(), Box<dyn std::error::Error>> {
        round_trip(&Gap::Wall(q(121, Source::Drawing)))?;
        round_trip(&Gap::Open)
    }

    #[test]
    fn measure_round_trips() -> Result<(), Box<dyn std::error::Error>> {
        round_trip(&Measure {
            from: FaceRef {
                room: RoomName::new("A")?,
                side: Side::West,
            },
            to: FaceRef {
                room: RoomName::new("B")?,
                side: Side::East,
            },
            value: q(4800, Source::Laser),
            reference: false,
        })
    }

    #[test]
    fn opening_round_trips() -> Result<(), Box<dyn std::error::Error>> {
        round_trip(&Opening {
            kind: OpeningKind::Window,
            face: FaceRef {
                room: RoomName::new("A")?,
                side: Side::North,
            },
            at: q(600, Source::Tape),
            width: q(1200, Source::Tape),
            height: None,
            hinge: None,
            opens_into: None,
            phase: Phase::Existing,
        })
    }

    #[test]
    fn wall_override_round_trips() -> Result<(), Box<dyn std::error::Error>> {
        round_trip(&WallOverride {
            face: FaceRef {
                room: RoomName::new("A")?,
                side: Side::North,
            },
            thickness: Some(q(160, Source::Tape)),
            bearing: false,
            fire: None,
            phase: Phase::Existing,
        })
    }

    #[test]
    fn empty_plan_round_trips() -> Result<(), Box<dyn std::error::Error>> {
        round_trip(&Plan {
            name: String::new(),
            default_wall: q(90, Source::Assumed),
            default_outer_wall: q(300, Source::Assumed),
            rooms: BTreeMap::new(),
            order: Vec::new(),
            relations: Vec::new(),
            measures: Vec::new(),
            openings: Vec::new(),
            wall_overrides: Vec::new(),
            title: BTreeMap::new(),
        })
    }
}
