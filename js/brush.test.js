// Node test for brush.js — run with: node js/brush.test.js
import { stampOffsets, createBrushLayer, applyDeltas, MAX_DELTA, SHAPES } from './brush.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? '\n        ' + detail : ''}`); }
};

const key = ([x, y]) => `${x},${y}`;
const at = (layer, bx, by, ch = 0) => layer.deltas[(by * layer.width + bx) * 3 + ch];

console.log('\n--- stamp shapes ---');
{
    for (const shape of SHAPES) {
        ok(`${shape}: size 1 is exactly one block`,
            stampOffsets(shape, 1).length === 1 && key(stampOffsets(shape, 1)[0]) === '0,0');
    }

    ok('square 3 covers 9 blocks', stampOffsets('square', 3).length === 9);
    ok('square 5 covers 25 blocks', stampOffsets('square', 5).length === 25);

    const c5 = stampOffsets('circle', 5);
    ok('circle 5 is smaller than square 5', c5.length < 25 && c5.length > 9, `${c5.length}`);
    ok('circle 5 excludes its corners', !c5.some(([x, y]) => Math.abs(x) === 2 && Math.abs(y) === 2));
    ok('circle 5 includes its cardinal tips',
        [[2, 0], [-2, 0], [0, 2], [0, -2]].every((p) => c5.some((q) => key(q) === key(p))));

    const h = stampOffsets('hline', 7), v = stampOffsets('vline', 7);
    ok('row 7 is 7 wide and 1 tall', h.length === 7 && h.every(([, y]) => y === 0));
    ok('column 7 is 1 wide and 7 tall', v.length === 7 && v.every(([x]) => x === 0));

    // Symmetry matters: an off-centre stamp would drift as the size changes.
    for (const shape of SHAPES) {
        const s = stampOffsets(shape, 9);
        const mirrored = s.every(([x, y]) => s.some((q) => key(q) === key([-x, -y])));
        ok(`${shape} 9 is symmetric about its centre`, mirrored);
    }
}

console.log('\n--- one pass per stroke, however slowly you drag ---');
{
    const layer = createBrushLayer(8, 8);
    layer.begin();
    layer.stamp(4, 4, 'square', 1, [3, 0, 0]);
    ok('first stamp applies the offset', at(layer, 4, 4) === 3);

    // The whole point: wobbling in place must not keep adding.
    for (let i = 0; i < 20; i++) layer.stamp(4, 4, 'square', 1, [3, 0, 0]);
    ok('twenty more stamps on the same block change nothing', at(layer, 4, 4) === 3);
    layer.end();

    // A new stroke is a new budget.
    layer.begin();
    layer.stamp(4, 4, 'square', 1, [3, 0, 0]);
    layer.end();
    ok('a second stroke does apply again', at(layer, 4, 4) === 6);
}

console.log('\n--- overlapping stamps within one stroke ---');
{
    const layer = createBrushLayer(8, 8);
    layer.begin();
    layer.stamp(4, 4, 'square', 3, [1, 0, 0]);
    layer.stamp(5, 4, 'square', 3, [1, 0, 0]);   // overlaps six of the nine
    layer.end();
    const values = new Set();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) values.add(at(layer, x, y));
    ok('no block is nudged twice by overlapping stamps', !values.has(2), [...values].join(','));
    ok('the union is covered once', at(layer, 3, 4) === 1 && at(layer, 6, 4) === 1 && at(layer, 5, 4) === 1);
}

console.log('\n--- clamping ---');
{
    const layer = createBrushLayer(4, 4);
    for (let i = 0; i < 40; i++) {
        layer.begin(); layer.stamp(1, 1, 'square', 1, [1, 0, 0]); layer.end();
    }
    ok(`offset clamps at +${MAX_DELTA}`, at(layer, 1, 1) === MAX_DELTA);

    for (let i = 0; i < 80; i++) {
        layer.begin(); layer.stamp(1, 1, 'square', 1, [-1, 0, 0]); layer.end();
    }
    ok(`offset clamps at -${MAX_DELTA}`, at(layer, 1, 1) === -MAX_DELTA);
}

console.log('\n--- edges are clipped, not wrapped ---');
{
    const layer = createBrushLayer(5, 5);
    layer.begin();
    layer.stamp(0, 0, 'square', 5, [4, 0, 0]);   // three quarters of it is off-grid
    layer.end();
    ok('the opposite corner is untouched', at(layer, 4, 4) === 0);
    ok('the near corner is touched', at(layer, 0, 0) === 4);
}

console.log('\n--- undo and redo ---');
{
    const layer = createBrushLayer(8, 8);
    ok('nothing to undo at the start', !layer.canUndo && !layer.canRedo);

    layer.begin(); layer.stamp(2, 2, 'square', 1, [5, 0, 0]); layer.end();
    layer.begin(); layer.stamp(2, 2, 'square', 1, [5, 0, 0]); layer.end();
    ok('two strokes accumulated', at(layer, 2, 2) === 10);

    layer.undo();
    ok('one undo steps back one stroke', at(layer, 2, 2) === 5);
    layer.undo();
    ok('two undos reach the start', at(layer, 2, 2) === 0);
    ok('nothing left to undo', !layer.canUndo);
    ok('undo on an empty stack is harmless', layer.undo() === false);

    layer.redo(); layer.redo();
    ok('redo restores both', at(layer, 2, 2) === 10);

    // A fresh stroke has to invalidate the redo branch, or redo would replay
    // history that no longer happened.
    layer.undo();
    layer.begin(); layer.stamp(3, 3, 'square', 1, [1, 0, 0]); layer.end();
    ok('a new stroke clears the redo stack', !layer.canRedo);
}

console.log('\n--- overlapping strokes undo exactly ---');
{
    const layer = createBrushLayer(8, 8);
    layer.begin(); layer.stamp(4, 4, 'square', 5, [2, 0, 0]); layer.end();
    layer.begin(); layer.stamp(5, 5, 'square', 3, [7, 0, 0]); layer.end();
    const overlapBefore = at(layer, 5, 5);
    ok('the overlap holds both', overlapBefore === 9);
    layer.undo();
    ok('undoing the second leaves the first intact', at(layer, 5, 5) === 2 && at(layer, 3, 3) === 2);
}

console.log('\n--- a stroke that changes nothing is not history ---');
{
    const layer = createBrushLayer(4, 4);
    layer.begin(); layer.stamp(1, 1, 'square', 1, [0, 0, 0]); layer.end();
    ok('a zero-offset stroke adds no undo step', !layer.canUndo);

    for (let i = 0; i < 20; i++) { layer.begin(); layer.stamp(1, 1, 'square', 1, [1, 0, 0]); layer.end(); }
    const depth = layer.canUndo;
    layer.begin(); layer.stamp(1, 1, 'square', 1, [1, 0, 0]); layer.end();   // already clamped
    ok('a stroke that only hits the clamp adds no step', depth && at(layer, 1, 1) === MAX_DELTA);
}

console.log('\n--- resize drops the layer rather than stretching it ---');
{
    const layer = createBrushLayer(8, 8);
    layer.begin(); layer.stamp(4, 4, 'square', 3, [6, 0, 0]); layer.end();
    ok('resizing to the same grid is a no-op', layer.resize(8, 8) === false && at(layer, 4, 4) === 6);
    ok('resizing to a new grid reports the change', layer.resize(16, 9) === true);
    ok('offsets are gone', layer.deltas.every((v) => v === 0));
    ok('history is gone with them', !layer.canUndo && !layer.canRedo);
    ok('the grid is the new one', layer.width === 16 && layer.height === 9);
}

console.log('\n--- clear ---');
{
    const layer = createBrushLayer(4, 4);
    layer.begin(); layer.stamp(1, 1, 'square', 1, [5, 0, 0]); layer.end();
    ok('clear reports that it did something', layer.clear() === true);
    ok('everything is zero', layer.deltas.every((v) => v === 0));
    ok('clear is itself undoable', layer.canUndo && (layer.undo(), at(layer, 1, 1) === 5));
    layer.clear();
    ok('clearing an already-clear layer does nothing', layer.clear() === false);
}

console.log('\n--- applyDeltas ---');
{
    const rgb = Float32Array.from([10, 20, 30, 250, 5, 128]);
    const d = Int16Array.from([5, -5, 0, 16, -16, 0]);
    applyDeltas(rgb, d);
    ok('offsets are added', rgb[0] === 15 && rgb[1] === 15 && rgb[2] === 30);
    ok('the top clamps to 255', rgb[3] === 255);
    ok('the bottom clamps to 0', rgb[4] === 0);
    ok('zero leaves the value alone', rgb[5] === 128);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
