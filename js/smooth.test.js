// Node test for smooth.js — run with: node js/smooth.test.js
import {
    spatialSmooth, meanFilter, medianFilter, blendMasked, maxRadius, MAX_MEDIAN_RADIUS,
} from './smooth.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n        ' + detail : ''}`); }
};
const near = (a, b, tol = 0.51) => Math.abs(a - b) <= tol;

/** A grid of one flat colour. */
function flat(bw, bh, [r, g, b]) {
    const out = new Float32Array(bw * bh * 3);
    for (let i = 0; i < bw * bh; i++) { out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b; }
    return out;
}
const at = (rgb, bw, x, y) => [rgb[(y * bw + x) * 3], rgb[(y * bw + x) * 3 + 1], rgb[(y * bw + x) * 3 + 2]];
const setAt = (rgb, bw, x, y, [r, g, b]) => {
    const o = (y * bw + x) * 3; rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
};

const SKY = [60, 110, 200];
const SPECK = [255, 255, 255];

console.log('\n--- the case it exists for: one white block in a blue sky ---');
{
    const bw = 21, bh = 21;
    const grid = flat(bw, bh, SKY);
    setAt(grid, bw, 10, 10, SPECK);

    const despeckled = spatialSmooth(grid, bw, bh, { radius: 1, mode: 'despeckle' });
    ok('the speck is gone entirely',
        near(at(despeckled, bw, 10, 10)[0], SKY[0]) && near(at(despeckled, bw, 10, 10)[2], SKY[2]),
        JSON.stringify(at(despeckled, bw, 10, 10)));
    ok('the sky around it is untouched',
        near(at(despeckled, bw, 4, 4)[0], SKY[0]) && near(at(despeckled, bw, 15, 3)[2], SKY[2]));

    // The mean is the filter people reach for, and it is the wrong one here:
    // the speck survives as a smear across its whole neighbourhood.
    const softened = spatialSmooth(grid, bw, bh, { radius: 1, mode: 'soften' });
    const centre = at(softened, bw, 10, 10);
    const neighbour = at(softened, bw, 11, 10);
    ok('the mean leaves the speck visible', centre[0] > SKY[0] + 10, JSON.stringify(centre));
    ok('and spreads it onto its neighbours', neighbour[0] > SKY[0] + 2, JSON.stringify(neighbour));
}

console.log('\n--- a median keeps edges where a mean does not ---');
{
    const bw = 20, bh = 8;
    const grid = new Float32Array(bw * bh * 3);
    for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) setAt(grid, bw, x, y, x < 10 ? [0, 0, 0] : [255, 255, 255]);
    }

    const med = spatialSmooth(grid, bw, bh, { radius: 2, mode: 'despeckle' });
    ok('median: the dark side stays dark right up to the edge', near(at(med, bw, 9, 4)[0], 0),
        JSON.stringify(at(med, bw, 9, 4)));
    ok('median: the light side stays light', near(at(med, bw, 10, 4)[0], 255),
        JSON.stringify(at(med, bw, 10, 4)));

    const mean = spatialSmooth(grid, bw, bh, { radius: 2, mode: 'soften' });
    const a = at(mean, bw, 9, 4)[0], b = at(mean, bw, 10, 4)[0];
    ok('mean: the edge is smeared into a ramp', a > 10 && b < 245, `${a.toFixed(1)} / ${b.toFixed(1)}`);
}

console.log('\n--- flat stays flat, both filters ---');
{
    const bw = 12, bh = 9;
    const grid = flat(bw, bh, [33, 77, 199]);
    for (const mode of ['despeckle', 'soften']) {
        for (const radius of [1, 2, 4]) {
            const out = spatialSmooth(grid, bw, bh, { radius, mode });
            let worst = 0;
            for (let i = 0; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - grid[i]));
            ok(`${mode} r${radius}: unchanged (edges replicate rather than darken)`, worst < 0.01,
                `worst ${worst}`);
        }
    }
}

console.log('\n--- values stay in range ---');
{
    const bw = 16, bh = 16;
    const grid = new Float32Array(bw * bh * 3);
    for (let i = 0; i < grid.length; i++) grid[i] = (i * 37) % 256;
    for (const mode of ['despeckle', 'soften']) {
        const out = spatialSmooth(grid, bw, bh, { radius: 3, mode });
        let lo = Infinity, hi = -Infinity;
        for (const v of out) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        ok(`${mode}: within 0..255`, lo >= -0.01 && hi <= 255.01, `${lo.toFixed(2)}..${hi.toFixed(2)}`);
    }
}

console.log('\n--- strength is a dial ---');
{
    const bw = 11, bh = 11;
    const grid = flat(bw, bh, SKY);
    setAt(grid, bw, 5, 5, SPECK);

    const half = spatialSmooth(grid, bw, bh, { radius: 1, mode: 'despeckle', strength: 0.5 });
    const v = at(half, bw, 5, 5)[0];
    ok('half strength lands between the two', v > SKY[0] + 50 && v < SPECK[0] - 50, `${v.toFixed(1)}`);

    const none = spatialSmooth(grid, bw, bh, { radius: 1, mode: 'despeckle', strength: 0 });
    ok('zero strength is the original array, untouched', none === grid);

    const full = spatialSmooth(grid, bw, bh, { radius: 1, mode: 'despeckle', strength: 1 });
    ok('full strength removes it', near(at(full, bw, 5, 5)[0], SKY[0]));
}

console.log('\n--- nothing to do is nothing done ---');
{
    const grid = flat(6, 6, [10, 20, 30]);
    ok('radius 0 returns the original', spatialSmooth(grid, 6, 6, { radius: 0 }) === grid);
    ok('a fractional radius under 1 returns the original',
        spatialSmooth(grid, 6, 6, { radius: 0.4 }) === grid);
    ok('a negative radius returns the original', spatialSmooth(grid, 6, 6, { radius: -3 }) === grid);
    ok('the source is never modified in place', (() => {
        const before = Array.from(grid);
        spatialSmooth(grid, 6, 6, { radius: 2, mode: 'soften' });
        return before.every((v, i) => v === grid[i]);
    })());
}

console.log('\n--- radius limits ---');
{
    ok('a twentieth of the short side', maxRadius(1920, 1080) === 54);
    ok('and of a small grid', maxRadius(192, 108) === 5);
    ok('never below 1', maxRadius(10, 10) === 1 && maxRadius(1, 1) === 1);

    // A median asked for more than it can afford quietly does what it can,
    // rather than locking the tab up.
    const bw = 25, bh = 25;
    const grid = flat(bw, bh, SKY);
    setAt(grid, bw, 12, 12, SPECK);
    const huge = spatialSmooth(grid, bw, bh, { radius: 40, mode: 'despeckle' });
    ok(`median radius is capped at ${MAX_MEDIAN_RADIUS}`, near(at(huge, bw, 12, 12)[0], SKY[0]));
}

console.log('\n--- separability: the mean does not depend on radius for cost ---');
{
    // Not a timing test, a correctness one: the sliding window must agree with
    // the naive sum it replaces.
    const bw = 17, bh = 13;
    const grid = new Float32Array(bw * bh * 3);
    for (let i = 0; i < grid.length; i++) grid[i] = (i * 53) % 251;

    const r = 2;
    const once = meanFilter(grid, bw, bh, r, 1);
    // Naive single box, edges replicated, for one channel of one block.
    const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
    for (const [x, y] of [[0, 0], [8, 6], [16, 12], [3, 12]]) {
        let sum = 0, n = 0;
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                sum += grid[(clamp(y + dy, bh - 1) * bw + clamp(x + dx, bw - 1)) * 3];
                n++;
            }
        }
        ok(`sliding window matches the naive sum at ${x},${y}`,
            near(at(once, bw, x, y)[0], sum / n, 0.01),
            `${at(once, bw, x, y)[0].toFixed(3)} vs ${(sum / n).toFixed(3)}`);
    }
}

console.log('\n--- masked blending, which is how the brush smooths one region ---');
{
    const bw = 9, bh = 9;
    const grid = flat(bw, bh, SKY);
    setAt(grid, bw, 4, 4, SPECK);
    setAt(grid, bw, 1, 1, SPECK);

    const filtered = medianFilter(grid, bw, bh, 1);
    const mask = new Int32Array(bw * bh);
    mask[4 * bw + 4] = 100;             // only the middle speck is brushed

    const out = Float32Array.from(grid);
    blendMasked(out, filtered, mask);
    ok('the brushed speck is cleaned', near(at(out, bw, 4, 4)[0], SKY[0]),
        JSON.stringify(at(out, bw, 4, 4)));
    ok('the unbrushed speck is left alone', near(at(out, bw, 1, 1)[0], SPECK[0]),
        JSON.stringify(at(out, bw, 1, 1)));

    const partial = Float32Array.from(grid);
    const m2 = new Int32Array(bw * bh);
    m2[4 * bw + 4] = 50;
    blendMasked(partial, filtered, m2);
    const v = at(partial, bw, 4, 4)[0];
    ok('a partial mask blends', v > SKY[0] + 50 && v < SPECK[0] - 50, `${v.toFixed(1)}`);

    const untouched = Float32Array.from(grid);
    blendMasked(untouched, filtered, new Int32Array(bw * bh));
    ok('an empty mask changes nothing',
        Array.from(untouched).every((v2, i) => v2 === grid[i]));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
