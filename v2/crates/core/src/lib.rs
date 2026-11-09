//! Planstudio core: units, intent documents, solver, builder and DSL.
//!
//! Units are `i64` millimetres in stored data. Coordinates: x grows east,
//! y grows south.

#![forbid(unsafe_code)]

pub mod build;
pub mod commands;
pub mod diagnostics;
pub mod dsl;
pub mod intent;
pub mod report;
pub mod resolved;
pub mod solve;
pub mod units;

pub use commands::{ApplyResult, Change, apply};
pub use diagnostics::{Code, Diagnostic, Severity, Span, message};
pub use intent::{
    FaceRef, Gap, Measure, Opening, OpeningKind, Phase, Plan, Relation, Room, RoomName,
    RoomNameError, Side, WallOverride,
};
pub use report::solve_json;
pub use resolved::{Resolved, resolve};
pub use units::{Mm, Quantity, Source};
