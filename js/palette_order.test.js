// Node test for palette_order.js — run with: node js/palette_order.test.js
import { proximityOrder, sortedByProximity } from './palette_order.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n        ' + detail : ''}`); }
};

const toRgb = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
/** Total distance walked along a strip — lower means neighbours look more alike. */
const pathLength = (hexes) => {
    let total = 0;
    for (let i = 0; i < hexes.length - 1; i++) total += dist(toRgb(hexes[i]), toRgb(hexes[i+1]));
    return total;
};

console.log('\n--- it is a permutation, never a filter ---');
{
    for (const set of [
        [],
        ['#FF0000'],
        ['#FF0000', '#00FF00'],
        ['#123456', '#654321', '#ABCDEF', '#FEDCBA', '#000000', '#FFFFFF'],
    ]) {
        const order = proximityOrder(set);
        ok(`${set.length} colours: every index appears exactly once`,
            order.length === set.length
            && new Set(order).size === set.length
            && order.every((i) => i >= 0 && i < set.length));
    }
    // Duplicates must survive rather than being collapsed.
    const dupes = ['#FF0000', '#FF0000', '#00FF00'];
    ok('duplicate colours are kept', proximityOrder(dupes).length === 3);
}

console.log('\n--- it starts at the reddest colour ---');
{
    const set = ['#0000FF', '#00FF00', '#FF0000', '#FFFFFF'];
    ok('pure red leads', sortedByProximity(set)[0] === '#FF0000');

    // Nearest to red, not "largest red channel" — white has a full red channel.
    const noPureRed = ['#FFFFFF', '#CC2222', '#2222CC'];
    ok('a red-ish colour beats white', sortedByProximity(noPureRed)[0] === '#CC2222',
        sortedByProximity(noPureRed).join(' '));
}

console.log('\n--- similar colours end up adjacent ---');
{
    // Three tight clusters, interleaved so insertion order is deliberately bad.
    const scrambled = [
        '#FF0000', '#00FF00', '#0000FF',
        '#FF1111', '#11FF11', '#1111FF',
        '#FF2222', '#22FF22', '#2222FF',
    ];
    const ordered = sortedByProximity(scrambled);
    ok('the walk is shorter than insertion order',
        pathLength(ordered) < pathLength(scrambled),
        `${pathLength(ordered).toFixed(0)} vs ${pathLength(scrambled).toFixed(0)}`);

    // Each cluster should come out contiguous.
    const clusterOf = (h) => {
        const [r, g, b] = toRgb(h);
        return r > 200 ? 'r' : g > 200 ? 'g' : 'b';
    };
    const runs = ordered.map(clusterOf).join('').replace(/(.)\1*/g, '$1');
    ok('each colour family forms one unbroken run', runs.length === 3,
        `families appear as: ${runs}`);
}

console.log('\n--- it is deterministic ---');
{
    const set = ['#382674', '#091521', '#291B4A', '#553379', '#452159', '#0D1541'];
    const a = sortedByProximity(set).join(',');
    const b = sortedByProximity(set).join(',');
    ok('same input, same output', a === b);
    ok('input array is not mutated',
        set[0] === '#382674' && set.length === 6);
}

console.log('\n--- against the real palettes ---');
{
    // Every shipped palette should read better sorted than as authored.
    const palettes = {
        'Blue Haze': ['#382674','#091521','#291B4A','#553379','#452159','#0D1541',
                      '#663C8F','#FB8AD9','#A65191','#6558B9','#03C1B1','#7649A7'],
        'PICO-8': ['#000000','#1D2B53','#7E2553','#008751','#AB5236','#5F574F',
                   '#C2C3C7','#FFF1E8','#FF004D','#FFA300','#FFEC27','#00E436'],
    };
    for (const [name, cols] of Object.entries(palettes)) {
        const before = pathLength(cols);
        const after = pathLength(sortedByProximity(cols));
        ok(`${name}: sorted strip is tighter`, after < before,
            `${after.toFixed(0)} vs ${before.toFixed(0)}`);
    }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
