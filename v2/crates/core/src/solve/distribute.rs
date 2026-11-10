//! Distribution of within-tolerance cycles over one component (spec §6.2
//! steps 5–6, decision D6 in §15).
//!
//! [`distribute`] takes one component of an axis, the edges of that axis
//! between its faces, and the first-pass coordinates from the spanning tree.
//! It solves weighted least squares with the component's root fixed at its
//! first-pass coordinate (see [`wls`]), then rounds every coordinate half-even
//! once. Each edge reports what it was adjusted to, so the user can see which
//! measurement absorbed the difference.

use std::collections::BTreeMap;

use super::components::Component;
use super::graph::{Axis, Edge, FaceId};
use super::lsq::{Hard, Soft, weight, wls};
use super::tree::FaceKey;
use crate::intent::Side;
use crate::units::{Mm, round_half_even};

/// One edge after distribution. Lengths in mm.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct AdjustedEdge {
    /// Index into the edge slice.
    pub edge: usize,
    /// `edges[edge].origin`.
    pub origin: String,
    /// The stated value.
    pub value: Mm,
    /// `coords[to] − coords[from]` from the rounded coordinates the solver
    /// writes, so it is what is drawn (§15 D23).
    pub adjusted: Mm,
    /// `(x[to] − x[from]) − value`, unrounded.
    pub shift: f64,
}

/// The result of distributing one component on one axis.
#[derive(Clone, Debug, PartialEq)]
pub struct Distribution {
    /// New coordinate of every face of the component, rounded half-even.
    pub coords: BTreeMap<FaceKey, Mm>,
    /// Every edge of the component on this axis, in edge-index order.
    pub edges: Vec<AdjustedEdge>,
}

/// Spread the component's within-tolerance cycles over its edges (§6.2 step 5).
///
/// `coords` holds the first-pass coordinates from the spanning tree; the
/// component's root (its first face) keeps its coordinate. Coordinates are in
/// mm. Returns `None` if `wls` returns `None`, or if the component has no faces.
#[must_use]
pub fn distribute(
    edges: &[Edge],
    component: &Component,
    axis: Axis,
    coords: &BTreeMap<FaceKey, Mm>,
) -> Option<Distribution> {
    let faces = &component.faces;
    let mut index: BTreeMap<FaceKey, usize> = BTreeMap::new();
    for (i, face) in faces.iter().enumerate() {
        index.entry(key(face)).or_insert(i);
    }

    let root = key(faces.first()?);
    let root_coord = *coords.get(&root)?;
    let fixed = [(0, root_coord as f64)];

    let mut soft = Vec::new();
    let mut hard = Vec::new();
    // Member edges as (edge index, start index, end index).
    let mut member = Vec::new();
    for (i, e) in edges.iter().enumerate() {
        if e.axis != axis {
            continue;
        }
        let (Some(&a), Some(&b)) = (index.get(&key(&e.from)), index.get(&key(&e.to))) else {
            continue;
        };
        member.push((i, a, b));
        if e.tolerance == 0 {
            hard.push(Hard {
                a,
                b,
                value: e.value as f64,
            });
        } else {
            soft.push(Soft {
                a,
                b,
                value: e.value as f64,
                weight: weight(e.tolerance),
            });
        }
    }

    let x = wls(faces.len(), &fixed, &soft, &hard)?;

    // The rounded coordinates are the ones the solver writes, so every edge
    // reports the difference of what is actually drawn (§15 D23).
    let rounded: Vec<Mm> = x.iter().map(|&i| round_half_even(i)).collect();
    let mut face_coords = BTreeMap::new();
    for (face, &c) in faces.iter().zip(rounded.iter()) {
        face_coords.insert(key(face), c);
    }

    let adjusted = member
        .into_iter()
        .map(|(i, a, b)| {
            let e = &edges[i];
            let d = x[b] - x[a];
            AdjustedEdge {
                edge: i,
                origin: e.origin.clone(),
                value: e.value,
                adjusted: rounded[b] - rounded[a],
                shift: d - e.value as f64,
            }
        })
        .collect();

    Some(Distribution {
        coords: face_coords,
        edges: adjusted,
    })
}

/// The map key of a face, as in [`tree`](super::tree).
fn key(face: &FaceId) -> FaceKey {
    (face.room.clone(), side_index(face.side))
}

/// North 0, east 1, south 2, west 3.
fn side_index(side: Side) -> u8 {
    match side {
        Side::North => 0,
        Side::East => 1,
        Side::South => 2,
        Side::West => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::intent::RoomName;
    use crate::solve::components::components;
    use crate::solve::graph::edges;
    use crate::solve::tree::assign_coords;

    const PLAN: &str = "plan \"Distribution test\"\nroom A 2000 x 1000 source laser\nroom B 1500 x 1000 source laser\n  south_of A gap\n  align west A\nmeasure B.east to A.east = 520 source estimated\n";

    fn name(text: &str) -> RoomName {
        RoomName::new(text).expect("valid room name")
    }

    #[test]
    fn distributes_the_measure_over_the_room_widths() {
        let plan = parse(PLAN).expect("plan parses");
        let (edge_list, _) = edges(&plan);
        let (comps, _) = components(&edge_list, &plan, Axis::X);
        let anchored = comps
            .iter()
            .find(|c| c.anchored)
            .expect("anchored component");
        let (coords, _) = assign_coords(&edge_list, &comps, Axis::X);

        let dist = distribute(&edge_list, anchored, Axis::X, &coords).expect("solvable");

        let at = |room: &str, side: Side| dist.coords[&(name(room), side_index(side))];
        assert_eq!(at("A", Side::West), 0);
        assert_eq!(at("A", Side::East), 2000);
        assert_eq!(at("B", Side::West), 0);
        assert_eq!(at("B", Side::East), 1500);

        let measure = dist
            .edges
            .iter()
            .find(|a| a.value == 520)
            .expect("measure edge");
        assert_eq!(measure.adjusted, 500);
        assert!(
            (measure.shift + 19.86).abs() <= 0.05,
            "shift = {}",
            measure.shift
        );

        let width = |room: &str| {
            let wanted = name(room);
            dist.edges
                .iter()
                .find(|a| {
                    let e = &edge_list[a.edge];
                    e.axis == Axis::X && e.from.room == wanted && e.to.room == wanted
                })
                .expect("width edge")
        };
        let a_width = width("A");
        assert_eq!(a_width.adjusted, 2000);
        assert!(a_width.shift.abs() < 0.5, "shift = {}", a_width.shift);
        let b_width = width("B");
        assert_eq!(b_width.adjusted, 1500);
        assert!(b_width.shift.abs() < 0.5, "shift = {}", b_width.shift);
    }
}
