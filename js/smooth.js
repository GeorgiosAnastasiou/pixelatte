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
// Windows are described by their two edge lengths, not by a radius. A radius is
// symmetric by construction, so it can only ever produce odd windows: 1x1, then
// straight to 3x3, with no 2x2 in between — which is why the first notch of the
// old control changed far more than any notch after it. Edge lengths give every
// size, and give non-square windows for free: a 3x1 row smooths along a
// horizontal band without touching anything vertically.
//
// Cost: the mean is separable and computed with a sliding window, so it is
// O(blocks) whatever the size. The median is not separable and grows with the
// window's area, which is why its size is capped rather than merely discouraged.

export const MODES = ['despeckle', 'soften'];
export const SHAPES = ['square', 'row', 'column'];

/** Beyond this a median costs more than it is worth at interactive speed. */
export const MAX_MEDIAN_SIZE = 17;

/**
 * The largest window worth offering for a grid.
 *
 * A tenth of the shorter side: enough to swallow a speck and its surroundings,
 * not enough to turn a frame into a colour field.
 */
export function maxSize(bw, bh) {
    return Math.max(2, Math.round(Math.min(bw, bh) / 10));
}

/**
 * A shape and a length become two edge lengths.
 *
 * A row is n wide and one tall, a column the other way about. The 2x1 and 1x2
 * windows are simply the shortest of each, and there is no reason to special
 * case them when the general form costs nothing.
 */
export function windowFor(size, shape = 'square') {
    const n = Math.max(1, size);
    if (shape === 'row') return [n, 1];
    if (shape === 'column') return [1, n];
    return [n, n];
}

const clampIndex = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);

/**
 * The offset ranges that make an edge of `size`, as [lo, hi] pairs.
 *
 * An odd edge has a centre block and one symmetric range. An even edge has no
 * centre — 2 blocks cannot be placed evenly around one — so it is built from
 * the two placements either side and averaged. Taking just one would shift the
 * picture half a block in that direction, which on a block grid shows.
 */
function placements(size) {
    if (size <= 1) return [[0, 0]];
    if (size % 2 === 1) {
        const r = (size - 1) / 2;
        return [[-r, r]];
    }
    const h = size / 2;
    return [[-h, h - 1], [-(h - 1), h]];
}

/** Mean of one or more grids of the same shape. */
function average(grids) {
    if (grids.length === 1) return grids[0];
    const out = new Float32Array(grids[0].length);
    for (let i = 0; i < out.length; i++) {
        let sum = 0;
        for (const g of grids) sum += g[i];
        out[i] = sum / grids.length;
    }
    return out;
}

/**
 * One separable box pass over an explicit offset range, with a sliding window.
 *
 * The window gains one sample and loses one per step rather than being
 * re-summed, which is what keeps the cost independent of the window size. Edges
 * replicate: treating outside as black darkens every border.
 */
function boxPass(src, dst, w, h, lo, hi, vertical) {
    const outer = vertical ? w : h;
    const inner = vertical ? h : w;
    const stride = vertical ? w * 3 : 3;
    const step = vertical ? 3 : w * 3;
    const span = hi - lo + 1;

    for (let o = 0; o < outer; o++) {
        const base = o * step;
        let sr = 0, sg = 0, sb = 0;

        for (let k = lo; k <= hi; k++) {
            const i = base + clampIndex(k, inner - 1) * stride;
            sr += src[i]; sg += src[i + 1]; sb += src[i + 2];
        }

        for (let p = 0; p < inner; p++) {
            const o1 = base + p * stride;
            dst[o1] = sr / span; dst[o1 + 1] = sg / span; dst[o1 + 2] = sb / span;

            const outIdx = base + clampIndex(p + lo, inner - 1) * stride;
            const inIdx = base + clampIndex(p + hi + 1, inner - 1) * stride;
            sr += src[inIdx] - src[outIdx];
            sg += src[inIdx + 1] - src[outIdx + 1];
            sb += src[inIdx + 2] - src[outIdx + 2];
        }
    }
}

/** Average of a box pass over every placement of one edge. */
function passAxis(src, w, h, size, vertical) {
    if (size <= 1) return src;
    return average(placements(size).map(([lo, hi]) => {
        const dst = new Float32Array(src.length);
        boxPass(src, dst, w, h, lo, hi, vertical);
        return dst;
    }));
}

/**
 * Distance-weighted mean over a `sx` by `sy` window.
 *
 * Two passes per axis rather than one: a single box weights every neighbour
 * equally, which is not what "affected by its neighbours by distance" means and
 * shows as blocky haloes. Two convolved boxes give a triangular falloff, and it
 * is still O(blocks).
 *
 * The two placements of an even edge are averaged per axis rather than across
 * the whole 2D window. A box pass is linear, so the two are identical, and
 * doing it per axis is two extra passes rather than four.
 */
export function meanFilter(rgb, bw, bh, sx, sy = sx, passes = 2) {
    if (sx <= 1 && sy <= 1) return rgb;
    let cur = rgb;
    for (let p = 0; p < passes; p++) {
        cur = passAxis(cur, bw, bh, sx, false);
        cur = passAxis(cur, bw, bh, sy, true);
    }
    return cur;
}

/**
 * Per-channel median over a `sx` by `sy` window.
 *
 * Per channel rather than a true vector median: a vector median needs the
 * pairwise distances of every candidate and costs far more, for a difference
 * that does not survive being snapped to a palette anyway.
 *
 * A median is not linear, so unlike the mean the placements of an even edge
 * have to be combined across the whole window — every pairing of an x placement
 * with a y placement — rather than one axis at a time.
 */
export function medianFilter(rgb, bw, bh, sx, sy = sx) {
    const w = Math.min(sx, MAX_MEDIAN_SIZE);
    const h = Math.min(sy, MAX_MEDIAN_SIZE);
    if (w <= 1 && h <= 1) return rgb;

    const grids = [];
    for (const [ylo, yhi] of placements(h)) {
        for (const [xlo, xhi] of placements(w)) {
            const out = new Float32Array(rgb.length);
            const buf = new Float32Array((yhi - ylo + 1) * (xhi - xlo + 1));
            for (let y = 0; y < bh; y++) {
                for (let x = 0; x < bw; x++) {
                    const o = (y * bw + x) * 3;
                    for (let c = 0; c < 3; c++) {
                        let n = 0;
                        for (let dy = ylo; dy <= yhi; dy++) {
                            const yy = clampIndex(y + dy, bh - 1);
                            for (let dx = xlo; dx <= xhi; dx++) {
                                buf[n++] = rgb[(yy * bw + clampIndex(x + dx, bw - 1)) * 3 + c];
                            }
                        }
                        const win = buf.subarray(0, n);
                        win.sort();
                        // An even count has no single middle sample; the two
                        // either side of the middle are averaged.
                        out[o + c] = n % 2 ? win[n >> 1] : (win[n / 2 - 1] + win[n / 2]) / 2;
                    }
                }
            }
            grids.push(out);
        }
    }
    return average(grids);
}

/**
 * Filter a block grid.
 *
 * @param {Float32Array} rgb block-resolution triplets, not modified
 * @param {number} bw
 * @param {number} bh
 * @param {{size:number, shape?:string, mode?:string, strength?:number}} opts
 *        `size` is the long edge of the neighbourhood in blocks: 1 does
 *        nothing, 2 is a pair, 3 is a triple. `shape` makes that a square, a
 *        row or a column. `size` may be fractional, in which case the two whole
 *        sizes either side are blended. `strength` 0-1 blends the result back
 *        towards the original.
 * @returns {Float32Array} the original array when there is nothing to do
 */
export function spatialSmooth(rgb, bw, bh, { size, shape = 'square', mode = 'despeckle', strength = 1 } = {}) {
    const n = Number(size);
    if (!(n > 1) || strength <= 0 || bw < 1 || bh < 1) return rgb;

    const filtered = filterAtSize(rgb, bw, bh, n, shape, mode);
    if (strength >= 1) return filtered;

    const out = new Float32Array(rgb.length);
    const a = strength, ia = 1 - strength;
    for (let i = 0; i < rgb.length; i++) out[i] = ia * rgb[i] + a * filtered[i];
    return out;
}

/**
 * Whole-size results, remembered per source grid.
 *
 * A fractional size needs the two whole sizes either side of it, and dragging
 * the slider walks through many fractions of the same pair. Without this, every
 * step of the drag recomputes two medians over the whole grid. Keyed weakly on
 * the source array, so the moment the picture changes the cache goes with it.
 */
const filterMemo = new WeakMap();

/**
 * The filter at a possibly fractional size.
 *
 * A window is a whole number of blocks, so anything between two sizes is a
 * blend of the two either side. Kept because the palette match downstream is
 * itself a step function, and a half step is sometimes what lands a block on
 * the right side of it.
 */
function filterAtSize(rgb, bw, bh, size, shape, mode) {
    const run = (n) => {
        if (n <= 1) return rgb;
        let byKey = filterMemo.get(rgb);
        if (!byKey) { byKey = new Map(); filterMemo.set(rgb, byKey); }
        const key = `${mode}|${shape}|${n}|${bw}x${bh}`;
        const hit = byKey.get(key);
        if (hit) return hit;

        const [sx, sy] = windowFor(n, shape);
        const made = mode === 'soften'
            ? meanFilter(rgb, bw, bh, sx, sy)
            : medianFilter(rgb, bw, bh, sx, sy);
        byKey.set(key, made);
        return made;
    };

    const lo = Math.floor(size);
    const t = size - lo;
    if (t < 1e-6) return run(lo);

    const a = run(lo);
    const b = run(lo + 1);
    const out = new Float32Array(rgb.length);
    const it = 1 - t;
    for (let i = 0; i < rgb.length; i++) out[i] = it * a[i] + t * b[i];
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
