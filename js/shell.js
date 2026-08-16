// shell.js — the app frame: mode bar, stage, tool bar.
//
// The frame owns exactly three things: which mode is current, what the stage
// shows, and the wiring that lets a tool button stand in for a control that
// lives inside a popover. Everything else is left to the feature modules, which
// still find their inputs by the ids they always used.

import { ICONS } from './icons.js';
import * as popover from './popover.js';
import { paint, pixelArt } from './welcome.js';
import { getSubject, onSubjectChanged, hasUserSubject } from './subject.js';
import { getPaletteRgb, getSelected, onPalettesChanged, onSelectionChanged } from './palettes.js';
import { boxDownsample, mapToPaletteExact, blockHeight } from './core.js';
import { $ } from './ui.js';

// 'welcome' is a real mode, just one with no tool bar and nothing highlighted:
// it is the state the app opens in and never returns to.
const MODES = ['welcome', 'extract', 'palettes', 'photo', 'video', 'account', 'settings'];

// Drop pixel art in assets/welcome/ and re-run sync-web.sh — it rebuilds the
// manifest, because a WebView cannot list a directory for itself.
const WELCOME_DIR = 'assets/welcome';
const WELCOME_MANIFEST = `${WELCOME_DIR}/manifest.json`;
const PREVIEW_BLOCKS = 96;         // width of the palette thumbnail, in blocks

let app = null;
let current = 'welcome';

/* ------------------------------------------------------------------ icons */

function paintIcons() {
    for (const el of document.querySelectorAll('[data-icon]')) {
        const svg = ICONS[el.dataset.icon];
        if (svg) el.insertAdjacentHTML('afterbegin', svg);
    }
}

/* ------------------------------------------------------------- welcome */

/**
 * Show one of the user's own pictures, chosen at random, edge to edge.
 *
 * Falls back to art generated in code when the folder is empty or unreadable —
 * which is also the case over file://, where fetch is blocked. The app always
 * has something to open with.
 */
async function loadWelcome() {
    const img = $('welcome-img');
    const canvas = $('welcome-canvas');

    // Draw the generated art first and synchronously, so the opening frame is
    // never empty while the manifest request is in flight. A picture from
    // assets/welcome replaces it below if there is one.
    //
    // It is composed to the screen's proportions: this is shown edge to edge,
    // and art in the wrong shape would be cropped to a strip.
    const stage = $('stage').getBoundingClientRect();
    const cols = 72;
    const rows = stage.width > 0 ? Math.round(cols * (stage.height / stage.width)) : 45;
    paint(canvas, pixelArt(cols, rows));

    try {
        const res = await fetch(WELCOME_MANIFEST, { cache: 'no-store' });
        if (!res.ok) throw new Error(`manifest ${res.status}`);

        const files = await res.json();
        if (!Array.isArray(files) || files.length === 0) throw new Error('no images listed');

        const pick = files[Math.floor(Math.random() * files.length)];
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error(`could not load ${pick}`));
            img.src = `${WELCOME_DIR}/${encodeURIComponent(pick)}`;
        });

        img.classList.remove('hidden');
        canvas.classList.add('hidden');
    } catch {
        // Nothing to report, and nothing to do: an empty folder is the normal
        // state on a fresh install, and the generated art is already up.
    }
}

/* ------------------------------------------------------------- palettes */

/**
 * The downsampled working image, cached.
 *
 * This is what makes a live thumbnail affordable. Reducing a 12 MP photo to the
 * block grid means reading 12 million pixels and costs tens of milliseconds;
 * mapping the resulting ~9,000 blocks to a palette is well under a millisecond.
 * Only the second half depends on the palette, so the first half is done once
 * per image and reused for every colour added or removed.
 */
let reduced = null;                // { rgb: Float32Array, bw, bh }

function reduceSubject() {
    const src = getSubject();
    const bw = Math.min(PREVIEW_BLOCKS, src.width);
    const bh = blockHeight(bw, src.width, src.height);
    reduced = { rgb: boxDownsample(src.data, src.width, src.height, bw, bh), bw, bh };
}

/**
 * Show the selected palette applied to the working image, small, in the corner
 * of the Palettes screen — enough to judge a palette by while editing it.
 *
 * Only shown once the user has loaded something of their own: a thumbnail of
 * the stock welcome art tells them nothing they want to know.
 */
function renderPaletteThumb() {
    const canvas = $('pal-mini');
    if (!canvas) return;

    if (!hasUserSubject()) {
        canvas.classList.add('hidden');
        return;
    }
    if (!reduced) reduceSubject();

    const palette = getPaletteRgb(getSelected());
    // An empty palette maps every block to nothing; show the source instead.
    const rgb = palette.length ? mapToPaletteExact(reduced.rgb, palette) : reduced.rgb;

    const out = new ImageData(reduced.bw, reduced.bh);
    for (let s = 0, d = 0; d < out.data.length; s += 3, d += 4) {
        out.data[d] = rgb[s];
        out.data[d + 1] = rgb[s + 1];
        out.data[d + 2] = rgb[s + 2];
        out.data[d + 3] = 255;
    }
    paint(canvas, out, 320);
    canvas.classList.remove('hidden');
}

/* ----------------------------------------------------------------- modes */

export function setMode(mode) {
    if (!MODES.includes(mode)) return;
    popover.close();
    current = mode;
    app.dataset.mode = mode;

    for (const btn of document.querySelectorAll('.mode')) {
        const on = btn.dataset.mode === mode;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', String(on));
    }

    if (mode === 'palettes') renderPaletteThumb();
}

/* ------------------------------------------------------------- drag drop */

// Which hidden input a dropped file belongs to, per mode. Modes not listed
// have nothing to open, so a drop there is ignored rather than guessed at.
const DROP_TARGETS = { extract: 'ex-file', photo: 'ph-file', video: 'vid-file' };

/**
 * Hand a dropped file to the same input the tool button drives, so the file
 * takes exactly the path it would have taken through the picker — no second
 * copy of the load, decode and error handling.
 */
function deliver(file) {
    const inputId = DROP_TARGETS[current];
    if (!inputId || !file) return;

    const wantsVideo = current === 'video';
    if (wantsVideo !== file.type.startsWith('video/')) return;

    const input = $(inputId);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

function initDragDrop() {
    const stage = $('stage');
    let depth = 0;              // dragenter/leave fire per child; count them

    const accepts = () => Boolean(DROP_TARGETS[current]);
    const paint = (on) => stage.classList.toggle('drop-active', on);

    stage.addEventListener('dragenter', (e) => {
        if (!accepts()) return;
        e.preventDefault();
        depth++;
        paint(true);
    });
    stage.addEventListener('dragover', (e) => {
        if (!accepts()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    stage.addEventListener('dragleave', () => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) paint(false);
    });
    stage.addEventListener('drop', (e) => {
        if (!accepts()) return;
        e.preventDefault();
        depth = 0;
        paint(false);
        deliver(e.dataTransfer.files?.[0]);
    });

    // A file dropped anywhere else would otherwise navigate the page away.
    for (const ev of ['dragover', 'drop']) {
        window.addEventListener(ev, (e) => {
            if (!stage.contains(e.target)) e.preventDefault();
        });
    }
}

/* ------------------------------------------------------------------ init */

export function init() {
    app = $('app');
    paintIcons();
    popover.init();

    for (const btn of document.querySelectorAll('.mode')) {
        btn.addEventListener('click', () => setMode(btn.dataset.mode));
    }

    // A tool button that stands for a file input: the input itself is hidden,
    // because a styled <input type="file"> is a fight not worth having.
    for (const btn of document.querySelectorAll('[data-file]')) {
        btn.addEventListener('click', () => $(btn.dataset.file)?.click());
    }

    initDragDrop();
    loadWelcome();

    const refreshThumb = () => { if (current === 'palettes') renderPaletteThumb(); };
    onPalettesChanged(refreshThumb);
    onSelectionChanged(refreshThumb);
    onSubjectChanged(() => {
        reduced = null;             // new image: the cached reduction is stale
        refreshThumb();
    });

    // Radius and separation only exist for the frequency-peaks method; k-means
    // has no use for them, so the tool that holds them goes dim.
    const method = $('ex-method');
    const tuneTool = $('ex-tune-tool');
    const syncTuning = () => { tuneTool.disabled = method.value !== 'peaks'; };
    method.addEventListener('change', syncTuning);
    syncTuning();

    setMode('welcome');
}
