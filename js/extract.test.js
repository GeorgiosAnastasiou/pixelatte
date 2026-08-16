// Node test for extract.js — run with: node js/extract.test.js
import {
    buildHistogram, scoreOccupied, pickPeaks, extractPalette, pickHistogramMode, SUMS_EXTRA_BYTES,
} from './extract.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '\n        ' + d : ''}`)); };

/** Build an RGBA buffer from [[r,g,b,count], ...]. */
function makeImage(spec) {
    const total = spec.reduce((s, [, , , n]) => s + n, 0);
    const px = new Uint8ClampedArray(total * 4);
    let i = 0;
    for (const [r, g, b, n] of spec) {
        for (let k = 0; k < n; k++) { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; i += 4; }
    }
    return px;
}
const near = (a, b, tol = 3) =>
    Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

console.log('\n--- exact counting (radius 0) ---');
{
    const img = makeImage([[255, 0, 0, 500], [0, 255, 0, 300], [0, 0, 255, 100], [10, 10, 10, 50]]);
    const r = extractPalette(img, { count: 3, radius: 0 });
    ok('returns the requested number of colours', r.colors.length === 3, `got ${r.colors.length}`);
    ok('ranked by frequency', near(r.colors[0].rgb, [255, 0, 0]) && near(r.colors[1].rgb, [0, 255, 0]),
        JSON.stringify(r.colors.map((c) => c.rgb)));
    ok('share reflects pixel fraction', Math.abs(r.colors[0].share - 500 / 950) < 0.01,
        `share=${r.colors[0].share.toFixed(3)}`);
    ok('total counts every opaque pixel', r.total === 950, `total=${r.total}`);
}

console.log('\n--- transparency ---');
{
    const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]);   // 2nd pixel transparent
    const h = buildHistogram(px);
    ok('fully transparent pixels are skipped', h.total === 1, `total=${h.total}`);
}

console.log('\n--- radius widens the neighbourhood ---');
{
    // A tight cluster of 5 near-identical reds (5 x 100 = 500 px total, but only
    // 100 px at any single colour) against one isolated blue with 400 px.
    // At radius 0 blue wins, having the highest count for one exact colour.
    // With a radius the cluster aggregates to 500 and overtakes it.
    const img = makeImage([
        [200, 10, 10, 100], [202, 10, 10, 100], [204, 12, 10, 100], [198, 8, 12, 100], [201, 11, 11, 100],
        [10, 10, 240, 400],
    ]);
    const strict = extractPalette(img, { count: 1, radius: 0 });
    ok('radius 0: isolated colour with the highest exact count wins',
        near(strict.colors[0].rgb, [10, 10, 240]), JSON.stringify(strict.colors[0].rgb));

    const loose = extractPalette(img, { count: 1, radius: 12 });
    ok('radius 12: the aggregated cluster wins',
        near(loose.colors[0].rgb, [201, 10, 11], 6), JSON.stringify(loose.colors[0].rgb));
    ok('cluster score aggregates its neighbours', loose.colors[0].score >= 300,
        `score=${loose.colors[0].score}`);
}

console.log('\n--- non-maximum suppression ---');
{
    // One dominant green blob spread over many adjacent colours, plus a small
    // distinct red and blue. Without suppression the top 3 would all be green.
    const spec = [];
    for (let d = 0; d < 12; d++) spec.push([20 + d, 200 + (d % 3), 30 + d, 200]);
    spec.push([240, 20, 20, 150]);
    spec.push([20, 20, 240, 120]);
    const img = makeImage(spec);

    const r = extractPalette(img, { count: 3, radius: 10 });
    const hasGreen = r.colors.some((c) => c.rgb[1] > 150 && c.rgb[0] < 100);
    const hasRed = r.colors.some((c) => c.rgb[0] > 150 && c.rgb[1] < 100);
    const hasBlue = r.colors.some((c) => c.rgb[2] > 150 && c.rgb[0] < 100);
    ok('picks three genuinely different colours, not three greens',
        hasGreen && hasRed && hasBlue, JSON.stringify(r.colors.map((c) => c.rgb)));

    // Every pair must respect the separation floor.
    let minDist = Infinity;
    for (let i = 0; i < r.colors.length; i++)
        for (let j = i + 1; j < r.colors.length; j++) {
            const a = r.colors[i].rgb, b = r.colors[j].rgb;
            minDist = Math.min(minDist, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
        }
    ok('all pairs respect the separation distance', minDist >= 20, `closest pair = ${minDist.toFixed(1)}`);

    // Demonstrate the failure mode is real: separation 0 collapses the palette.
    const hist = buildHistogram(img);
    const collapsed = pickPeaks(hist, scoreOccupied(hist, 10), { count: 3, minSeparation: 0 });
    let cMin = Infinity;
    for (let i = 0; i < collapsed.length; i++)
        for (let j = i + 1; j < collapsed.length; j++) {
            const a = collapsed[i].rgb, b = collapsed[j].rgb;
            cMin = Math.min(cMin, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
        }
    ok('without suppression the picks collapse together (failure mode confirmed)',
        cMin < 20, `closest pair without suppression = ${cMin.toFixed(1)}`);
}

console.log('\n--- degenerate inputs ---');
{
    ok('empty image returns nothing', extractPalette(new Uint8ClampedArray(0), { count: 5 }).colors.length === 0);
    const flat = makeImage([[128, 64, 32, 1000]]);
    const r = extractPalette(flat, { count: 8, radius: 6 });
    ok('single-colour image yields one colour, not eight', r.colors.length === 1, `got ${r.colors.length}`);
    ok('and it is the right one', near(r.colors[0].rgb, [128, 64, 32]), JSON.stringify(r.colors[0]?.rgb));
}

console.log('\n--- memory/time mode selection ---');
{
    ok('8 GB device takes the fast path', pickHistogramMode({ deviceMemoryGB: 8 }) === 'sums');
    ok('4 GB device takes the fast path (threshold is inclusive)',
        pickHistogramMode({ deviceMemoryGB: 4 }) === 'sums');
    ok('2 GB device takes the low-memory path', pickHistogramMode({ deviceMemoryGB: 2 }) === 'pass');
    ok('0.5 GB device takes the low-memory path', pickHistogramMode({ deviceMemoryGB: 0.5 }) === 'pass');
    ok('unknown memory on desktop assumes the fast path', pickHistogramMode({}) === 'sums');
    ok('unknown memory on mobile stays cautious',
        pickHistogramMode({ mobileHint: true }) === 'pass');
    ok('the extra cost is the ~48 MB we reasoned about',
        Math.abs(SUMS_EXTRA_BYTES / 1048576 - 48) < 1, `${(SUMS_EXTRA_BYTES / 1048576).toFixed(1)} MB`);

    // Both paths must agree exactly — the trade-off is memory vs time, never output.
    const img = makeImage([
        [200, 10, 10, 300], [201, 12, 11, 220], [10, 10, 240, 400], [12, 240, 30, 260],
        [250, 250, 250, 90], [5, 5, 5, 140],
    ]);
    for (const radius of [0, 6, 12]) {
        const a = extractPalette(img, { count: 4, radius, mode: 'sums' });
        const b = extractPalette(img, { count: 4, radius, mode: 'pass' });
        const same = JSON.stringify(a.colors.map((c) => c.rgb)) === JSON.stringify(b.colors.map((c) => c.rgb));
        ok(`both modes give identical colours (radius ${radius})`, same,
            `${JSON.stringify(a.colors.map((c) => c.rgb))} vs ${JSON.stringify(b.colors.map((c) => c.rgb))}`);
    }
    ok('fast mode reports its extra allocation',
        extractPalette(img, { count: 2, mode: 'sums' }).extraBytes === SUMS_EXTRA_BYTES);
    ok('low-memory mode allocates nothing extra',
        extractPalette(img, { count: 2, mode: 'pass' }).extraBytes === 0);
}

console.log('\n--- performance at realistic size ---');
{
    // 12.9 MP, the size of the sample image, with a plausible colour spread.
    const N = 4405 * 2937;
    const px = new Uint8ClampedArray(N * 4);
    for (let i = 0; i < px.length; i += 4) {
        const base = (i / 4) % 5;
        px[i] = (base * 47 + Math.random() * 24) & 255;
        px[i + 1] = (base * 91 + Math.random() * 24) & 255;
        px[i + 2] = (base * 143 + Math.random() * 24) & 255;
        px[i + 3] = 255;
    }
    for (const mode of ['sums', 'pass']) {
        for (const radius of [0, 10]) {
            const t = Date.now();
            const r = extractPalette(px, { count: 8, radius, mode });
            const ms = Date.now() - t;
            console.log(`  mode ${mode}  radius ${String(radius).padStart(2)}: ${String(ms).padStart(5)} ms  ` +
                `(+${(r.extraBytes / 1048576).toFixed(0)} MB, ${r.colors.length} colours)`);
            ok(`${mode}/radius ${radius} completes under 5s on 12.9 MP`, ms < 5000, `${ms} ms`);
        }
    }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
