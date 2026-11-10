//! Round-trip property `parse(print(p)) == p` (card W2-08, spec §7.2, §15 D7).

mod common;

use plan_core::dsl::{parse, print};
use proptest::prelude::*;
use proptest::test_runner::TestCaseError;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1000))]
    #[test]
    fn parse_print_round_trips(p in common::arb_plan()) {
        let text = print(&p);
        let back = parse(&text).map_err(|d| TestCaseError::fail(format!("{text}\n{d:?}")))?;
        prop_assert_eq!(back, p, "text was:\n{}", text);
    }
    #[test]
    fn print_is_a_fixed_point(p in common::arb_plan()) {
        let once = print(&p);
        let twice = print(&parse(&once).map_err(|d| TestCaseError::fail(format!("{d:?}")))?);
        prop_assert_eq!(twice, once);
    }
}
