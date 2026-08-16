// core.js — pixelation engine, shared by the photo and video paths.
//
// Everything here is pure and works on typed arrays, so it runs identically on
// the main thread, in a Worker, or as a CPU fallback behind the GPU backends.
//
// Pipeline order (matches the original Pixelator.py):
//   offsets -> downsample to block res -> [temporal blend, video only] -> palette map -> upscale
//
// The blend is deliberately the LAST stage before palette mapping: it feeds back
// pre-palette values, so quantising earlier would change the result.

/** Clamp to a byte. */
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Apply per-channel RGB offsets in place.
 * @param {Uint8ClampedArray} rgba packed RGBA
 * @param {[number,number,number]} offsets
 */
export function applyOffsets(rgba, offsets) {
    const [ro, go, bo] = offsets;
    if (ro === 0 && go === 0 && bo === 0) return rgba;
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = clamp255(rgba[i] + ro);
        rgba[i + 1] = clamp255(rgba[i + 1] + go);
        rgba[i + 2] = clamp255(rgba[i + 2] + bo);
    }
    return rgba;
}

/**
 * Box-average downsample to block resolution, returning planar-free RGB floats.
 *
 * This is cv2.INTER_AREA, not INTER_LINEAR. For the large downscale factors this
 * app uses (1920 -> 192), a bilinear filter samples only a few source pixels per
 * destination pixel and aliases badly; averaging the whole source rectangle is
 * both correct and what "pixelate" is supposed to mean.
 *
 * @returns {Float32Array} dw*dh*3 RGB, values 0..255
 */
export function boxDownsample(srcRGBA, sw, sh, dw, dh) {
    const out = new Float32Array(dw * dh * 3);
    for (let by = 0; by < dh; by++) {
        const y0 = Math.floor((by * sh) / dh);
        const y1 = Math.max(y0 + 1, Math.floor(((by + 1) * sh) / dh));
        for (let bx = 0; bx < dw; bx++) {
            const x0 = Math.floor((bx * sw) / dw);
            const x1 = Math.max(x0 + 1, Math.floor(((bx + 1) * sw) / dw));
            let r = 0, g = 0, b = 0, n = 0;
            for (let y = y0; y < y1; y++) {
                let idx = (y * sw + x0) * 4;
                for (let x = x0; x < x1; x++, idx += 4) {
                    r += srcRGBA[idx];
                    g += srcRGBA[idx + 1];
                    b += srcRGBA[idx + 2];
                    n++;
                }
            }
            const o = (by * dw + bx) * 3;
            out[o] = r / n;
            out[o + 1] = g / n;
            out[o + 2] = b / n;
        }
    }
    return out;
}

/**
 * Exact nearest-palette-colour search (squared Euclidean RGB).
 * Used to build the LUT and as the reference for tests.
 */
export function nearestColor(r, g, b, palette) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
        const p = palette[i];
        const dr = r - p[0], dg = g - p[1], db = b - p[2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = i; }
    }
    return palette[best];
}

/**
 * Precompute a nearest-colour lookup table over a quantised RGB cube.
 *
 * Replaces the per-pixel linear scan (and the Python KDTree) with an O(1) probe.
 * At bits=5 that is 32^3 = 32768 entries, built once per palette.
 *
 * Cells are indexed by the TOP `bits` of each channel and evaluated at the cell
 * centre, so the answer matches an exact search except within half a cell of a
 * Voronoi boundary between two palette colours.
 *
 * @returns {{lut: Uint8Array, bits: number}}
 */
export function buildPaletteLUT(palette, bits = 5) {
    const n = 1 << bits;
    const lut = new Uint8Array(n * n * n * 3);
    const step = 256 / n;
    const centre = step / 2;
    let o = 0;
    for (let ri = 0; ri < n; ri++) {
        const r = ri * step + centre;
        for (let gi = 0; gi < n; gi++) {
            const g = gi * step + centre;
            for (let bi = 0; bi < n; bi++) {
                const b = bi * step + centre;
                const c = nearestColor(r, g, b, palette);
                lut[o++] = c[0]; lut[o++] = c[1]; lut[o++] = c[2];
            }
        }
    }
    return { lut, bits };
}

/**
 * Map block-resolution RGB floats to the palette via the LUT.
 * @param {Float32Array} rgb  w*h*3
 * @returns {Uint8ClampedArray} w*h*3
 */
export function mapToPalette(rgb, { lut, bits }) {
    const shift = 8 - bits;
    const n = 1 << bits;
    const out = new Uint8ClampedArray(rgb.length);
    for (let i = 0; i < rgb.length; i += 3) {
        const r = clamp255(rgb[i]) >> shift;
        const g = clamp255(rgb[i + 1]) >> shift;
        const b = clamp255(rgb[i + 2]) >> shift;
        const o = ((r * n + g) * n + b) * 3;
        out[i] = lut[o];
        out[i + 1] = lut[o + 1];
        out[i + 2] = lut[o + 2];
    }
    return out;
}

/** Exact (non-LUT) palette mapping — reference path, and fine at block res. */
export function mapToPaletteExact(rgb, palette) {
    const out = new Uint8ClampedArray(rgb.length);
    for (let i = 0; i < rgb.length; i += 3) {
        const c = nearestColor(rgb[i], rgb[i + 1], rgb[i + 2], palette);
        out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2];
    }
    return out;
}

/**
 * Temporal blend, serial reference:  s_0 = c_0,  s_t = (1-a)*c_t + a*s_{t-1}
 *
 * Mutates `frames` in place. At block resolution the whole pass is a few million
 * multiply-adds — single-digit milliseconds — so this is not worth a GPU.
 *
 * @param {Float32Array[]} frames
 */
export function blendSerial(frames, alpha) {
    if (alpha <= 0 || frames.length < 2) return frames;
    const a = alpha, ia = 1 - alpha;
    for (let t = 1; t < frames.length; t++) {
        const cur = frames[t], prev = frames[t - 1];
        for (let i = 0; i < cur.length; i++) {
            cur[i] = ia * cur[i] + a * prev[i];
        }
    }
    return frames;
}

/**
 * Same EMA, computed in independent chunks — the parallel-friendly form.
 *
 * The recurrence is linear, so a chunk can be evaluated with zero carry-in and
 * corrected afterwards:  s_t = s_t^local + a^(t-t0+1) * s_{t0-1}
 *
 * That makes the "serial" temporal stage a prefix scan: chunks run concurrently
 * (Workers, or one GPU dispatch per chunk), then one cheap fix-up pass. Kept here
 * mainly to prove the dependency is not a real constraint — `blendSerial` is fast
 * enough at block resolution that you would only reach for this at full res.
 */
export function blendChunked(frames, alpha, chunkSize = 32) {
    if (alpha <= 0 || frames.length < 2) return frames;
    const a = alpha, ia = 1 - alpha;
    const n = frames.length;
    const len = frames[0].length;

    // Pass 1: each chunk independently, carry-in assumed zero (chunk 0 is exact).
    //
    // Chunk 0 keeps the reference initial condition s_0 = c_0. Later chunks must
    // be seeded with (1-a)*c_start BEFORE recursing, so that the local result is
    //   L_t = (1-a) * sum_{k=0..t-start} a^k c_{t-k}
    // Scaling the chunk afterwards instead would put an extra (1-a) on every term.
    const chunks = [];
    for (let start = 0; start < n; start += chunkSize) {
        chunks.push([start, Math.min(start + chunkSize, n)]);
    }
    for (const [start, end] of chunks) {
        if (start > 0) {
            const seed = frames[start];
            for (let i = 0; i < len; i++) seed[i] = ia * seed[i];
        }
        for (let t = start + 1; t < end; t++) {
            const cur = frames[t], prev = frames[t - 1];
            for (let i = 0; i < len; i++) cur[i] = ia * cur[i] + a * prev[i];
        }
    }

    // Pass 2: propagate each chunk's carry-in. Sequential over chunks only
    // (n/chunkSize steps), and each step is itself data-parallel.
    for (let ci = 1; ci < chunks.length; ci++) {
        const [start, end] = chunks[ci];
        const carry = frames[start - 1];
        let coef = a;
        for (let t = start; t < end; t++, coef *= a) {
            const cur = frames[t];
            for (let i = 0; i < len; i++) cur[i] += coef * carry[i];
        }
    }
    return frames;
}

/**
 * Nearest-neighbour upscale from block res RGB to full res RGBA.
 * This is the only stage that touches w*h pixels.
 */
export function upscaleNearest(rgb, bw, bh, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    let o = 0;
    for (let y = 0; y < h; y++) {
        const sy = Math.min(bh - 1, (y * bh / h) | 0);
        for (let x = 0; x < w; x++) {
            const sx = Math.min(bw - 1, (x * bw / w) | 0);
            const s = (sy * bw + sx) * 3;
            out[o++] = rgb[s];
            out[o++] = rgb[s + 1];
            out[o++] = rgb[s + 2];
            out[o++] = 255;
        }
    }
    return out;
}

/** #rrggbb -> [r,g,b]; returns null on malformed input. */
export function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/** [r,g,b] -> #RRGGBB */
export function rgbToHex(r, g, b) {
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

/** Block height preserving aspect ratio, matching bh = round(bw*h/w). */
export function blockHeight(bw, w, h) {
    return Math.max(1, Math.round((bw * h) / w));
}

/**
 * Single still image, full pipeline. Used by the photo tab; also the per-frame
 * stage of the video path when no GPU backend is available.
 * @returns {{rgb: Uint8ClampedArray, bw: number, bh: number}} block-res result
 */
export function processStill(rgba, w, h, { bw, bh, offsets, palette, lut }) {
    const outH = bh || blockHeight(bw, w, h);
    applyOffsets(rgba, offsets);
    const small = boxDownsample(rgba, w, h, bw, outH);
    const mapped = lut ? mapToPalette(small, lut) : mapToPaletteExact(small, palette);
    return { rgb: mapped, bw, bh: outH };
}
