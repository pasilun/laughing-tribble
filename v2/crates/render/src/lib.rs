//! Drawings of a resolved plan (spec §15 D4).
//!
//! [`plan_svg`] is the SVG of a [`plan_core::Resolved`] model. The CLI's
//! `plan svg` only calls it.

#![forbid(unsafe_code)]

mod corners;
pub mod labels;
pub mod marks;
pub mod pdf;
pub mod png;
pub mod render;
pub mod sheet;
pub mod svg;
pub mod viewport;

pub use labels::{LabelReq, PlacedLabel, place};
pub use marks::{Mark, MarkKind};
pub use pdf::pdf;
pub use png::png;
pub use render::{Region, RenderOptions, Rendered, View, render, render_marked};
pub use sheet::{Paper, Sheet, SheetOptions, sheet};
pub use svg::plan_svg;
