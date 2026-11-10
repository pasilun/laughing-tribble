//! Weighted least squares with hard constraints (spec §6.2 step 5, §15 D6).
//!
//! Within-tolerance cycles are spread over the edges by minimising the
//! weighted squared residuals of the soft edges. Exact edges and the fixed
//! unknowns are hard constraints, solved through the KKT system with nalgebra.
//! This module works on plain indices; mapping faces to indices is W2-04.

use nalgebra::{DMatrix, DVector};

use crate::units::Mm;

/// A soft equation `x[b] − x[a] ≈ value` with weight `1 / tol²`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Soft {
    /// Index of the unknown at the start of the edge.
    pub a: usize,
    /// Index of the unknown at the end of the edge.
    pub b: usize,
    /// The measured or estimated difference `x[b] − x[a]` in mm.
    pub value: f64,
    /// The weight of the equation, see [`weight`].
    pub weight: f64,
}

/// A hard equation `x[b] − x[a] = value`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hard {
    /// Index of the unknown at the start of the edge.
    pub a: usize,
    /// Index of the unknown at the end of the edge.
    pub b: usize,
    /// The exact difference `x[b] − x[a]` in mm.
    pub value: f64,
}

/// Weight for an edge tolerance in mm: `1 / max(tol, 1)²`.
///
/// Tolerances below 1 mm are raised to 1 mm, so a zero tolerance does not
/// give an infinite weight.
#[must_use]
pub fn weight(tol: Mm) -> f64 {
    let t = tol.max(1) as f64;
    1.0 / (t * t)
}

/// Minimises `Σ w (x[b] − x[a] − v)²` over `soft`, subject to `hard` and to
/// `x[i] = v` for each `(i, v)` in `fixed`. `n` is the number of unknowns.
///
/// Returns `None` when the system is singular (some unknown is not reached by
/// any equation), or when an index in `fixed`, `soft` or `hard` is `>= n`.
#[must_use]
pub fn wls(n: usize, fixed: &[(usize, f64)], soft: &[Soft], hard: &[Hard]) -> Option<Vec<f64>> {
    let in_range = fixed.iter().all(|&(i, _)| i < n)
        && soft.iter().all(|e| e.a < n && e.b < n)
        && hard.iter().all(|e| e.a < n && e.b < n);
    if !in_range {
        return None;
    }
    let m = fixed.len() + hard.len();
    let mut k = DMatrix::<f64>::zeros(n + m, n + m);
    let mut rhs = DVector::<f64>::zeros(n + m);
    for e in soft {
        let w2 = 2.0 * e.weight;
        k[(e.a, e.a)] += w2;
        k[(e.b, e.b)] += w2;
        k[(e.a, e.b)] -= w2;
        k[(e.b, e.a)] -= w2;
        rhs[e.a] -= w2 * e.value;
        rhs[e.b] += w2 * e.value;
    }
    let mut row = n;
    for &(i, v) in fixed {
        k[(row, i)] = 1.0;
        k[(i, row)] = 1.0;
        rhs[row] = v;
        row += 1;
    }
    for e in hard {
        k[(row, e.b)] = 1.0;
        k[(row, e.a)] = -1.0;
        k[(e.b, row)] = 1.0;
        k[(e.a, row)] = -1.0;
        rhs[row] = e.value;
        row += 1;
    }
    let sol = k.lu().solve(&rhs)?;
    Some((0..n).map(|i| sol[i]).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distribution_example() {
        // §7.6: unknowns 0 = A.west, 1 = A.east, 2 = B.west, 3 = B.east.
        let fixed = [(0, 0.0)];
        let soft = [
            Soft {
                a: 0,
                b: 1,
                value: 2000.0,
                weight: weight(3),
            },
            Soft {
                a: 2,
                b: 3,
                value: 1500.0,
                weight: weight(3),
            },
            Soft {
                a: 3,
                b: 1,
                value: 520.0,
                weight: weight(50),
            },
        ];
        let hard = [Hard {
            a: 0,
            b: 2,
            value: 0.0,
        }];
        let x = wls(4, &fixed, &soft, &hard).expect("system is solvable");
        assert!((x[1] - 2000.071).abs() < 0.01, "A.east = {}", x[1]);
        assert!((x[3] - 1499.929).abs() < 0.01, "B.east = {}", x[3]);
        assert!(x[2].abs() < 1e-9, "B.west = {}", x[2]);
    }

    #[test]
    fn no_cycle_is_exact() {
        let fixed = [(0, 0.0)];
        let soft = [Soft {
            a: 0,
            b: 1,
            value: 1234.0,
            weight: weight(3),
        }];
        let x = wls(2, &fixed, &soft, &[]).expect("system is solvable");
        assert!((x[1] - 1234.0).abs() < 1e-9, "x[1] = {}", x[1]);
    }

    #[test]
    fn unreached_unknown_is_none() {
        let fixed = [(0, 0.0)];
        let soft = [Soft {
            a: 0,
            b: 1,
            value: 10.0,
            weight: weight(3),
        }];
        assert_eq!(wls(3, &fixed, &soft, &[]), None);
    }

    #[test]
    fn bad_index_is_none() {
        let soft = [Soft {
            a: 0,
            b: 5,
            value: 10.0,
            weight: weight(3),
        }];
        assert_eq!(wls(2, &[(0, 0.0)], &soft, &[]), None);
    }

    #[test]
    fn weight_values() {
        assert!((weight(3) - 1.0 / 9.0).abs() < 1e-12);
        assert!((weight(0) - 1.0).abs() < 1e-12);
        assert!((weight(50) - 1.0 / 2500.0).abs() < 1e-12);
    }
}
