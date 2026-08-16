// icons.js — the icon language.
//
// Every adjustable parameter gets a mark, drawn on a 16x16 grid.
//
// Three rules, all learned the hard way.
//
// No `shape-rendering: crispEdges`. These are shown at 22px times the interface
// scale — 27.5px at the default — so one grid unit is 1.71875 device pixels.
// Snapping every edge to a whole pixel at that ratio rounds the left side of a
// frame up and the right side down, and the mark comes out visibly lopsided. It
// is not a drawing mistake that moving a rectangle can correct: it is
// arithmetic, and it is wrong at every size that is not a multiple of 16.
// Antialiasing places both edges by the same rule, so a shape stays symmetric
// whatever it is scaled to.
//
// Frames are a filled rectangle with a smaller one knocked out of it in the
// panel colour, never a stroke. A stroke straddles its own path, half inside
// and half outside, which is the other way to end up with edges of different
// widths.
//
// Colour is currentColor. One small element per mark carries --accent-2, the
// complement of the theme's accent. Giving it to the dominant shape turns the
// icon into a coloured blob rather than a drawing with a highlight.

const svg = (body, title) =>
    `<svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true"
      focusable="false"><title>${title}</title>${body}</svg>`;

/** A frame: filled outer, knocked-out inner. Symmetric by construction. */
const frame = (x, y, w, h, t = 1.4) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="currentColor"/>
     <rect x="${x + t}" y="${y + t}" width="${w - 2 * t}" height="${h - 2 * t}" fill="var(--panel)"/>`;

/** R, G and B as three discs — the mark for colour offsets. */
export const rgb = svg(`
    <circle cx="8" cy="4" r="3.1" fill="#ef4444"/>
    <circle cx="4.4" cy="11" r="3.1" fill="#22c55e"/>
    <circle cx="11.6" cy="11" r="3.1" fill="#3b82f6"/>
`, 'RGB offsets');

/** Two frames, one behind the other — frame rate. */
export const fps = svg(`
    ${frame(1, 2.5, 10, 9)}
    ${frame(5, 4.5, 10, 9)}
    <circle cx="10" cy="9" r="1" fill="var(--accent-2)"/>
`, 'Frame rate');

/** A coarse grid over a finer one — block size. */
export const blocks = svg(`
    <rect x="1" y="1" width="6" height="6" fill="currentColor"/>
    <rect x="9" y="9" width="6" height="6" fill="currentColor"/>
    ${frame(9, 1, 6, 6, 1.2)}
    ${frame(1, 9, 6, 6, 1.2)}
    <circle cx="12" cy="12" r="1.2" fill="var(--accent-2)"/>
`, 'Block size');

/** A trail of fading copies — temporal smoothing. */
export const smoothing = svg(`
    <rect x="1" y="5" width="4" height="6" rx="0.4" fill="currentColor" opacity="0.25"/>
    <rect x="5.5" y="5" width="4" height="6" rx="0.4" fill="currentColor" opacity="0.55"/>
    <rect x="10" y="5" width="4" height="6" rx="0.4" fill="currentColor"/>
    <circle cx="12" cy="8" r="1.1" fill="var(--accent-2)"/>
`, 'Smoothing');

/** A strip of swatches — palette. */
export const palette = svg(`
    <rect x="1" y="3" width="2.8" height="10" fill="#ef4444"/>
    <rect x="3.8" y="3" width="2.8" height="10" fill="#eab308"/>
    <rect x="6.6" y="3" width="2.8" height="10" fill="#22c55e"/>
    <rect x="9.4" y="3" width="2.8" height="10" fill="#3b82f6"/>
    <rect x="12.2" y="3" width="2.8" height="10" fill="#a855f7"/>
`, 'Palette');

/* Photo and Video share one 14x12 footprint — x from 1 to 15, y from 2 to 14 —
   so the two sit at the same weight in the mode bar. */

/** Mountain and sun in a frame — a still image. */
export const image = svg(`
    ${frame(1, 2, 14, 12)}
    <circle cx="11" cy="5.6" r="1.5" fill="var(--accent-2)"/>
    <path d="M2.4 12.6 L5.6 7.6 L8.2 10.6 L10.6 7.2 L13.6 12.6 Z" fill="currentColor"/>
`, 'Image');

/** Film strip — a video. Two perforated edges with the picture between them. */
export const film = svg(`
    <rect x="1" y="2" width="14" height="12" fill="currentColor"/>
    <rect x="3.4" y="5.2" width="9.2" height="5.6" fill="var(--panel)"/>
    ${[3.2, 6.1, 9.0, 11.9].map((x) => `
      <rect x="${x}" y="3.1" width="1.6" height="1.5" rx="0.35" fill="var(--panel)"/>
      <rect x="${x}" y="11.4" width="1.6" height="1.5" rx="0.35" fill="var(--panel)"/>`).join('')}
`, 'Video');

/** Concentric rings — the matching radius in the colour cube. */
export const radius = svg(`
    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.35"/>
    <circle cx="8" cy="8" r="4.4" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.7"/>
    <circle cx="8" cy="8" r="1.6" fill="var(--accent-2)"/>
`, 'Matching radius');

/** Two blocks pushed apart — minimum separation between colours. */
export const separation = svg(`
    <rect x="1" y="5" width="4" height="6" rx="0.4" fill="currentColor"/>
    <rect x="11" y="5" width="4" height="6" rx="0.4" fill="currentColor"/>
    <circle cx="8" cy="8" r="1.2" fill="var(--accent-2)"/>
`, 'Minimum separation');

/** A stack of swatches — how many colours to produce. */
export const count = svg(`
    <rect x="2" y="2" width="12" height="3" rx="0.4" fill="currentColor"/>
    <rect x="2" y="6.5" width="12" height="3" rx="0.4" fill="currentColor" opacity="0.6"/>
    <rect x="2" y="11" width="12" height="3" rx="0.4" fill="currentColor" opacity="0.3"/>
`, 'Number of colours');

/** Play triangle — run the job. */
export const run = svg(`<path d="M3.5 2 L14 8 L3.5 14 Z" fill="var(--accent-2)"/>`, 'Run');

/** Arrow into a tray — save. */
export const save = svg(`
    <rect x="7" y="1.5" width="2" height="6.5" rx="0.4" fill="currentColor"/>
    <path d="M4 7 L8 11.5 L12 7 Z" fill="currentColor"/>
    <rect x="2" y="13" width="12" height="1.8" rx="0.5" fill="var(--accent-2)"/>
`, 'Save');

/** Sliders — quality and encoder options. */
export const tune = svg(`
    <rect x="1" y="3.2" width="14" height="1.6" rx="0.6" fill="currentColor"/>
    <rect x="1" y="11.2" width="14" height="1.6" rx="0.6" fill="currentColor"/>
    <circle cx="5.5" cy="4" r="2.2" fill="currentColor"/>
    <circle cx="10.5" cy="12" r="2.2" fill="var(--accent-2)"/>
`, 'Options');

/** Boxes moving between devices — backup and transfer. */
export const transfer = svg(`
    <rect x="1" y="2" width="6" height="5" rx="0.6" fill="currentColor"/>
    <rect x="9" y="9" width="6" height="5" rx="0.6" fill="var(--accent-2)"/>
    <path d="M8.5 4.5 L14 4.5 L14 8" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <path d="M7.5 11.5 L2 11.5 L2 8" fill="none" stroke="currentColor" stroke-width="1.3"/>
`, 'Backup and transfer');

/** Plus — add. */
export const add = svg(`
    <rect x="7" y="2" width="2" height="12" rx="0.5" fill="currentColor"/>
    <rect x="2" y="7" width="12" height="2" rx="0.5" fill="var(--accent-2)"/>
`, 'Add');

/** Minus — remove. The inverse of `add`, deliberately. */
export const remove = svg(`
    <rect x="2" y="7" width="12" height="2" rx="0.5" fill="var(--accent-2)"/>
`, 'Remove');

/**
 * Head and shoulders — account.
 *
 * A real circle. The head used to be a stack of rectangles approximating one,
 * which read as a stepped lump at this size, and the row that carried the accent
 * looked like a stripe painted across someone's face.
 */
export const account = svg(`
    <circle cx="8" cy="5" r="3.2" fill="currentColor"/>
    <path d="M1.6 15 C1.6 11.1 4.5 9.4 8 9.4 C11.5 9.4 14.4 11.1 14.4 15 Z" fill="currentColor"/>
`, 'Account');

/** A nib over a ruled line — rename. */
export const rename = svg(`
    <path d="M2.6 11.2 L10.2 3.6 L12.4 5.8 L4.8 13.4 L1.8 14.2 Z" fill="currentColor"/>
    <rect x="1.5" y="14.6" width="13" height="1.2" rx="0.5" fill="var(--accent-2)"/>
`, 'Rename');

/** Lidded bin with slots — delete. */
export const trash = svg(`
    <rect x="6" y="0.6" width="4" height="1.6" rx="0.4" fill="var(--accent-2)"/>
    <rect x="2" y="2.6" width="12" height="1.8" rx="0.5" fill="currentColor"/>
    <path d="M3.4 5.6 L12.6 5.6 L11.7 15.2 L4.3 15.2 Z" fill="currentColor"/>
    <rect x="6.2" y="7.6" width="1.2" height="5.4" rx="0.5" fill="var(--panel)"/>
    <rect x="8.6" y="7.6" width="1.2" height="5.4" rx="0.5" fill="var(--panel)"/>
`, 'Delete');

/** A hash — a written list of colour codes. */
export const hash = svg(`
    <rect x="4.2" y="1" width="1.8" height="14" rx="0.5" fill="currentColor"/>
    <rect x="10" y="1" width="1.8" height="14" rx="0.5" fill="currentColor"/>
    <rect x="1" y="4.2" width="14" height="1.8" rx="0.5" fill="var(--accent-2)"/>
    <rect x="1" y="10" width="14" height="1.8" rx="0.5" fill="var(--accent-2)"/>
`, 'Colour codes');

/** A dot with a signal coming off it — the preview is live. */
export const live = svg(`
    <circle cx="8" cy="8" r="2.2" fill="var(--accent-2)"/>
    <path d="M4.4 4.4 A5 5 0 0 0 4.4 11.6" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <path d="M11.6 4.4 A5 5 0 0 1 11.6 11.6" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <path d="M2.2 2.2 A8.2 8.2 0 0 0 2.2 13.8" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.45"/>
    <path d="M13.8 2.2 A8.2 8.2 0 0 1 13.8 13.8" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.45"/>
`, 'Live preview');

/** Eyedropper — pick a colour. */
export const pick = svg(`
    <rect x="9.2" y="1" width="5" height="3.6" rx="0.6" transform="rotate(45 11.7 2.8)" fill="var(--accent-2)"/>
    <path d="M2 14 L2.9 10.4 L10 3.3 L12.7 6 L5.6 13.1 Z" fill="currentColor"/>
`, 'Colour picker');

/** Half light, half dark — appearance. */
export const theme = svg(`
    <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <path d="M8 1.4 A6.6 6.6 0 0 1 8 14.6 Z" fill="currentColor"/>
`, 'Appearance');

/**
 * A gear — settings.
 *
 * A ring with eight teeth: four on the axes, and the same four rotated 45
 * degrees. The set is written once and emitted twice rather than referenced
 * with <use>: an id would be duplicated every time this mark is injected, and
 * every copy would then depend on the first one staying in the document.
 */
const GEAR_TEETH = `
    <rect x="6.6" y="0.4" width="2.8" height="4" rx="0.6"/>
    <rect x="6.6" y="11.6" width="2.8" height="4" rx="0.6"/>
    <rect x="0.4" y="6.6" width="4" height="2.8" rx="0.6"/>
    <rect x="11.6" y="6.6" width="4" height="2.8" rx="0.6"/>`;

export const settings = svg(`
    <g fill="currentColor">
      <g>${GEAR_TEETH}</g>
      <g transform="rotate(45 8 8)">${GEAR_TEETH}</g>
    </g>
    <circle cx="8" cy="8" r="5.1" fill="currentColor"/>
    <circle cx="8" cy="8" r="2.3" fill="var(--panel)"/>
    <circle cx="8" cy="8" r="2.3" fill="none" stroke="var(--accent-2)" stroke-width="0.9"/>
`, 'Settings');

/** A funnel of blocks — extraction. */
export const extract = svg(`
    <rect x="1" y="1.6" width="14" height="2.8" rx="0.5" fill="currentColor" opacity="0.35"/>
    <rect x="3.4" y="6.4" width="9.2" height="2.8" rx="0.5" fill="currentColor" opacity="0.7"/>
    <rect x="6" y="11.2" width="4" height="3.2" rx="0.5" fill="var(--accent-2)"/>
`, 'Extract');

/** A brush held at an angle, tip loaded — the nudge tool. */
export const brush = svg(`
    <path d="M10.2 1.2 L14.8 5.8 L11.8 8.8 L7.2 4.2 Z" fill="currentColor"/>
    <path d="M7.2 4.2 L11.8 8.8 L7.6 13 L3 8.4 Z" fill="currentColor" opacity="0.55"/>
    <path d="M3 8.4 L7.6 13 L5 15 L1 15 L1 11 Z" fill="var(--accent-2)"/>
`, 'Brush');

/** A pencil laying down a coloured line — the draw tool. */
export const draw = svg(`
    <path d="M3 12.6 L4 9.4 L10.8 2.6 L13.4 5.2 L6.6 12 Z" fill="currentColor"/>
    <path d="M10.8 2.6 L13.4 5.2 L14.8 3.4 L12.6 1.2 Z" fill="var(--accent-2)"/>
    <rect x="1.5" y="14" width="13" height="1.6" rx="0.6" fill="currentColor" opacity="0.45"/>
`, 'Draw');

/**
 * Two overlapping corner marks — crop.
 *
 * The pair is exactly 180-degree rotationally symmetric about the centre: every
 * bar maps onto the other one under (x, y) -> (16 - x, 16 - y). Hollow on
 * purpose — a block in the middle reads as a selected object, and a crop is the
 * frame you put around one.
 */
export const crop = svg(`
    <rect x="3.4" y="0.8" width="1.8" height="11.4" fill="currentColor"/>
    <rect x="3.4" y="10.4" width="11.4" height="1.8" fill="currentColor"/>
    <rect x="1.2" y="3.8" width="11.4" height="1.8" fill="var(--accent-2)"/>
    <rect x="10.8" y="3.8" width="1.8" height="11.4" fill="var(--accent-2)"/>
`, 'Crop');

/** Arrows pushing outward — fit to the screen. */
export const fit = svg(`
    <path d="M1 1 L6.6 1 L1 6.6 Z" fill="var(--accent-2)"/>
    <path d="M15 1 L15 6.6 L9.4 1 Z" fill="var(--accent-2)"/>
    <path d="M1 15 L1 9.4 L6.6 15 Z" fill="var(--accent-2)"/>
    <path d="M15 15 L9.4 15 L15 9.4 Z" fill="var(--accent-2)"/>
    <circle cx="8" cy="8" r="1.3" fill="currentColor" opacity="0.55"/>
`, 'Fit to screen');

/** An arrow turning back on itself — undo. */
export const undo = svg(`
    <path d="M5.6 3.6 A5 5 0 1 1 3.2 8.4" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round"/>
    <path d="M7 1 L7 6.4 L1.8 3.7 Z" fill="var(--accent-2)"/>
`, 'Undo');

/** The same arrow, mirrored — redo. */
export const redo = svg(`
    <path d="M10.4 3.6 A5 5 0 1 0 12.8 8.4" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round"/>
    <path d="M9 1 L9 6.4 L14.2 3.7 Z" fill="var(--accent-2)"/>
`, 'Redo');

/**
 * An i in a disc — information.
 *
 * A lamp was the wrong sign: it promises an idea, and what is behind this is
 * reference material. An i is the one mark everybody already reads as "here is
 * what you need to know".
 */
export const tips = svg(`
    <circle cx="8" cy="8" r="7" fill="currentColor"/>
    <circle cx="8" cy="4.5" r="1.25" fill="var(--panel)"/>
    <rect x="6.8" y="6.7" width="2.4" height="5.8" rx="1.1" fill="var(--panel)"/>
    <circle cx="8" cy="8" r="7" fill="none" stroke="var(--accent-2)" stroke-width="0.9"/>
`, 'Tips');

/** A heart — the thank-you screen. */
export const legacy = svg(`
    <path d="M8 14.4 C8 14.4 1.2 10.2 1.2 5.9 C1.2 3.4 3.1 1.6 5.3 1.6
             C6.6 1.6 7.5 2.3 8 3.2 C8.5 2.3 9.4 1.6 10.7 1.6
             C12.9 1.6 14.8 3.4 14.8 5.9 C14.8 10.2 8 14.4 8 14.4 Z"
          fill="var(--accent-2)"/>
`, 'Legacy');

/**
 * Three dots — more.
 *
 * The collapsed slot on a phone holds Settings, Account, Tips and Legacy, so
 * borrowing the gear made it look like a link to Settings and nothing else. An
 * ellipsis is the one mark that says "there are further things behind this"
 * without naming any of them.
 */
export const more = svg(`
    <circle cx="3" cy="8" r="1.9" fill="currentColor"/>
    <circle cx="8" cy="8" r="1.9" fill="var(--accent-2)"/>
    <circle cx="13" cy="8" r="1.9" fill="currentColor"/>
`, 'More');

export const ICONS = {
    rgb, fps, blocks, smoothing, palette, image, film, radius, separation,
    count, run, save, tune, transfer, add, remove, live, pick, theme, settings,
    extract, account, rename, trash, hash, brush, undo, redo, fit,
    draw, tips, legacy, crop, more,
};
