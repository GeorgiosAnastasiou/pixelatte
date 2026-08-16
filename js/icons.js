// icons.js — the icon language.
//
// Every adjustable parameter gets a mark. All are drawn on a 16x16 grid with
// whole-unit shapes and no curves except where a curve *is* the meaning, so they
// read as pixel art rather than generic line icons. Colour comes from
// currentColor except where the colour carries information (RGB, palette).

const svg = (body, title) =>
    `<svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true" focusable="false"
      shape-rendering="crispEdges"><title>${title}</title>${body}</svg>`;

/** R, G and B as three blocks in a triangle — the mark for colour offsets. */
export const rgb = svg(`
    <rect x="6" y="1" width="5" height="5" fill="#ef4444"/>
    <rect x="1" y="9" width="5" height="5" fill="#22c55e"/>
    <rect x="10" y="9" width="5" height="5" fill="#3b82f6"/>
`, 'RGB offsets');

/** Two frames, one behind the other — frame rate. */
export const fps = svg(`
    <rect x="1" y="2" width="10" height="9" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <rect x="5" y="5" width="10" height="9" fill="var(--panel)" stroke="currentColor" stroke-width="1.5"/>
    <rect x="7" y="8" width="2" height="2" fill="currentColor"/>
    <rect x="11" y="8" width="2" height="2" fill="currentColor"/>
`, 'Frame rate');

/** A coarse grid over a finer one — block size. */
export const blocks = svg(`
    <rect x="1" y="1" width="6" height="6" fill="currentColor"/>
    <rect x="9" y="1" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <rect x="1" y="9" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <rect x="9" y="9" width="3" height="3" fill="currentColor"/>
    <rect x="12" y="12" width="3" height="3" fill="currentColor"/>
`, 'Block size');

/** A trail of fading copies — temporal smoothing. */
export const smoothing = svg(`
    <rect x="1" y="5" width="5" height="6" fill="currentColor" opacity="0.25"/>
    <rect x="5" y="5" width="5" height="6" fill="currentColor" opacity="0.55"/>
    <rect x="9" y="5" width="5" height="6" fill="currentColor"/>
`, 'Smoothing');

/** A strip of swatches — palette. */
export const palette = svg(`
    <rect x="1" y="3" width="3" height="10" fill="#ef4444"/>
    <rect x="4" y="3" width="3" height="10" fill="#eab308"/>
    <rect x="7" y="3" width="3" height="10" fill="#22c55e"/>
    <rect x="10" y="3" width="3" height="10" fill="#3b82f6"/>
    <rect x="13" y="3" width="2" height="10" fill="#a855f7"/>
`, 'Palette');

/** Mountain and sun, blocky — a still image. */
export const image = svg(`
    <rect x="1" y="2" width="14" height="12" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <rect x="10" y="4" width="2" height="2" fill="currentColor"/>
    <path d="M3 12 L6 8 L8 10 L11 6 L14 12 Z" fill="currentColor"/>
`, 'Image');

/** Film strip — a video. */
export const film = svg(`
    <rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <rect x="4" y="4" width="2" height="2" fill="currentColor"/>
    <rect x="4" y="10" width="2" height="2" fill="currentColor"/>
    <rect x="10" y="4" width="2" height="2" fill="currentColor"/>
    <rect x="10" y="10" width="2" height="2" fill="currentColor"/>
    <rect x="7" y="6" width="2" height="4" fill="currentColor"/>
`, 'Video');

/** Concentric rings — the matching radius in the colour cube. */
export const radius = svg(`
    <rect x="7" y="7" width="2" height="2" fill="currentColor"/>
    <rect x="4" y="4" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.7"/>
    <rect x="1" y="1" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>
`, 'Matching radius');

/** Two blocks pushed apart — minimum separation between colours. */
export const separation = svg(`
    <rect x="1" y="5" width="4" height="6" fill="currentColor"/>
    <rect x="11" y="5" width="4" height="6" fill="currentColor"/>
    <rect x="6" y="7" width="4" height="2" fill="currentColor" opacity="0.4"/>
`, 'Minimum separation');

/** A stack of swatches — how many colours to produce. */
export const count = svg(`
    <rect x="2" y="2" width="12" height="3" fill="currentColor"/>
    <rect x="2" y="6.5" width="12" height="3" fill="currentColor" opacity="0.65"/>
    <rect x="2" y="11" width="12" height="3" fill="currentColor" opacity="0.35"/>
`, 'Number of colours');

/** Play triangle — run the job. */
export const run = svg(`<path d="M3 2 L14 8 L3 14 Z" fill="currentColor"/>`, 'Run');

/** Arrow into a tray — save. */
export const save = svg(`
    <rect x="7" y="1" width="2" height="7" fill="currentColor"/>
    <path d="M4 7 L8 12 L12 7 Z" fill="currentColor"/>
    <rect x="1" y="13" width="14" height="2" fill="currentColor"/>
`, 'Save');

/** Sliders — quality and encoder options. */
export const tune = svg(`
    <rect x="1" y="3" width="14" height="1.5" fill="currentColor"/>
    <rect x="4" y="1" width="2.5" height="5.5" fill="currentColor"/>
    <rect x="1" y="11" width="14" height="1.5" fill="currentColor"/>
    <rect x="9" y="9" width="2.5" height="5.5" fill="currentColor"/>
`, 'Options');

/** Boxes moving between devices — backup and transfer. */
export const transfer = svg(`
    <rect x="1" y="2" width="6" height="5" fill="currentColor"/>
    <rect x="9" y="9" width="6" height="5" fill="currentColor"/>
    <path d="M8 3 L14 3 L14 6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <path d="M8 13 L2 13 L2 10" fill="none" stroke="currentColor" stroke-width="1.5"/>
`, 'Backup and transfer');

/** Plus in a block — add. */
export const add = svg(`
    <rect x="7" y="2" width="2" height="12" fill="currentColor"/>
    <rect x="2" y="7" width="12" height="2" fill="currentColor"/>
`, 'Add');

/** Head and shoulders, squared off — account. */
export const account = svg(`
    <rect x="5" y="2" width="6" height="6" fill="currentColor"/>
    <path d="M2 15 L2 12 L5 10 L11 10 L14 12 L14 15 Z" fill="currentColor"/>
`, 'Account');

/** A nib over a ruled line — rename. */
export const rename = svg(`
    <path d="M3 11 L10 4 L12 6 L5 13 L2 14 Z" fill="currentColor"/>
    <rect x="1" y="15" width="14" height="1" fill="currentColor" opacity="0.5"/>
`, 'Rename');

/** Lidded bin with slots — delete. */
export const trash = svg(`
    <rect x="2" y="2" width="12" height="2" fill="currentColor"/>
    <rect x="6" y="0" width="4" height="2" fill="currentColor"/>
    <rect x="3" y="5" width="10" height="11" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <rect x="6" y="7" width="1.5" height="6" fill="currentColor"/>
    <rect x="9" y="7" width="1.5" height="6" fill="currentColor"/>
`, 'Delete');

/** A hash — a written list of colour codes. */
export const hash = svg(`
    <rect x="4" y="1" width="2" height="14" fill="currentColor"/>
    <rect x="10" y="1" width="2" height="14" fill="currentColor"/>
    <rect x="1" y="4" width="14" height="2" fill="currentColor"/>
    <rect x="1" y="10" width="14" height="2" fill="currentColor"/>
`, 'Colour codes');

/** Minus in a block — remove. The inverse of `add`, deliberately. */
export const remove = svg(`
    <rect x="2" y="7" width="12" height="2" fill="currentColor"/>
`, 'Remove');

/** A block radiating brackets — live, continuously updating. */
export const live = svg(`
    <rect x="6" y="6" width="4" height="4" fill="currentColor"/>
    <path d="M4 3 A7 7 0 0 0 4 13" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <path d="M12 3 A7 7 0 0 1 12 13" fill="none" stroke="currentColor" stroke-width="1.5"/>
`, 'Live preview');

/** Eyedropper-ish block with a nib — pick a colour. */
export const pick = svg(`
    <rect x="9" y="1" width="5" height="4" fill="currentColor"/>
    <path d="M2 14 L3 10 L10 3 L12 5 L5 12 Z" fill="currentColor" opacity="0.75"/>
`, 'Colour picker');

/** Sun and moon halves — appearance. */
export const theme = svg(`
    <rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <path d="M8 2 L14 2 L14 14 L8 14 Z" fill="currentColor"/>
`, 'Appearance');

/** Gear-ish block ring — settings. */
export const settings = svg(`
    <rect x="6" y="1" width="4" height="3" fill="currentColor"/>
    <rect x="6" y="12" width="4" height="3" fill="currentColor"/>
    <rect x="1" y="6" width="3" height="4" fill="currentColor"/>
    <rect x="12" y="6" width="3" height="4" fill="currentColor"/>
    <rect x="5" y="5" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
`, 'Settings');

/** A funnel of blocks — extraction. */
export const extract = svg(`
    <rect x="1" y="1" width="14" height="3" fill="currentColor" opacity="0.35"/>
    <rect x="3" y="6" width="10" height="3" fill="currentColor" opacity="0.65"/>
    <rect x="6" y="11" width="4" height="3" fill="currentColor"/>
`, 'Extract');

export const ICONS = {
    rgb, fps, blocks, smoothing, palette, image, film, radius, separation,
    count, run, save, tune, transfer, add, remove, live, pick, theme, settings,
    extract, account, rename, trash, hash,
};
