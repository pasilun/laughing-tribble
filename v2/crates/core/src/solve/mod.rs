//! Solver (spec §6): turns a plan into constraint edges and solves them axis by axis.
//!
//! So far [`graph`] builds the edges of §6.1. Components, the spanning tree,
//! the cycle check and the least-squares step come in later cards.

pub mod graph;

pub use graph::{Axis, Edge, FaceId, Origin, edges};
