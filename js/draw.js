// draw.js — placing a colour on specific blocks.
//
// The opposite of the brush, deliberately. The brush nudges a block's value and
// lets the palette matcher decide what that becomes; drawing says what a block
// *is* and takes the matcher out of the loop for those blocks. One is for
// persuading an image, the other for correcting it.
//
// Colours are stored as literal RGB rather than as an index into the palette.
// An index would be a reference to something the user can reorder, remove or
// replace, and a stroke would then silently change colour — or point at nothing
// — the next time the palette was edited. What you drew stays what you drew.

import { stampOffsets } from './brush.js';

/** 0 means "not drawn". The flag bit keeps pure black distinguishable from it. */
const SET = 0x1000000;

export const packRgb = (r, g, b) => SET | (r << 16) | (g << 8) | b;
export const unpackRgb = (v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];

export function hexToPacked(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return 0;
    return packRgb(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16));
}

/**
 * A grid of drawn colours, with undo.
 *
 * Same history model as the brush layer: a stroke records the values it
 * replaced, so undoing overlapping strokes in any order restores exactly what
 * was there. Unlike the brush there is no per-stroke mask, because drawing is
 * idempotent by nature — setting a block to the same colour twice is setting it
 * to that colour.
 */
export function createDrawLayer(bw, bh) {
    let w = bw, h = bh;
    let cells = new Int32Array(w * h);

    const undoStack = [];
    const redoStack = [];
    let stroke = null;

    const inside = (bx, by) => bx >= 0 && by >= 0 && bx < w && by < h;

    return {
        get width() { return w; },
        get height() { return h; },
        get cells() { return cells; },
        get canUndo() { return undoStack.length > 0; },
        get canRedo() { return redoStack.length > 0; },
        get hasEdits() { return cells.some((v) => v !== 0); },

        /** Dropped rather than resampled, for the same reason as the brush. */
        resize(nw, nh) {
            if (nw === w && nh === h) return false;
            w = nw; h = nh;
            cells = new Int32Array(w * h);
            undoStack.length = 0;
            redoStack.length = 0;
            stroke = null;
            return true;
        },

        clear() {
            if (!this.hasEdits) return false;
            const before = new Map();
            for (let i = 0; i < cells.length; i++) if (cells[i]) before.set(i, cells[i]);
            undoStack.push(before);
            redoStack.length = 0;
            cells.fill(0);
            return true;
        },

        begin() { stroke = new Map(); },

        /**
         * Paint one stamp. `packed` of 0 erases, which is how the eraser works:
         * the block goes back to whatever the palette matcher says it should be.
         */
        stamp(bx, by, shape, size, packed) {
            if (!stroke) this.begin();
            let changed = false;
            for (const [dx, dy] of stampOffsets(shape, size)) {
                const x = bx + dx, y = by + dy;
                if (!inside(x, y)) continue;
                const idx = y * w + x;
                if (cells[idx] === packed) continue;
                if (!stroke.has(idx)) stroke.set(idx, cells[idx]);
                cells[idx] = packed;
                changed = true;
            }
            return changed;
        },

        end() {
            if (!stroke) return false;
            const before = stroke;
            stroke = null;
            if (before.size === 0) return false;
            undoStack.push(before);
            redoStack.length = 0;
            return true;
        },

        undo() { return step(undoStack, redoStack); },
        redo() { return step(redoStack, undoStack); },
    };

    function step(from, to) {
        const entry = from.pop();
        if (!entry) return false;
        const inverse = new Map();
        for (const [idx, prev] of entry) {
            inverse.set(idx, cells[idx]);
            cells[idx] = prev;
        }
        to.push(inverse);
        return true;
    }
}

/**
 * Overwrite mapped block colours wherever something has been drawn.
 *
 * Runs after palette matching, which is the whole point: these blocks are not
 * up for matching.
 *
 * @param {Uint8ClampedArray} mapped block RGB triplets, modified in place
 * @param {Int32Array} cells the draw layer
 */
export function applyDrawn(mapped, cells) {
    for (let i = 0, j = 0; i < cells.length; i++, j += 3) {
        const v = cells[i];
        if (!v) continue;
        mapped[j] = (v >> 16) & 255;
        mapped[j + 1] = (v >> 8) & 255;
        mapped[j + 2] = v & 255;
    }
    return mapped;
}
