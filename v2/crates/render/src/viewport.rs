//! Render viewport: fit a mm rectangle into Claude's image limits (W2-12).
//!
//! An image costs ⌈w/28⌉ × ⌈h/28⌉ tokens. The scale chosen here is the
//! smallest round value (1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8 times 10^k mm
//! per pixel) at which the image fits both the long-edge limit and the token
//! budget, so the API never resizes a render and the grid reads cleanly.

/// Longest edge of an image the API takes without resizing, in px.
pub const MAX_LONG_EDGE_PX: u32 = 2576;
/// Most tokens one image may cost.
pub const MAX_IMAGE_TOKENS: u32 = 4784;
/// Token budget when the caller does not give one.
pub const DEFAULT_TOKENS: u32 = 1600;

/// Mapping from plan mm to image pixels: px = (mm − origin_mm) / mm_per_px. x east, y south.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
pub struct Viewport {
    pub origin_mm: [i64; 2],
    pub mm_per_px: f64,
    pub size_px: [u32; 2],
    pub tokens: u32,
}

/// Image tokens for a w × h px image: ceil(w/28) * ceil(h/28).
///
/// The product is saturated at `u32::MAX`, so huge sizes cannot overflow.
pub fn image_tokens(w: u32, h: u32) -> u32 {
    let tokens = u64::from(w.div_ceil(28)) * u64::from(h.div_ceil(28));
    u32::try_from(tokens).unwrap_or(u32::MAX)
}

/// Candidate multipliers within one decade, in increasing order.
const MULTIPLIERS: [f64; 10] = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0];

/// Viewport of `rect` (`[x, y, w, h]` in mm) at scale `s` (mm per px).
fn at_scale(rect_mm: [i64; 4], s: f64) -> Viewport {
    let w_mm = rect_mm[2].max(1) as f64;
    let h_mm = rect_mm[3].max(1) as f64;
    let wpx = ((w_mm / s).ceil() as u32).max(1);
    let hpx = ((h_mm / s).ceil() as u32).max(1);
    Viewport {
        origin_mm: [rect_mm[0], rect_mm[1]],
        mm_per_px: s,
        size_px: [wpx, hpx],
        tokens: image_tokens(wpx, hpx),
    }
}

/// Smallest round scale that fits `[x, y, w, h]` (mm) into `max_tokens`.
pub fn fit(rect_mm: [i64; 4], max_tokens: u32) -> Viewport {
    let budget = max_tokens.clamp(1, MAX_IMAGE_TOKENS);
    for k in 0..=4i32 {
        for m in MULTIPLIERS {
            let s = m * 10f64.powi(k);
            let v = at_scale(rect_mm, s);
            if v.size_px[0].max(v.size_px[1]) <= MAX_LONG_EDGE_PX && v.tokens <= budget {
                return v;
            }
        }
    }
    at_scale(rect_mm, 8.0 * 10f64.powi(4))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_tokens_examples() {
        assert_eq!(image_tokens(28, 28), 1);
        assert_eq!(image_tokens(29, 28), 2);
        assert_eq!(image_tokens(1, 1), 1);
    }

    #[test]
    fn fit_table() {
        let rows: [([i64; 4], u32, f64, [u32; 2], u32); 6] = [
            ([-800, -800, 7141, 6193], 1600, 6.0, [1191, 1033], 1591),
            ([-800, -800, 7141, 6193], 4784, 4.0, [1786, 1549], 3584),
            ([0, 0, 1000, 500], 1600, 1.0, [1000, 500], 648),
            ([0, 0, 2576, 2576], 10000, 1.5, [1718, 1718], 3844),
            ([0, 0, 30000, 1000], 1600, 12.5, [2400, 80], 258),
            ([5, 7, 1, 1], 0, 1.0, [1, 1], 1),
        ];
        for (rect, budget, mm_per_px, size_px, tokens) in rows {
            let v = fit(rect, budget);
            assert_eq!(v.origin_mm, [rect[0], rect[1]]);
            assert_eq!(v.mm_per_px, mm_per_px, "rect {rect:?} budget {budget}");
            assert_eq!(v.size_px, size_px, "rect {rect:?} budget {budget}");
            assert_eq!(v.tokens, tokens, "rect {rect:?} budget {budget}");
        }
    }

    #[test]
    fn fit_respects_limits() {
        let v = fit([0, 0, 10_000_000, 10_000_000], DEFAULT_TOKENS);
        assert!(v.size_px[0].max(v.size_px[1]) <= MAX_LONG_EDGE_PX);
        assert!(v.tokens <= DEFAULT_TOKENS);
        let v = fit([0, 0, 2000, 2000], u32::MAX);
        assert!(v.tokens <= MAX_IMAGE_TOKENS);
        assert!(v.size_px[0].max(v.size_px[1]) <= MAX_LONG_EDGE_PX);
    }
}
