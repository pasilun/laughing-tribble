//! Building the resolved model from solved rooms (spec §9).
//!
//! [`faces`] finds the pairs of room faces that face each other (§9.1), and
//! [`walls`] splits and classifies the span of each room face into wall
//! segments (§9.2 steps 1–2), and [`merge`] runs steps 3–7 and assigns wall ids.
//! [`diagnose`] reports the facade steps (W003) and derived walls (I010).

pub mod diagnose;
pub mod faces;
pub mod merge;
pub mod openings;
pub mod walls;

pub use diagnose::diagnose;
pub use faces::{Coords, FacingPair, facing_faces};
pub use merge::{BuiltWall, built_walls};
pub use openings::{PlacedOpening, place_openings};
pub use walls::{SegmentKind, WallSegment, wall_segments};
