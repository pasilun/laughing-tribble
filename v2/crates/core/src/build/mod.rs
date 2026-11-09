//! Building the resolved model from solved rooms (spec §9).
//!
//! [`faces`] finds the pairs of room faces that face each other (§9.1), and
//! [`walls`] splits and classifies the span of each room face into wall
//! segments (§9.2 steps 1–2).

pub mod faces;
pub mod walls;

pub use faces::{Coords, FacingPair, facing_faces};
pub use walls::{SegmentKind, WallSegment, wall_segments};
