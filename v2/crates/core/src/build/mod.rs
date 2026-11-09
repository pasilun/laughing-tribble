//! Building the resolved model from solved rooms (spec §9).
//!
//! So far [`faces`] finds the pairs of room faces that face each other (§9.1).

pub mod faces;

pub use faces::{Coords, FacingPair, facing_faces};
