// Node test for smooth.js — run with: node js/smooth.test.js
import {
    spatialSmooth, meanFilter, medianFilter, blendMasked, maxSize, windowFor, MAX_MEDIAN_SIZE,
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

    const despeckled = spatialSmooth(grid, bw, bh, { size: 3, mode: 'despeckle' });
    ok('the speck is gone entirely',
        near(at(despeckled, bw, 10, 10)[0], SKY[0]) && near(at(despeckled, bw, 10, 10)[2], SKY[2]),
        JSON.stringify(at(despeckled, bw, 10, 10)));
    ok('the sky around it is untouched',
        near(at(despeckled, bw, 4, 4)[0], SKY[0]) && near(at(despeckled, bw, 15, 3)[2], SKY[2]));

    // The mean is the filter people reach for, and it is the wrong one here:
    // the speck survives as a smear across its whole neighbourhood.
    const softened = spatialSmooth(grid, bw, bh, { size: 3, mode: 'soften' });
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

    const med = spatialSmooth(grid, bw, bh, { size: 5, mode: 'despeckle' });
    ok('median: the dark side stays dark right up to the edge', near(at(med, bw, 9, 4)[0], 0),
        JSON.stringify(at(med, bw, 9, 4)));
    ok('median: the light side stays light', near(at(med, bw, 10, 4)[0], 255),
        JSON.stringify(at(med, bw, 10, 4)));

    const mean = spatialSmooth(grid, bw, bh, { size: 5, mode: 'soften' });
    const a = at(mean, bw, 9, 4)[0], b = at(mean, bw, 10, 4)[0];
    ok('mean: the edge is smeared into a ramp', a > 10 && b < 245, `${a.toFixed(1)} / ${b.toFixed(1)}`);
}

console.log('\n--- flat stays flat, both filters ---');
{
    const bw = 12, bh = 9;
    const grid = flat(bw, bh, [33, 77, 199]);
    for (const mode of ['despeckle', 'soften']) {
        for (const size of [2, 3, 5, 9]) {
            const out = spatialSmooth(grid, bw, bh, { size, mode });
            let worst = 0;
            for (let i = 0; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - grid[i]));
            ok(`${mode} ${size}x${size}: unchanged (edges replicate rather than darken)`, worst < 0.01,
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
        const out = spatialSmooth(grid, bw, bh, { size: 7, mode });
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

    const half = spatialSmooth(grid, bw, bh, { size: 3, mode: 'despeckle', strength: 0.5 });
    const v = at(half, bw, 5, 5)[0];
    ok('half strength lands between the two', v > SKY[0] + 50 && v < SPECK[0] - 50, `${v.toFixed(1)}`);

    const none = spatialSmooth(grid, bw, bh, { size: 3, mode: 'despeckle', strength: 0 });
    ok('zero strength is the original array, untouched', none === grid);

    const full = spatialSmooth(grid, bw, bh, { size: 3, mode: 'despeckle', strength: 1 });
    ok('full strength removes it', near(at(full, bw, 5, 5)[0], SKY[0]));
}

console.log('\n--- nothing to do is nothing done ---');
{
    const grid = flat(6, 6, [10, 20, 30]);
    ok('a 1x1 window returns the original', spatialSmooth(grid, 6, 6, { size: 1 }) === grid);
    ok('a fractional size does something', spatialSmooth(grid, 6, 6, { size: 1.4 }) !== grid);
    ok('a negative size returns the original', spatialSmooth(grid, 6, 6, { size: -3 }) === grid);
    ok('the source is never modified in place', (() => {
        const before = Array.from(grid);
        spatialSmooth(grid, 6, 6, { size: 5, mode: 'soften' });
        return before.every((v, i) => v === grid[i]);
    })());
}

console.log('\n--- a fractional size is a ramp, not a step ---');
{
    // The complaint this exists for: radius 1 is already a full 3x3
    // neighbourhood, so 0 -> 1 was the largest jump the control could make and
    // there was nothing in between.
    const bw = 15, bh = 15;
    const grid = flat(bw, bh, SKY);
    setAt(grid, bw, 7, 7, SPECK);

    const speck = (n) => at(spatialSmooth(grid, bw, bh, { size: n, mode: 'despeckle' }), bw, 7, 7)[0];
    const full = speck(2);
    const steps = [1.25, 1.5, 1.75].map(speck);

    ok('every quarter step lands between untouched and radius 1',
        steps.every((v) => v < SPECK[0] - 1 && v > full + 1), steps.map((v) => v.toFixed(1)).join(', '));
    ok('and they descend in order',
        steps[0] > steps[1] && steps[1] > steps[2], steps.map((v) => v.toFixed(1)).join(' > '));
    ok('0.5 sits about halfway', Math.abs(steps[1] - (SPECK[0] + full) / 2) < 2, `${steps[1].toFixed(1)}`);

    // The same has to hold between whole radii further up.
    const bwl = 41, bhl = 41;
    const g2 = flat(bwl, bhl, SKY);
    for (const [x, y] of [[20, 20], [21, 20], [20, 21]]) setAt(g2, bwl, x, y, SPECK);
    const soft = (n) => at(spatialSmooth(g2, bwl, bhl, { size: n, mode: 'soften' }), bwl, 20, 20)[0];
    const a1 = soft(3), a15 = soft(3.5), a2 = soft(4);
    ok('3.5 lies between 3x3 and 4x4',
        (a15 - a1) * (a2 - a15) > 0 && Math.abs(a15 - (a1 + a2) / 2) < Math.abs(a2 - a1),
        `${a1.toFixed(1)} / ${a15.toFixed(1)} / ${a2.toFixed(1)}`);

    ok('a whole size is unaffected by the blending path',
        speck(2) === at(medianFilter(grid, bw, bh, 2), bw, 7, 7)[0]);
}

console.log('\n--- every window size exists, not just the odd ones ---');
{
    // Built on a radius the filter could only make odd windows: 1x1, then
    // straight to 3x3. There was no 2x2, which is why the first notch changed
    // so much more than any notch after it.
    const bw = 13, bh = 13;
    const grid = flat(bw, bh, SKY);
    setAt(grid, bw, 6, 6, SPECK);
    const speck = (size) => at(spatialSmooth(grid, bw, bh, { size, mode: 'despeckle' }), bw, 6, 6)[0];

    ok('1x1 does nothing', near(speck(1), SPECK[0]));
    ok('2x2 exists and clears the speck', near(speck(2), SKY[0]), `${speck(2).toFixed(1)}`);
    ok('3x3 still works', near(speck(3), SKY[0]));
    ok('4x4 exists', near(speck(4), SKY[0]));
    ok('5x5 still works', near(speck(5), SKY[0]));
}

console.log('\n--- an even window does not shift the picture ---');
{
    // An even edge has no centre block, so one placement alone would drag
    // everything half a block sideways. Both are averaged; a hard edge should
    // therefore blur symmetrically about where it actually is.
    const bw = 24, bh = 5;
    const grid = new Float32Array(bw * bh * 3);
    for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) setAt(grid, bw, x, y, x < 12 ? [0, 0, 0] : [240, 240, 240]);
    }
    for (const size of [2, 4, 6]) {
        const out = spatialSmooth(grid, bw, bh, { size, mode: 'soften' });
        // Mirror pairs about the edge between x=11 and x=12.
        let worst = 0;
        for (let d = 0; d < 5; d++) {
            const l = at(out, bw, 11 - d, 2)[0];
            const r = at(out, bw, 12 + d, 2)[0];
            worst = Math.max(worst, Math.abs(l - (240 - r)));
        }
        ok(`${size}x${size} blurs symmetrically about the edge`, worst < 1, `worst ${worst.toFixed(2)}`);
    }
}

console.log('\n--- rows and columns ---');
{
    ok('a row is n wide and one tall', JSON.stringify(windowFor(2, 'row')) === '[2,1]');
    ok('a column is one wide and n tall', JSON.stringify(windowFor(2, 'column')) === '[1,2]');
    ok('a square is both', JSON.stringify(windowFor(3, 'square')) === '[3,3]');

    // A horizontal streak should be removed by a column window, which samples
    // across it, and left alone by a row window, which samples along it.
    const bw = 15, bh = 15;
    const grid = flat(bw, bh, SKY);
    for (let x = 0; x < bw; x++) setAt(grid, bw, x, 7, SPECK);

    const row = spatialSmooth(grid, bw, bh, { size: 3, shape: 'row', mode: 'despeckle' });
    const col = spatialSmooth(grid, bw, bh, { size: 3, shape: 'column', mode: 'despeckle' });
    ok('a row window leaves a horizontal streak alone', near(at(row, bw, 7, 7)[0], SPECK[0]),
        `${at(row, bw, 7, 7)[0].toFixed(1)}`);
    ok('a column window removes it', near(at(col, bw, 7, 7)[0], SKY[0]),
        `${at(col, bw, 7, 7)[0].toFixed(1)}`);

    // And the other way about for a vertical streak.
    const g2 = flat(bw, bh, SKY);
    for (let y = 0; y < bh; y++) setAt(g2, bw, 7, y, SPECK);
    const row2 = spatialSmooth(g2, bw, bh, { size: 3, shape: 'row', mode: 'despeckle' });
    const col2 = spatialSmooth(g2, bw, bh, { size: 3, shape: 'column', mode: 'despeckle' });
    ok('a column window leaves a vertical streak alone', near(at(col2, bw, 7, 7)[0], SPECK[0]));
    ok('a row window removes it', near(at(row2, bw, 7, 7)[0], SKY[0]));

    // The pair the brief asked for.
    const g3 = flat(bw, bh, SKY);
    setAt(g3, bw, 7, 7, SPECK);
    const pairH = spatialSmooth(g3, bw, bh, { size: 2, shape: 'row', mode: 'soften' });
    const pairV = spatialSmooth(g3, bw, bh, { size: 2, shape: 'column', mode: 'soften' });
    ok('2x1 does something', at(pairH, bw, 7, 7)[0] < SPECK[0] - 1);
    ok('1x2 does something', at(pairV, bw, 7, 7)[0] < SPECK[0] - 1);
    ok('2x1 spreads sideways only',
        at(pairH, bw, 8, 7)[0] > SKY[0] + 1 && near(at(pairH, bw, 7, 8)[0], SKY[0]));
    ok('1x2 spreads downwards only',
        at(pairV, bw, 7, 8)[0] > SKY[0] + 1 && near(at(pairV, bw, 8, 7)[0], SKY[0]));
}

console.log('\n--- size limits ---');
{
    ok('a tenth of the short side', maxSize(1920, 1080) === 108);
    ok('and of a small grid', maxSize(192, 108) === 11);
    ok('never below 2', maxSize(10, 10) === 2 && maxSize(1, 1) === 2);

    // A median asked for more than it can afford quietly does what it can,
    // rather than locking the tab up.
    const bw = 25, bh = 25;
    const grid = flat(bw, bh, SKY);
    setAt(grid, bw, 12, 12, SPECK);
    const huge = spatialSmooth(grid, bw, bh, { size: 81, mode: 'despeckle' });
    ok(`median size is capped at ${MAX_MEDIAN_SIZE}`, near(at(huge, bw, 12, 12)[0], SKY[0]));
}

console.log('\n--- separability: the mean does not depend on radius for cost ---');
{
    // Not a timing test, a correctness one: the sliding window must agree with
    // the naive sum it replaces.
    const bw = 17, bh = 13;
    const grid = new Float32Array(bw * bh * 3);
    for (let i = 0; i < grid.length; i++) grid[i] = (i * 53) % 251;

    const r = 2;
    const once = meanFilter(grid, bw, bh, 5, 5, 1);
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

    const filtered = medianFilter(grid, bw, bh, 3);
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
