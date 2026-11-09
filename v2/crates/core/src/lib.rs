//! Planstudio core: units, intent documents, solver, builder and DSL.
//!
//! Units are `i64` millimetres in stored data. Coordinates: x grows east,
//! y grows south.

#![forbid(unsafe_code)]

pub mod diagnostics;
pub mod dsl;
pub mod intent;
pub mod solve;
pub mod units;

pub use diagnostics::{Code, Diagnostic, Severity, Span, message};
pub use intent::{
    FaceRef, Gap, Measure, Opening, OpeningKind, Phase, Plan, Relation, Room, RoomName,
    RoomNameError, Side, WallOverride,
};
pub use units::{Mm, Quantity, Source};
