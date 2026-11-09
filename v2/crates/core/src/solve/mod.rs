//! Solver (spec §6): turns a plan into constraint edges and solves them axis by axis.
//!
//! So far [`graph`] builds the edges of §6.1 and [`components`] groups the
//! faces of one axis, anchors one component and reports the loose ones (§6.2
//! steps 1–2) and [`tree`] builds the spanning tree and the coordinates (step
//! 3). The cycle check and the least-squares step come in later cards.

pub mod components;
pub mod conflicts;
pub mod cycles;
pub mod graph;
pub mod tree;

pub use components::{Component, components};
pub use conflicts::conflict_diagnostic;
pub use cycles::{CycleCheck, check_cycles};
pub use graph::{Axis, Edge, FaceId, Origin, edges};
pub use tree::{FaceKey, TreeEdge, assign_coords};
