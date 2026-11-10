//! `labels::place`: set-of-marks label placement in pixels (W2-14).
//!
//! Pure geometry: no SVG here. Labels are placed greedily, in order of
//! `(priority, id)`, at the first free candidate offset from their anchor.
//! A label that fits nowhere is put at its clamped anchor and marked as
//! overlapping.

/// Average advance of a character of DejaVu Sans at 12 px, rounded up.
pub const CHAR_W_PX: f64 = 7.5;
/// Height of a label box in pixels.
pub const LABEL_H_PX: f64 = 16.0;

/// A label to place. Pixel coordinates, x right, y down (same as the image).
#[derive(Clone, Debug, PartialEq)]
pub struct LabelReq {
    pub id: String,
    pub text: String,
    pub anchor_px: [f64; 2],
    pub priority: u8,
}

/// A placed label.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct PlacedLabel {
    pub id: String,
    pub text: String,
    pub anchor_px: [f64; 2],
    /// Centre of the text box.
    pub center_px: [f64; 2],
    /// `[w, h]` of the text box.
    pub size_px: [f64; 2],
    /// True when the box is not on the anchor: draw a line anchor → box.
    pub leader: bool,
    /// True when no free spot was found.
    pub overlaps: bool,
}

/// A text box in pixels: `[x0, y0, x1, y1]`.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
}

impl Rect {
    fn centred(c: [f64; 2], w: f64, h: f64) -> Self {
        Self {
            x0: c[0] - w / 2.0,
            y0: c[1] - h / 2.0,
            x1: c[0] + w / 2.0,
            y1: c[1] + h / 2.0,
        }
    }

    /// True when the rectangles share interior area. Touching is not overlapping.
    fn intersects(&self, o: &Rect) -> bool {
        self.x0 < o.x1 && o.x0 < self.x1 && self.y0 < o.y1 && o.y0 < self.y1
    }

    fn inside(&self, w: f64, h: f64) -> bool {
        self.x0 >= 0.0 && self.y0 >= 0.0 && self.x1 <= w && self.y1 <= h
    }
}

/// Place labels inside a `size_px` image without overlaps where possible.
///
/// The output is in the order of `(priority, id)`.
pub fn place(reqs: &[LabelReq], size_px: [u32; 2]) -> Vec<PlacedLabel> {
    let img_w = f64::from(size_px[0]);
    let img_h = f64::from(size_px[1]);

    let mut order: Vec<&LabelReq> = reqs.iter().collect();
    order.sort_by(|a, b| (a.priority, a.id.as_str()).cmp(&(b.priority, b.id.as_str())));

    let mut placed_boxes: Vec<Rect> = Vec::new();
    let mut out = Vec::with_capacity(order.len());

    for r in order {
        let w =
            CHAR_W_PX * f64::from(u32::try_from(r.text.chars().count()).unwrap_or(u32::MAX)) + 6.0;
        let h = LABEL_H_PX;
        let big_w = w / 2.0 + 10.0;
        let anchor = r.anchor_px;

        let mut offsets: Vec<(f64, f64)> = vec![
            (0.0, 0.0),
            (0.0, -20.0),
            (0.0, 20.0),
            (-big_w, 0.0),
            (big_w, 0.0),
            (0.0, -40.0),
            (0.0, 40.0),
            (-big_w, -20.0),
            (big_w, -20.0),
            (-big_w, 20.0),
            (big_w, 20.0),
        ];
        for j in 1..=6 {
            let d = 40.0 + 20.0 * f64::from(j);
            offsets.push((0.0, -d));
            offsets.push((0.0, d));
        }

        let free = offsets.iter().find_map(|&(dx, dy)| {
            let c = [anchor[0] + dx, anchor[1] + dy];
            let bx = Rect::centred(c, w, h);
            let ok = bx.inside(img_w, img_h) && placed_boxes.iter().all(|p| !p.intersects(&bx));
            ok.then_some((c, dx != 0.0 || dy != 0.0))
        });

        let (center, leader, overlaps) = match free {
            Some((c, leader)) => (c, leader, false),
            None => {
                let cx = if w <= img_w {
                    anchor[0].clamp(w / 2.0, img_w - w / 2.0)
                } else {
                    img_w / 2.0
                };
                let cy = if h <= img_h {
                    anchor[1].clamp(h / 2.0, img_h - h / 2.0)
                } else {
                    img_h / 2.0
                };
                ([cx, cy], false, true)
            }
        };

        placed_boxes.push(Rect::centred(center, w, h));
        out.push(PlacedLabel {
            id: r.id.clone(),
            text: r.text.clone(),
            anchor_px: anchor,
            center_px: center,
            size_px: [w, h],
            leader,
            overlaps,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(id: &str, text: &str, anchor: [f64; 2], priority: u8) -> LabelReq {
        LabelReq {
            id: id.to_string(),
            text: text.to_string(),
            anchor_px: anchor,
            priority,
        }
    }

    /// A small deterministic generator (LCG), so no dependency is needed.
    struct Lcg(u64);

    impl Lcg {
        fn next_unit(&mut self) -> f64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (self.0 >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    #[test]
    fn second_label_moves_up_when_first_is_on_anchor() {
        let reqs = [
            req("R", "Hall", [100.0, 100.0], 0),
            req("W", "W:x", [100.0, 100.0], 1),
        ];
        let out = place(&reqs, [400, 200]);
        assert_eq!(out.len(), 2);

        assert_eq!(out[0].id, "R");
        assert_eq!(out[0].center_px, [100.0, 100.0]);
        assert_eq!(out[0].size_px, [36.0, 16.0]);
        assert!(!out[0].leader);
        assert!(!out[0].overlaps);

        assert_eq!(out[1].id, "W");
        assert_eq!(out[1].center_px, [100.0, 80.0]);
        assert_eq!(out[1].size_px, [28.5, 16.0]);
        assert!(out[1].leader);
        assert!(!out[1].overlaps);
    }

    #[test]
    fn label_in_corner_goes_to_side_offset() {
        let out = place(&[req("G", "Garderob", [5.0, 5.0], 0)], [400, 200]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].center_px, [48.0, 25.0]);
        assert!(out[0].leader);
        assert!(!out[0].overlaps);
    }

    #[test]
    fn output_does_not_depend_on_input_order() {
        let a = [
            req("R", "Hall", [100.0, 100.0], 0),
            req("W", "W:x", [100.0, 100.0], 1),
        ];
        let b = [a[1].clone(), a[0].clone()];
        assert_eq!(place(&a, [400, 200]), place(&b, [400, 200]));
    }

    #[test]
    fn label_that_fits_nowhere_is_marked_overlapping() {
        let out = place(&[req("H", "Hall", [3.0, 3.0], 0)], [10, 10]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].center_px, [5.0, 5.0]);
        assert!(out[0].overlaps);
        assert!(!out[0].leader);
    }

    #[test]
    fn free_labels_never_overlap_each_other() {
        let seeds = [1_u64, 42, 2026];
        let size = [800_u32, 600];
        for seed in seeds {
            let mut rng = Lcg(seed);
            let reqs: Vec<LabelReq> = (0..30)
                .map(|i| {
                    let x = rng.next_unit() * 800.0;
                    let y = rng.next_unit() * 600.0;
                    let len = 1 + (rng.next_unit() * 12.0) as usize;
                    let text: String = "abcdefghijkl".chars().take(len).collect();
                    let priority = (rng.next_unit() * 3.0) as u8;
                    req(&format!("L{i:02}"), &text, [x, y], priority)
                })
                .collect();
            let out = place(&reqs, size);
            assert_eq!(out.len(), reqs.len());

            let boxes: Vec<(bool, Rect)> = out
                .iter()
                .map(|p| {
                    (
                        p.overlaps,
                        Rect::centred(p.center_px, p.size_px[0], p.size_px[1]),
                    )
                })
                .collect();
            for (i, (oi, bi)) in boxes.iter().enumerate() {
                if *oi {
                    continue;
                }
                for (j, (oj, bj)) in boxes.iter().enumerate() {
                    if i != j && !oj {
                        assert!(!bi.intersects(bj), "seed {seed}: {i} and {j} overlap");
                    }
                }
            }
        }
    }
}
