// Node test for blocksize.js — run with: node js/blocksize.test.js
//
// Only blockRange() is covered: the rest of the module is pointer handling and
// needs a DOM. The range is the part with arithmetic worth pinning down.

import { blockRange, MIN_SHORT_SIDE, MAX_LONG_SIDE, MAX_SHORT_SIDE } from './blocksize.js';
import { blockHeight } from './core.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n        ' + detail : ''}`); }
};
const show = (r) => `w ${r.wMin}..${r.wMax}, h ${r.hMin}..${r.hMax}`;

console.log('\n--- the cases worked by hand ---');
{
    const hd = blockRange(1920, 1080);
    ok('16:9 gives width 57..1920', hd.wMin === 57 && hd.wMax === 1920, show(hd));
    ok('16:9 gives height 32..1080', hd.hMin === 32 && hd.hMax === 1080, show(hd));

    // Both ceilings bind at once only for 16:9. At 4:3 the short side hits
    // 1080 first, which pulls the long side below 1920.
    const four3 = blockRange(4000, 3000);
    ok('4:3 caps at 1440x1080, not 1920x1440', four3.wMax === 1440 && four3.hMax === 1080, show(four3));

    // The user's example: at 10:1 the long side hits 1920 first and the short
    // side simply follows it down to 192.
    const wide = blockRange(4000, 400);
    ok('10:1 caps at 1920x192', wide.wMax === 1920 && wide.hMax === 192, show(wide));

    // Never more blocks than the source has pixels.
    const small = blockRange(640, 480);
    ok('640x480 caps at its own size', small.wMax === 640 && small.hMax === 480, show(small));

    const tinyLong = blockRange(1000, 3000);
    ok('portrait 1:3 caps at 640x1920', tinyLong.wMax === 640 && tinyLong.hMax === 1920, show(tinyLong));
}

console.log('\n--- the short side is the one pinned to 32 ---');
{
    for (const [w, h, label] of [
        [1920, 1080, 'landscape'], [1080, 1920, 'portrait'], [800, 800, 'square'],
        [4000, 3000, '4:3'], [1000, 2500, 'tall'], [4000, 400, '10:1'],
    ]) {
        const r = blockRange(w, h);
        const shortMin = w <= h ? r.wMin : r.hMin;
        ok(`${label}: short side starts at 32`, shortMin === MIN_SHORT_SIDE, show(r));
    }
}

console.log('\n--- the two sliders describe the same grid ---');
{
    // The range is defined on the long side, so that is the direction that must
    // pair exactly: driving it to an end has to land its partner on the
    // partner's own end. (The reverse is looser by nature — the short side has
    // fewer steps, so several of its values map to the same long one, and the
    // aspect lock clamps rather than overshoots.)
    for (const [w, h] of [
        [1920, 1080], [1080, 1920], [800, 800], [4000, 3000], [640, 480],
        [4000, 400], [1000, 3000], [3000, 1001], [2560, 1440],
    ]) {
        const r = blockRange(w, h);
        const landscape = w >= h;
        // blockHeight drives height from width; for a portrait source the long
        // side is the height, so ask the equivalent question the other way.
        const pairAtMin = landscape
            ? blockHeight(r.wMin, w, h)
            : Math.max(1, Math.round((r.hMin * w) / h));
        const pairAtMax = landscape
            ? blockHeight(r.wMax, w, h)
            : Math.max(1, Math.round((r.hMax * w) / h));
        const wantMin = landscape ? r.hMin : r.wMin;
        const wantMax = landscape ? r.hMax : r.wMax;

        ok(`${w}x${h}: long side at min pairs with short at min`, pairAtMin === wantMin,
            `got ${pairAtMin}, expected ${wantMin}`);
        ok(`${w}x${h}: long side at max pairs with short at max`, pairAtMax === wantMax,
            `got ${pairAtMax}, expected ${wantMax}`);
    }
}

console.log('\n--- every limit holds, across the whole space ---');
{
    let belowFloor = 0, overLong = 0, overShort = 0, overSource = 0, inverted = 0, mismatched = 0;
    for (let w = 60; w <= 5000; w += 71) {
        for (let h = 60; h <= 5000; h += 97) {
            const r = blockRange(w, h);
            const short = Math.min(w, h), long = Math.max(w, h);
            const shortMin = Math.min(r.wMin, r.hMin);
            const longMax = Math.max(r.wMax, r.hMax);
            const shortMax = Math.min(r.wMax, r.hMax);

            // The floor is only promised where the ceilings leave room for it:
            // past ~60:1 32 blocks on the short side needs more than 1920 on the
            // long one, and the ceiling wins by design.
            const floorReachable = Math.ceil((MIN_SHORT_SIDE * long) / short) <= Math.min(MAX_LONG_SIDE, long);
            if (floorReachable && shortMin < MIN_SHORT_SIDE) belowFloor++;

            if (longMax > MAX_LONG_SIDE) overLong++;
            if (shortMax > MAX_SHORT_SIDE) overShort++;
            if (r.wMax > w || r.hMax > h) overSource++;
            if (r.wMin > r.wMax || r.hMin > r.hMax) inverted++;

            const pairedMax = w >= h
                ? blockHeight(r.wMax, w, h)
                : Math.max(1, Math.round((r.hMax * w) / h));
            if (pairedMax !== (w >= h ? r.hMax : r.wMax)) mismatched++;
        }
    }
    ok('short side never starts below 32 where the ceilings allow it', belowFloor === 0, `${belowFloor} cases`);
    ok('long side never exceeds 1920', overLong === 0, `${overLong} cases`);
    ok('short side never exceeds 1080', overShort === 0, `${overShort} cases`);
    ok('neither side exceeds the source', overSource === 0, `${overSource} cases`);
    ok('no range is inverted', inverted === 0, `${inverted} cases`);
    ok('the paired maxima always agree with blockHeight', mismatched === 0, `${mismatched} cases`);
}

console.log('\n--- degenerate inputs ---');
{
    const none = blockRange(0, 0);
    ok('no source falls back to a plain range',
        none.wMin === 32 && none.wMax === 1920 && none.hMin === 32 && none.hMax === 1080, show(none));

    // Smaller than the floor: 32 blocks on the 30px side is impossible, so the
    // floor moves to the long side and the range stays usable.
    const tiny = blockRange(40, 30);
    ok('a source under the floor keeps a usable range',
        tiny.wMin === 32 && tiny.wMax === 40 && tiny.hMax === 30, show(tiny));

    // Smaller than the floor on both sides: only one grid is possible.
    const minute = blockRange(20, 15);
    ok('a source under the floor on both sides collapses to its own size',
        minute.wMin === 20 && minute.wMax === 20 && minute.hMax === 15, show(minute));

    const strip = blockRange(6000, 50);
    ok('extreme aspect keeps min <= max', strip.wMin <= strip.wMax && strip.hMin <= strip.hMax, show(strip));
    ok('extreme aspect still honours the source', strip.hMax <= 50, show(strip));
    ok('extreme aspect keeps a usable range', strip.wMax > strip.wMin, show(strip));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
