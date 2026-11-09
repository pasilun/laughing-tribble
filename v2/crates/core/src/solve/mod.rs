//! Solver (spec §6): turns a plan into constraint edges and solves them axis by axis.
//!
//! So far [`graph`] builds the edges of §6.1 and [`components`] groups the
//! faces of one axis, anchors one component and reports the loose ones (§6.2
//! steps 1–2). The spanning tree, the cycle check and the least-squares step
//! come in later cards.

pub mod components;
pub mod graph;

pub use components::{Component, components};
pub use graph::{Axis, Edge, FaceId, Origin, edges};
