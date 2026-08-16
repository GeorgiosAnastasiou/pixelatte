// smooth.js — spatial filtering on the block grid, before the palette.
//
// The problem this exists for: a clear sky comes out with a handful of stray
// blocks in it — one white block in a field of blue, not a cloud, just a block
// whose average happened to land the other side of a palette boundary. It is
// the pixelated equivalent of salt-and-pepper noise, and it looks like a
// mistake because it is one.
//
// This runs on the block grid rather than the source pixels, and before palette
// matching rather than after, for the same reason the temporal blend does:
// after matching, every value has been snapped to one of a handful of colours,
// and averaging those produces a colour the palette does not contain. Before
// matching, a block that was *almost* blue gets pulled the rest of the way, and
// the matcher then does what it would have done anyway.
//
// Two filters, because they answer different questions.
//
//   despeckle (median)  Replaces a block with the median of its neighbourhood.
//                       An isolated speck is, by definition, a minority in its
//                       own neighbourhood, so it vanishes — while an edge, where
//                       half the neighbours are on each side, does not move.
//                       This is the one for the sky.
//
//   soften (mean)       A distance-weighted average. Reduces detail everywhere,
//                       edges included. Use it when that is the point.
//
// Cost: the mean is separable and computed with a sliding window, so it is
// O(blocks) whatever the radius — radius 20 costs what radius 2 costs. The
// median is not separable and is O(blocks x radius^2), which is why its radius
// is capped rather than merely discouraged.

export const MODES = ['despeckle', 'soften'];

/** Beyond this a median costs more than it is worth at interactive speed. */
export const MAX_MEDIAN_RADIUS = 8;

/**
 * The largest radius worth offering for a grid.
 *
 * A twentieth of the shorter side, which is the shape of the brief: enough to
 * swallow a speck and its immediate surroundings, not enough to turn a frame
 * into a colour field.
 */
export function maxRadius(bw, bh) {
    return Math.max(1, Math.round(Math.min(bw, bh) / 20));
}

const clampIndex = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);

/**
 * One separable box pass, horizontally or vertically, with a sliding window.
 *
 * The window gains one sample and loses one per step rather than being re-summed,
 * which is what removes the radius from the cost. Edges replicate: the
 * alternative is treating outside as black, which darkens every border.
 */
function boxPass(src, dst, w, h, r, vertical) {
    const outer = vertical ? w : h;
    const inner = vertical ? h : w;
    const stride = vertical ? w * 3 : 3;
    const step = vertical ? 3 : w * 3;
    const span = 2 * r + 1;

    for (let o = 0; o < outer; o++) {
        const base = o * step;
        let sr = 0, sg = 0, sb = 0;

        // Prime the window at position 0, with the left edge replicated.
        for (let k = -r; k <= r; k++) {
            const i = base + clampIndex(k, inner - 1) * stride;
            sr += src[i]; sg += src[i + 1]; sb += src[i + 2];
        }

        for (let p = 0; p < inner; p++) {
            const o1 = base + p * stride;
            dst[o1] = sr / span; dst[o1 + 1] = sg / span; dst[o1 + 2] = sb / span;

            const outIdx = base + clampIndex(p - r, inner - 1) * stride;
            const inIdx = base + clampIndex(p + r + 1, inner - 1) * stride;
            sr += src[inIdx] - src[outIdx];
            sg += src[inIdx + 1] - src[outIdx + 1];
            sb += src[inIdx + 2] - src[outIdx + 2];
        }
    }
}

/**
 * Distance-weighted mean.
 *
 * Two box passes per axis rather than one: a single box weights every
 * neighbour equally, which is not what "affected by its neighbours by distance"
 * means and shows as blocky haloes. Two convolved boxes give a triangular
 * falloff — near neighbours count more — and it is still O(blocks).
 */
export function meanFilter(rgb, bw, bh, radius, passes = 2) {
    let src = rgb;
    let a = new Float32Array(rgb.length);
    let b = new Float32Array(rgb.length);
    for (let p = 0; p < passes; p++) {
        boxPass(src, a, bw, bh, radius, false);
        boxPass(a, b, bw, bh, radius, true);
        src = b;
        // Swap so the next pass does not read and write the same buffer.
        const t = a; a = b; b = t;
    }
    return src;
}

/**
 * Per-channel median over a square neighbourhood.
 *
 * Per channel rather than a true vector median: a vector median needs the
 * pairwise distances of every candidate in the window and costs far more, for a
 * difference that does not show once the result is snapped to a palette anyway.
 */
export function medianFilter(rgb, bw, bh, radius) {
    const r = Math.min(radius, MAX_MEDIAN_RADIUS);
    const out = new Float32Array(rgb.length);
    const span = 2 * r + 1;
    const buf = new Float32Array(span * span);

    for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
            const o = (y * bw + x) * 3;
            for (let c = 0; c < 3; c++) {
                let n = 0;
                for (let dy = -r; dy <= r; dy++) {
                    const yy = clampIndex(y + dy, bh - 1);
                    for (let dx = -r; dx <= r; dx++) {
                        const xx = clampIndex(x + dx, bw - 1);
                        buf[n++] = rgb[(yy * bw + xx) * 3 + c];
                    }
                }
                const win = buf.subarray(0, n);
                win.sort();
                out[o + c] = win[n >> 1];
            }
        }
    }
    return out;
}

/**
 * Filter a block grid.
 *
 * @param {Float32Array} rgb block-resolution triplets, not modified
 * @param {number} bw
 * @param {number} bh
 * @param {{radius:number, mode:string, strength?:number}} opts
 *        strength 0-1 blends the result back towards the original, so the
 *        control is a dial rather than a switch.
 * @returns {Float32Array} the original array when there is nothing to do
 */
export function spatialSmooth(rgb, bw, bh, { radius, mode = 'despeckle', strength = 1 } = {}) {
    const r = Math.floor(radius);
    if (!(r >= 1) || strength <= 0 || bw < 1 || bh < 1) return rgb;

    const filtered = mode === 'soften'
        ? meanFilter(rgb, bw, bh, r)
        : medianFilter(rgb, bw, bh, r);

    if (strength >= 1) return filtered;

    const out = new Float32Array(rgb.length);
    const s = strength, is = 1 - strength;
    for (let i = 0; i < rgb.length; i++) out[i] = is * rgb[i] + s * filtered[i];
    return out;
}

/**
 * Blend a filtered grid into an original wherever a mask says so.
 *
 * The mask is what lets the brush smooth one region: 0 leaves a block alone,
 * 100 replaces it outright, and anything between mixes.
 *
 * @param {Float32Array} rgb modified in place
 * @param {Float32Array} filtered same grid, already filtered
 * @param {Int32Array} mask one entry per block, 0-100
 */
export function blendMasked(rgb, filtered, mask) {
    for (let i = 0, o = 0; i < mask.length; i++, o += 3) {
        const m = mask[i];
        if (!m) continue;
        const s = Math.min(100, m) / 100, is = 1 - s;
        rgb[o] = is * rgb[o] + s * filtered[o];
        rgb[o + 1] = is * rgb[o + 1] + s * filtered[o + 1];
        rgb[o + 2] = is * rgb[o + 2] + s * filtered[o + 2];
    }
    return rgb;
}
