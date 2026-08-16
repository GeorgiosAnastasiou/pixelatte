// extract.js — palette extraction by frequency peaks in the RGB colour cube.
//
// The idea: every colour in the image gets a score equal to the number of pixels
// lying within `radius` of it in the cube. The palette is the top N scores.
// Radius 0 is the strictest case — exact colour counting, no neighbourhood.
//
// Done literally this is distinct_colours x pixels, which for a 13 MP photo with
// ~1M distinct colours is ~10^13 operations. Three things make it tractable:
//
//   1. It is a convolution of the 3D histogram with a ball kernel, so the image
//      is touched exactly once; afterwards cost is independent of pixel count.
//   2. For each (dg, db) offset the valid dr values form a contiguous interval,
//      so a prefix sum along R reduces the kernel from ~(4/3)pi r^3 lookups per
//      voxel to ~pi r^2 pairs of lookups.
//   3. Only occupied voxels are scored. Most of the cube is empty.
//
// And the part that decides whether the output is usable at all: peaks are
// picked with non-maximum suppression, because the highest-scoring voxels are
// all neighbours of the same peak. Without it every palette is N shades of one
// colour.

/** Bits per channel for the working grid: 128^3 bins of 2 units each. */
export const GRID_BITS = 7;
const GRID_N = 1 << GRID_BITS;              // 128
const BIN = 256 / GRID_N;                   // 2 units per bin
const GRID_SIZE = GRID_N * GRID_N * GRID_N; // 2,097,152

const idx = (r, g, b) => (r * GRID_N + g) * GRID_N + b;

/** Extra bytes the sums-carrying histogram costs over the counts-only one. */
export const SUMS_EXTRA_BYTES = GRID_SIZE * 8 * 3;   // three Float64Array = ~48 MB

/**
 * Decide whether to spend memory or time.
 *
 * Two ways to get each chosen bin's mean colour:
 *   'sums' — accumulate per-bin channel sums during the histogram pass. Costs
 *            ~48 MB more, saves a second pass over every pixel (~400 ms on 13 MP).
 *   'pass' — count only (8 MB), then re-read the image for the few winning bins.
 *
 * Machines with memory to spare should take the fast one; a 2 GB phone should
 * not allocate 56 MB for a palette.
 *
 * @param {{deviceMemoryGB?: number, mobileHint?: boolean, thresholdGB?: number}} env
 */
export function pickHistogramMode({ deviceMemoryGB, mobileHint = false, thresholdGB = 4 } = {}) {
    if (typeof deviceMemoryGB === 'number' && !Number.isNaN(deviceMemoryGB)) {
        return deviceMemoryGB >= thresholdGB ? 'sums' : 'pass';
    }
    // navigator.deviceMemory is Chromium-only. Absent it, assume a desktop
    // browser (Firefox/Safari on a laptop) unless something says mobile.
    return mobileHint ? 'pass' : 'sums';
}

/** Read the environment for pickHistogramMode. Safe outside a browser. */
export function detectEnv() {
    if (typeof navigator === 'undefined') return {};
    return {
        deviceMemoryGB: navigator.deviceMemory,
        mobileHint: navigator.userAgentData?.mobile === true
            || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || ''),
    };
}

/**
 * One pass over the pixels to bin them.
 *
 * With mode 'sums' it also accumulates per-bin channel sums, so the mean colour
 * of a bin is available immediately; with 'pass' it stores counts only and the
 * means come later from refineColors().
 */
export function buildHistogram(rgba, { alphaCutoff = 8, mode = 'pass' } = {}) {
    const counts = new Int32Array(GRID_SIZE);
    const withSums = mode === 'sums';
    const sumR = withSums ? new Float64Array(GRID_SIZE) : null;
    const sumG = withSums ? new Float64Array(GRID_SIZE) : null;
    const sumB = withSums ? new Float64Array(GRID_SIZE) : null;
    let total = 0;

    for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] < alphaCutoff) continue;
        const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
        const k = idx(r >> (8 - GRID_BITS), g >> (8 - GRID_BITS), b >> (8 - GRID_BITS));
        counts[k]++;
        if (withSums) { sumR[k] += r; sumG[k] += g; sumB[k] += b; }
        total++;
    }

    const occupied = [];
    for (let k = 0; k < GRID_SIZE; k++) if (counts[k] > 0) occupied.push(k);

    return { counts, sumR, sumG, sumB, mode, occupied: Int32Array.from(occupied), total };
}

/** Mean colours straight from the histogram — only valid in 'sums' mode. */
function meansFromSums(hist, bins) {
    const out = new Map();
    for (const k of bins) {
        const n = hist.counts[k];
        out.set(k, n > 0
            ? [Math.round(hist.sumR[k] / n), Math.round(hist.sumG[k] / n), Math.round(hist.sumB[k] / n)]
            : binCentre(k));
    }
    return out;
}

/**
 * Mean colour of the pixels inside each of the given bins — truer to the image
 * than the bin centre. One pass, and only for bins that were actually chosen.
 * @param {number[]} bins grid indices
 * @returns {Map<number, [number,number,number]>}
 */
export function refineColors(rgba, bins, { alphaCutoff = 8 } = {}) {
    const want = new Map();
    bins.forEach((k, i) => want.set(k, i));
    const n = bins.length;
    const sr = new Float64Array(n), sg = new Float64Array(n), sb = new Float64Array(n);
    const cnt = new Float64Array(n);

    for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] < alphaCutoff) continue;
        const k = idx(rgba[i] >> (8 - GRID_BITS), rgba[i + 1] >> (8 - GRID_BITS),
            rgba[i + 2] >> (8 - GRID_BITS));
        const slot = want.get(k);
        if (slot === undefined) continue;
        sr[slot] += rgba[i]; sg[slot] += rgba[i + 1]; sb[slot] += rgba[i + 2];
        cnt[slot]++;
    }

    const out = new Map();
    bins.forEach((k, i) => {
        out.set(k, cnt[i] > 0
            ? [Math.round(sr[i] / cnt[i]), Math.round(sg[i] / cnt[i]), Math.round(sb[i] / cnt[i])]
            : binCentre(k));
    });
    return out;
}

/** Fallback when a bin somehow has no pixels: the centre of the bin. */
function binCentre(k) {
    const b = k % GRID_N;
    const g = ((k - b) / GRID_N) % GRID_N;
    const r = (k - b - g * GRID_N) / (GRID_N * GRID_N);
    const half = BIN / 2;
    return [Math.round(r * BIN + half), Math.round(g * BIN + half), Math.round(b * BIN + half)];
}

/**
 * Ball cross-sections: for each (dg, db) within the disc of radius rBins, the
 * half-extent along R. Turns the 3D kernel into ~pi r^2 interval sums.
 */
function ballCrossSections(rBins) {
    const out = [];
    const rr = rBins * rBins;
    const lim = Math.floor(rBins);
    for (let dg = -lim; dg <= lim; dg++) {
        for (let db = -lim; db <= lim; db++) {
            const rem = rr - dg * dg - db * db;
            if (rem < 0) continue;
            out.push([dg, db, Math.floor(Math.sqrt(rem))]);
        }
    }
    return out;
}

/**
 * Score every occupied voxel by the pixel count within `radius` (RGB units).
 * radius 0 scores each bin by its own count only.
 */
export function scoreOccupied(hist, radius) {
    const { counts, occupied } = hist;
    const rBins = radius / BIN;

    if (rBins < 0.5) {
        const scores = new Float64Array(occupied.length);
        for (let i = 0; i < occupied.length; i++) scores[i] = counts[occupied[i]];
        return scores;
    }

    // Prefix sums along the R axis: P[r] = sum of counts[0..r] for fixed (g,b).
    const prefix = new Float64Array(GRID_SIZE);
    for (let g = 0; g < GRID_N; g++) {
        for (let b = 0; b < GRID_N; b++) {
            let run = 0;
            for (let r = 0; r < GRID_N; r++) {
                run += counts[idx(r, g, b)];
                prefix[idx(r, g, b)] = run;
            }
        }
    }
    const rangeSum = (r0, r1, g, b) => {
        if (r1 < 0 || r0 > GRID_N - 1) return 0;
        const hi = prefix[idx(Math.min(r1, GRID_N - 1), g, b)];
        const lo = r0 > 0 ? prefix[idx(r0 - 1, g, b)] : 0;
        return hi - lo;
    };

    const sections = ballCrossSections(rBins);
    const scores = new Float64Array(occupied.length);

    for (let i = 0; i < occupied.length; i++) {
        const k = occupied[i];
        const b = k % GRID_N;
        const g = ((k - b) / GRID_N) % GRID_N;
        const r = (k - b - g * GRID_N) / (GRID_N * GRID_N);
        let s = 0;
        for (let j = 0; j < sections.length; j++) {
            const [dg, db, w] = sections[j];
            const gg = g + dg, bb = b + db;
            if (gg < 0 || gg >= GRID_N || bb < 0 || bb >= GRID_N) continue;
            s += rangeSum(r - w, r + w, gg, bb);
        }
        scores[i] = s;
    }
    return scores;
}

/**
 * Greedy peak selection with non-maximum suppression.
 *
 * Without suppression the top N voxels are all neighbours of one peak and the
 * palette is N shades of the same colour. After each pick, everything within
 * minSeparation (RGB units) is excluded.
 *
 * Separation is measured between bin centres rather than the final mean
 * colours, which differ by at most one bin (2 units) — far below any separation
 * worth setting, and it avoids needing the means before the bins are known.
 */
export function pickPeaks(hist, scores, { count, minSeparation }) {
    const order = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]);
    const chosen = [];
    const sep2 = minSeparation * minSeparation;

    for (const i of order) {
        if (chosen.length >= count) break;
        if (scores[i] <= 0) break;
        const k = hist.occupied[i];
        const rgb = binCentre(k);
        let tooClose = false;
        for (const c of chosen) {
            const dr = rgb[0] - c.rgb[0], dg = rgb[1] - c.rgb[1], db = rgb[2] - c.rgb[2];
            if (dr * dr + dg * dg + db * db < sep2) { tooClose = true; break; }
        }
        if (tooClose) continue;
        chosen.push({ bin: k, rgb, score: scores[i], exactCount: hist.counts[k] });
    }
    return chosen;
}

/**
 * Full extraction.
 *
 * @param {Uint8ClampedArray} rgba
 * @param {object} o
 * @param {number} o.count           how many colours to return
 * @param {number} o.radius          neighbourhood radius in RGB units (0 = exact)
 * @param {number} [o.minSeparation] suppression distance; defaults to a value
 *                                   derived from the radius
 * @param {'sums'|'pass'} [o.mode]   memory/time trade-off; detected if omitted
 * @returns {{colors: Array, total: number, distinctBins: number, ms: number, mode: string}}
 */
export function extractPalette(rgba, { count = 8, radius = 0, minSeparation = null, mode = null } = {}) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const chosenMode = mode ?? pickHistogramMode(detectEnv());
    const hist = buildHistogram(rgba, { mode: chosenMode });
    const scores = scoreOccupied(hist, radius);
    // A sensible default: suppress within the sampling radius, but never so
    // small that near-duplicates survive.
    const sep = minSeparation ?? Math.max(16, radius * 2);
    const peaks = pickPeaks(hist, scores, { count, minSeparation: sep });
    // Mean colour of each chosen bin, rather than the bin centre. In 'sums'
    // mode it is already accumulated; otherwise re-read the image for just
    // these bins.
    const bins = peaks.map((p) => p.bin);
    const means = hist.mode === 'sums' ? meansFromSums(hist, bins) : refineColors(rgba, bins);
    const t1 = (typeof performance !== 'undefined' ? performance : Date).now();

    return {
        colors: peaks.map((p) => ({
            rgb: means.get(p.bin) ?? p.rgb,
            score: p.score,
            share: hist.total ? p.score / hist.total : 0,
            exactCount: p.exactCount,
        })),
        total: hist.total,
        distinctBins: hist.occupied.length,
        ms: t1 - t0,
        mode: hist.mode,
        extraBytes: hist.mode === 'sums' ? SUMS_EXTRA_BYTES : 0,
    };
}
