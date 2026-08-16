// Node test for core.js — run with: node js/core.test.js
import {
    applyOffsets, boxDownsample, buildPaletteLUT, mapToPalette, mapToPaletteExact,
    blendSerial, blendChunked, upscaleNearest, blockHeight, nearestColor, hexToRgb,
} from './core.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n        ' + detail : ''}`); }
};

// Deterministic PRNG so failures reproduce.
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const makeFrames = (n, len) => Array.from({ length: n }, () => {
    const f = new Float32Array(len);
    for (let i = 0; i < len; i++) f[i] = rnd() * 255;
    return f;
});
const clone = (frames) => frames.map((f) => Float32Array.from(f));
const maxDiff = (a, b) => {
    let m = 0;
    for (let t = 0; t < a.length; t++)
        for (let i = 0; i < a[t].length; i++)
            m = Math.max(m, Math.abs(a[t][i] - b[t][i]));
    return m;
};

console.log('\n--- temporal blend ---');
{
    // The whole premise of "blend last, in parallel": the chunked form must be
    // numerically identical to the serial recurrence.
    for (const alpha of [0.25, 0.5, 0.75, 0.99]) {
        for (const chunkSize of [1, 3, 8, 32]) {
            const base = makeFrames(40, 300);
            const a = blendSerial(clone(base), alpha);
            const b = blendChunked(clone(base), alpha, chunkSize);
            const d = maxDiff(a, b);
            ok(`chunked == serial (alpha=${alpha}, chunk=${chunkSize})`, d < 1e-3,
                `max abs diff = ${d}`);
        }
    }

    // Reference semantics from Pixelator.py: s_0 = c_0, then the recurrence.
    const f = makeFrames(5, 4);
    const c0 = Float32Array.from(f[0]);
    const c1 = Float32Array.from(f[1]);
    const out = blendSerial(clone(f), 0.5);
    ok('s_0 == c_0 (no blend on first frame)', maxDiff([out[0]], [c0]) === 0);
    const expect1 = c1.map((v, i) => 0.5 * v + 0.5 * c0[i]);
    ok('s_1 == (1-a)c_1 + a*s_0', maxDiff([out[1]], [expect1]) < 1e-4);

    const zero = blendSerial(clone(f), 0);
    ok('alpha=0 is identity', maxDiff(zero, f) === 0);
}

console.log('\n--- palette mapping ---');
{
    const palette = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 128, 64], [15, 56, 15]];
    const lut = buildPaletteLUT(palette, 5);

    const n = 3000;
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = rnd() * 255;

    const viaLut = mapToPalette(rgb, lut);
    const exact = mapToPaletteExact(rgb, palette);
    let same = 0;
    for (let i = 0; i < n; i++) {
        if (viaLut[i * 3] === exact[i * 3] && viaLut[i * 3 + 1] === exact[i * 3 + 1] &&
            viaLut[i * 3 + 2] === exact[i * 3 + 2]) same++;
    }
    const agree = same / n;
    ok(`LUT agrees with exact search (${(agree * 100).toFixed(2)}%)`, agree > 0.98,
        `only ${(agree * 100).toFixed(2)}% agreement`);

    // Every output colour must be a palette member, LUT or not.
    const inPalette = (r, g, b) => palette.some((p) => p[0] === r && p[1] === g && p[2] === b);
    let bad = 0;
    for (let i = 0; i < n; i++) if (!inPalette(viaLut[i * 3], viaLut[i * 3 + 1], viaLut[i * 3 + 2])) bad++;
    ok('LUT only emits palette colours', bad === 0, `${bad} non-palette outputs`);

    ok('exact match on a palette colour', (() => {
        const c = nearestColor(255, 0, 0, palette);
        return c[0] === 255 && c[1] === 0 && c[2] === 0;
    })());
}

console.log('\n--- downsample / upscale ---');
{
    // A 4x4 of two flat halves must average to exactly those two values.
    const w = 4, h = 4;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const v = x < 2 ? 100 : 200;
            src[i] = src[i + 1] = src[i + 2] = v; src[i + 3] = 255;
        }
    }
    const small = boxDownsample(src, w, h, 2, 1);
    ok('box average of flat halves', Math.abs(small[0] - 100) < 1e-4 && Math.abs(small[3] - 200) < 1e-4,
        `got ${small[0]} and ${small[3]}`);

    // Downsampling a uniform image must preserve the value exactly.
    const uni = new Uint8ClampedArray(64 * 64 * 4).fill(77);
    const us = boxDownsample(uni, 64, 64, 7, 5);
    let uok = true;
    for (let i = 0; i < us.length; i++) if (Math.abs(us[i] - 77) > 1e-4) uok = false;
    ok('uniform image survives downsample', uok);

    const up = upscaleNearest(new Uint8ClampedArray([10, 20, 30, 40, 50, 60]), 2, 1, 4, 2);
    ok('nearest upscale replicates blocks',
        up[0] === 10 && up[4] === 10 && up[8] === 40 && up[12] === 40 && up[3] === 255);

    ok('blockHeight preserves aspect', blockHeight(192, 1920, 1080) === 108);
}

console.log('\n--- offsets ---');
{
    const px = new Uint8ClampedArray([10, 250, 100, 255]);
    applyOffsets(px, [20, 20, -200]);
    ok('offsets clamp at both ends', px[0] === 30 && px[1] === 255 && px[2] === 0 && px[3] === 255,
        `got ${Array.from(px)}`);
}

console.log('\n--- hex parsing ---');
{
    ok('hexToRgb accepts #rrggbb', String(hexToRgb('#0f380f')) === '15,56,15');
    ok('hexToRgb rejects junk', hexToRgb('nope') === null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
