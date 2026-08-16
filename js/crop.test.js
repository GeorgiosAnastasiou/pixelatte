// Node test for crop.js — run with: node js/crop.test.js
import {
    parseRatio, formatRatio, ratioOf, largestRect, clampInside, toRatio,
    hitTest, dragHandle, moveRect, outputSize, MIN_CROP,
} from './crop.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n        ' + detail : ''}`); }
};
const near = (a, b, tol = 1.01) => Math.abs(a - b) <= tol;
const inside = (r, w, h) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;

// A phone photo, which is the case the whole feature exists for.
const SW = 4032, SH = 3024;

console.log('\n--- reading a ratio the way people write one ---');
{
    ok('16:9', near(parseRatio('16:9'), 16 / 9, 1e-9));
    ok('16/9', near(parseRatio('16/9'), 16 / 9, 1e-9));
    ok('4 x 3', near(parseRatio('4 x 3'), 4 / 3, 1e-9));
    ok('1:1', parseRatio('1:1') === 1);
    ok('a bare decimal', near(parseRatio('1.5'), 1.5, 1e-9));
    ok('whitespace is fine', near(parseRatio('  3 : 2 '), 1.5, 1e-9));
    for (const bad of ['', 'abc', '16:0', '0:9', '-2', '16:', ':9', null, undefined]) {
        ok(`rejects ${JSON.stringify(bad)}`, parseRatio(bad) === null);
    }
    ok('formats a known ratio', formatRatio(16 / 9) === '16:9');
    ok('formats square', formatRatio(1) === '1:1');
    ok('formats portrait', formatRatio(9 / 16) === '9:16');
    ok('falls back to decimals', formatRatio(1.234) === '1.23');
}

console.log('\n--- the largest rectangle of a ratio ---');
{
    const sq = largestRect(1, SW, SH);
    ok('1:1 on a 4:3 photo is limited by height', sq.w === 3024 && sq.h === 3024, JSON.stringify(sq));
    ok('and is centred', sq.x === 504 && sq.y === 0, JSON.stringify(sq));
    ok('it fits', inside(sq, SW, SH));

    const wide = largestRect(16 / 9, SW, SH);
    ok('16:9 is limited by width', wide.w === 4032 && near(wide.h, 2268), JSON.stringify(wide));
    ok('16:9 fits', inside(wide, SW, SH));

    const tall = largestRect(9 / 16, SW, SH);
    ok('9:16 is limited by height', tall.h === 3024 && near(tall.w, 1701), JSON.stringify(tall));
}

console.log('\n--- clamping keeps the size and moves the origin ---');
{
    const r = clampInside({ x: -50, y: -80, w: 1000, h: 800 }, SW, SH);
    ok('pushed back to the top-left corner', r.x === 0 && r.y === 0 && r.w === 1000 && r.h === 800);

    const r2 = clampInside({ x: 4000, y: 3000, w: 1000, h: 800 }, SW, SH);
    ok('pushed back from the bottom-right', r2.x === SW - 1000 && r2.y === SH - 800);

    const r3 = clampInside({ x: 0, y: 0, w: 99999, h: 99999 }, SW, SH);
    ok('a rectangle larger than the source is shrunk to it', r3.w === SW && r3.h === SH);
}

console.log('\n--- reshaping to a ratio keeps the centre ---');
{
    const start = { x: 1000, y: 1000, w: 800, h: 600 };
    const cx = start.x + start.w / 2, cy = start.y + start.h / 2;
    const sq = toRatio(start, 1, SW, SH);
    ok('becomes square', near(ratioOf(sq), 1, 0.01), JSON.stringify(sq));
    ok('centre held', near(sq.x + sq.w / 2, cx, 1) && near(sq.y + sq.h / 2, cy, 1));
    ok('it shrank rather than grew', sq.w <= start.w && sq.h <= start.h);
    ok('it fits', inside(sq, SW, SH));

    // A ratio the source itself cannot hold has to be capped by the image.
    const extreme = toRatio({ x: 0, y: 0, w: SW, h: SH }, 5, SW, SH);
    ok('5:1 is capped by the source width', extreme.w <= SW && near(ratioOf(extreme), 5, 0.02));
    ok('5:1 fits', inside(extreme, SW, SH));
}

console.log('\n--- hit testing: corners beat edges ---');
{
    const r = { x: 100, y: 100, w: 400, h: 300 };
    const tol = 12;
    ok('nw corner', hitTest(r, 100, 100, tol) === 'nw');
    ok('ne corner', hitTest(r, 500, 100, tol) === 'ne');
    ok('sw corner', hitTest(r, 100, 400, tol) === 'sw');
    ok('se corner', hitTest(r, 500, 400, tol) === 'se');
    ok('n edge centre', hitTest(r, 300, 100, tol) === 'n');
    ok('s edge centre', hitTest(r, 300, 400, tol) === 's');
    ok('w edge centre', hitTest(r, 100, 250, tol) === 'w');
    ok('e edge centre', hitTest(r, 500, 250, tol) === 'e');
    ok('the middle moves the whole thing', hitTest(r, 300, 250, tol) === 'move');
    ok('well outside is nothing', hitTest(r, 900, 900, tol) === null);

    // A tiny rectangle: every handle is within tolerance of every other, and a
    // corner is what someone aiming at a corner should get.
    const tiny = { x: 100, y: 100, w: 20, h: 20 };
    ok('corner wins on a tiny rectangle', hitTest(tiny, 100, 100, tol) === 'nw');
}

console.log('\n--- free dragging ---');
{
    const r = { x: 1000, y: 1000, w: 800, h: 600 };
    const o = { ratio: null, srcW: SW, srcH: SH };

    const se = dragHandle(r, 'se', 2000, 1800, o);
    ok('se corner follows the pointer', se.x === 1000 && se.y === 1000 && se.w === 1000 && se.h === 800,
        JSON.stringify(se));

    const nw = dragHandle(r, 'nw', 500, 400, o);
    ok('nw corner moves the origin', nw.x === 500 && nw.y === 400 && nw.w === 1300 && nw.h === 1200,
        JSON.stringify(nw));

    const e = dragHandle(r, 'e', 2500, 9999, o);
    ok('an edge only moves its own axis', e.y === 1000 && e.h === 600 && e.w === 1500,
        JSON.stringify(e));

    const past = dragHandle(r, 'e', 99999, 0, o);
    ok('cannot be dragged past the image', past.x + past.w <= SW, JSON.stringify(past));

    const collapsed = dragHandle(r, 'e', 0, 0, o);
    ok('cannot be collapsed below the minimum', collapsed.w >= MIN_CROP, JSON.stringify(collapsed));
}

console.log('\n--- ratio-locked dragging ---');
{
    const r = { x: 1000, y: 1000, w: 800, h: 800 };
    const o = { ratio: 1, srcW: SW, srcH: SH };

    for (const [handle, x, y] of [
        ['se', 2200, 1500], ['nw', 400, 900], ['ne', 2400, 300], ['sw', 200, 2600],
        ['n', 0, 200], ['s', 0, 2900], ['e', 3000, 0], ['w', 200, 0],
    ]) {
        const next = dragHandle(r, handle, x, y, o);
        ok(`${handle}: stays square`, near(ratioOf(next), 1, 0.02),
            `${JSON.stringify(next)} ratio ${ratioOf(next).toFixed(3)}`);
        ok(`${handle}: stays inside`, inside(next, SW, SH), JSON.stringify(next));
    }
}

console.log('\n--- the case from the brief: drag a locked square to the maximum ---');
{
    // 1:1 locked on a 4032x3024 photo. Drag the corner far past the edge; the
    // selection should grow to the largest square that fits and stop.
    const r = { x: 1500, y: 1000, w: 200, h: 200 };
    const next = dragHandle(r, 'se', 99999, 99999, { ratio: 1, srcW: SW, srcH: SH });
    ok('still square', near(ratioOf(next), 1, 0.02), JSON.stringify(next));
    ok('inside the image', inside(next, SW, SH), JSON.stringify(next));
    ok('no taller than the short side', next.h <= SH, JSON.stringify(next));

    // And the output size is what decides the final pixels, whatever was selected.
    const out = outputSize(next, { w: 1024, h: 1024 });
    ok('output snaps to the typed size', out.w === 1024 && out.h === 1024 && out.resampled);
}

console.log('\n--- an edge drag holds the ratio about the centre ---');
{
    const r = { x: 1000, y: 1000, w: 900, h: 600 };
    const before = { cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
    const next = dragHandle(r, 'e', 2500, 0, { ratio: 1.5, srcW: SW, srcH: SH });
    ok('ratio held', near(ratioOf(next), 1.5, 0.02), JSON.stringify(next));
    ok('the perpendicular axis stayed centred',
        near(next.y + next.h / 2, before.cy, 1.5), JSON.stringify(next));
}

console.log('\n--- moving ---');
{
    const r = { x: 1000, y: 1000, w: 800, h: 600 };
    const m = moveRect(r, 200, -300, SW, SH);
    ok('moves by the delta', m.x === 1200 && m.y === 700 && m.w === 800 && m.h === 600);

    const stuck = moveRect(r, -99999, -99999, SW, SH);
    ok('stops at the corner without resizing',
        stuck.x === 0 && stuck.y === 0 && stuck.w === 800 && stuck.h === 600);

    const stuck2 = moveRect(r, 99999, 99999, SW, SH);
    ok('stops at the far corner', stuck2.x === SW - 800 && stuck2.y === SH - 600);
}

console.log('\n--- output size ---');
{
    const r = { x: 0, y: 0, w: 3024, h: 3024 };
    const asIs = outputSize(r, null);
    ok('no output size keeps the selection', asIs.w === 3024 && !asIs.resampled);
    ok('half a size is not a size', outputSize(r, { w: 1024, h: NaN }).resampled === false);
    ok('zero is not a size', outputSize(r, { w: 0, h: 0 }).resampled === false);
    ok('a real size resamples', outputSize(r, { w: 512, h: 512 }).resampled === true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
