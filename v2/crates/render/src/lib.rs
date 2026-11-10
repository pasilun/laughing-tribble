//! Drawings of a resolved plan (spec §15 D4).
//!
//! [`plan_svg`] is the SVG of a [`plan_core::Resolved`] model. The CLI's
//! `plan svg` only calls it.

#![forbid(unsafe_code)]

pub mod svg;
pub mod viewport;

pub use svg::plan_svg;
