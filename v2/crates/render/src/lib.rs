//! Drawings of a resolved plan (spec §15 D4).
//!
//! [`plan_svg`] is the SVG of a [`plan_core::Resolved`] model. The CLI's
//! `plan svg` only calls it.

#![forbid(unsafe_code)]

pub mod labels;
pub mod png;
pub mod render;
pub mod svg;
pub mod viewport;

pub use labels::{LabelReq, PlacedLabel, place};
pub use png::png;
pub use render::{Region, RenderOptions, Rendered, View, render};
pub use svg::plan_svg;
