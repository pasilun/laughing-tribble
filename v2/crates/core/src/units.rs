//! Units, measurement sources and tolerances (spec §5.1).

use serde::{Deserialize, Serialize};

/// A length in millimetres (`i64`). Stored data uses this unit everywhere.
pub type Mm = i64;

/// Where a measurement came from. Each source has a default tolerance.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    /// Laser distance meter.
    Laser,
    /// Tape measure.
    Tape,
    /// Dimension printed on the drawing.
    Printed,
    /// Scaled from the drawing (not printed).
    Drawing,
    /// Rough estimate.
    Estimated,
    /// Assumed value (e.g. default wall thickness).
    Assumed,
}

impl Source {
    /// Default tolerance in mm when the statement gives none.
    pub fn default_tolerance(self) -> Mm {
        match self {
            Source::Laser => 3,
            Source::Tape => 5,
            Source::Printed => 20,
            Source::Drawing => 30,
            Source::Estimated => 50,
            Source::Assumed => 10,
        }
    }
}

/// A value in mm with its provenance and tolerance (mm, symmetric).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Quantity {
    /// Value in mm.
    pub value: Mm,
    /// Where the value came from.
    pub source: Source,
    /// Tolerance in mm (plus or minus around `value`).
    pub tolerance: Mm,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_tolerances_match_spec() {
        assert_eq!(Source::Laser.default_tolerance(), 3);
        assert_eq!(Source::Tape.default_tolerance(), 5);
        assert_eq!(Source::Printed.default_tolerance(), 20);
        assert_eq!(Source::Drawing.default_tolerance(), 30);
        assert_eq!(Source::Estimated.default_tolerance(), 50);
        assert_eq!(Source::Assumed.default_tolerance(), 10);
    }
}
