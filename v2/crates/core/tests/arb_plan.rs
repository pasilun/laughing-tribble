//! Sanity check for the `arb_plan` strategy (card W2-07, spec §15 D7): every
//! generated plan prints to text that the parser accepts. Full equality after
//! the round trip is checked in W2-08.

mod common;

use plan_core::dsl::{parse, print};
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn printed_plan_parses(plan in common::arb_plan()) {
        let text = print(&plan);
        let result = parse(&text);
        prop_assert!(result.is_ok(), "parse failed: {:?}\n{}", result.err(), text);
    }
}
