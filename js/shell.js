// shell.js — the app frame: mode bar, stage, tool bar.
//
// The frame owns exactly three things: which mode is current, what the stage
// shows, and the wiring that lets a tool button stand in for a control that
// lives inside a popover. Everything else is left to the feature modules, which
// still find their inputs by the ids they always used.

import { ICONS } from './icons.js';
import * as popover from './popover.js';
import { paint, pixelArt } from './welcome.js';
import { paintLogo, meanColor } from './logo.js';
import { getSubject, onSubjectChanged, hasUserSubject } from './subject.js';
import { getPaletteRgb, getSelected, onPalettesChanged, onSelectionChanged } from './palettes.js';
import { boxDownsample, mapToPaletteExact, blockHeight } from './core.js';
import { $ } from './ui.js';
import { isInAppBrowser } from './save.js';

// 'welcome' is a real mode, just one with no tool bar and nothing highlighted:
// it is the state the app opens in and never returns to.
const MODES = ['welcome', 'extract', 'palettes', 'photo', 'video', 'account', 'settings',
    'tips', 'legacy'];

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
/**
 * Tint the launch buttons to the artwork behind them.
 *
 * Written as three numbers rather than a colour so the stylesheet can decide
 * the alpha — the same mean is wanted at one opacity resting and another on
 * hover, and `rgb(... / a)` can only do that if the channels arrive separately.
 */
function setSplashMean(rgb) {
    $('app').style.setProperty('--splash-mean', rgb.join(' '));
}

/** Read the mean colour back off whichever surface is actually showing. */
function measureWelcome() {
    const img = $('welcome-img');
    const canvas = $('welcome-canvas');
    const showingImage = !img.classList.contains('hidden') && img.naturalWidth > 0;

    try {
        if (showingImage) {
            // Downsized first: the mean of a thumbnail is the mean of the
            // picture, and this avoids reading back several megabytes.
            const tmp = document.createElement('canvas');
            tmp.width = 64;
            tmp.height = Math.max(1, Math.round(64 * img.naturalHeight / img.naturalWidth));
            const tctx = tmp.getContext('2d', { willReadFrequently: true });
            tctx.drawImage(img, 0, 0, tmp.width, tmp.height);
            setSplashMean(meanColor(tctx.getImageData(0, 0, tmp.width, tmp.height)));
            return;
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (canvas.width && canvas.height) {
            setSplashMean(meanColor(ctx.getImageData(0, 0, canvas.width, canvas.height)));
        }
    } catch {
        // A tainted canvas would throw; the fallback in the stylesheet stands.
    }
}

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
    measureWelcome();

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
        measureWelcome();
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

/**
 * The modes that live behind the Settings caret rather than in the bar.
 *
 * They are places you visit, not places you work, which is why they can share a
 * slot: nothing here is reached mid-task. Keeping the bar to five entries is
 * what lets every label stay readable on a phone without scrolling.
 */
const GROUPED = ['settings', 'account', 'tips', 'legacy'];

export function setMode(mode) {
    if (!MODES.includes(mode)) return;
    popover.close();
    closeModeMenu();
    current = mode;
    app.dataset.mode = mode;

    for (const btn of document.querySelectorAll('.mode[data-mode]')) {
        const on = btn.dataset.mode === mode;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', String(on));
    }

    // The grouped slot answers for all four of its members, so the bar always
    // shows where you are even when the current screen has no button of its own.
    const more = $('mode-more');
    if (more) {
        const on = GROUPED.includes(mode);
        more.classList.toggle('active', on);
        more.setAttribute('aria-selected', String(on));
    }
    for (const item of document.querySelectorAll('.mode-menu-item')) {
        item.setAttribute('aria-current', String(item.dataset.mode === mode));
    }

    if (mode === 'palettes') renderPaletteThumb();
    applyZoom?.();
}

/* ------------------------------------------------------------ mode menu */

function closeModeMenu() {
    const menu = $('mode-menu'), trigger = $('mode-more');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
}

function openModeMenu() {
    const menu = $('mode-menu'), trigger = $('mode-more');
    if (!menu || !trigger) return;
    popover.close();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');

    // Anchored under its own slot and pulled inside the screen edge. Fixed
    // rather than absolute so it is not clipped by the bar's own bounds.
    const t = trigger.getBoundingClientRect();
    const w = menu.offsetWidth;
    const left = Math.max(8, Math.min(t.right - w, window.innerWidth - w - 8));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(t.bottom + 4)}px`;
}

function initModeMenu() {
    const menu = $('mode-menu'), trigger = $('mode-more');
    if (!menu || !trigger) return;

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menu.hidden) openModeMenu(); else closeModeMenu();
    });
    for (const item of menu.querySelectorAll('.mode-menu-item')) {
        item.addEventListener('click', () => setMode(item.dataset.mode));
    }

    // Same bargain as the tool popovers: a press anywhere else dismisses, and
    // still does whatever it would have done.
    document.addEventListener('pointerdown', (e) => {
        if (menu.hidden) return;
        if (menu.contains(e.target) || trigger.contains(e.target)) return;
        closeModeMenu();
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModeMenu(); });
    // A resize can cross the breakpoint and take the trigger off screen with
    // the menu still anchored to where it used to be.
    window.addEventListener('resize', closeModeMenu);
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

/**
 * Paste an image or clip straight in.
 *
 * The same route a dropped file takes, for the same reason: the load, decode
 * and error handling already exist behind that input and a second copy of them
 * would be a second set of bugs. Pasting from a mode that has nowhere to put a
 * picture switches to Photo rather than doing nothing — nobody presses Ctrl+V
 * hoping to be ignored.
 */
function initPaste() {
    document.addEventListener('paste', (e) => {
        // Let a paste into a text box be a paste into a text box.
        const el = document.activeElement;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

        const items = e.clipboardData?.items;
        if (!items) return;

        let file = null;
        for (const item of items) {
            if (item.kind !== 'file') continue;
            const f = item.getAsFile();
            if (f && (f.type.startsWith('image/') || f.type.startsWith('video/'))) { file = f; break; }
        }
        if (!file) return;
        e.preventDefault();

        const isVideo = file.type.startsWith('video/');
        // A clipboard image has no name of its own on most platforms.
        const named = file.name && file.name !== 'image.png'
            ? file
            : new File([file], isVideo ? 'pasted-clip.mp4' : 'pasted-image.png', { type: file.type });

        const target = DROP_TARGETS[current];
        const wantsVideo = current === 'video';
        if (!target || wantsVideo !== isVideo) setMode(isVideo ? 'video' : 'photo');

        deliver(named);
    });
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

/* ------------------------------------------------------------ page zoom */

/**
 * Hold the interface at a constant physical size while the browser zooms.
 *
 * Browser zoom scales the whole page, which on an image editor is the wrong
 * thing: zooming is how you look closer at the picture, and taking the menus
 * and the tool bar with it costs the room the picture was supposed to gain.
 * Dividing the interface scale by the zoom factor cancels it out for the
 * chrome, leaving the stage — which sizes itself to its box in CSS pixels — as
 * the only thing that actually grows.
 *
 * The zoom level is read from devicePixelRatio against its value at load,
 * because there is no direct way to ask. That means a display whose scaling
 * changes mid-session reads as a zoom, which is a fair reading of it anyway.
 */
/**
 * Which tabs have something worth zooming into, and whether they currently do.
 *
 * Holding the interface still under zoom is only the right trade when there is
 * a picture to give the room to. On a screen of lists and settings it would
 * just make everything permanently small for someone who zoomed because they
 * wanted it bigger, so there the browser is left to do what it normally does.
 */
const ZOOMABLE = new Set(['photo', 'video', 'extract']);
const mediaLoaded = { photo: false, video: false, extract: false };

/** Called by each screen when it gains or loses its subject. */
export function setMediaLoaded(mode, has) {
    if (!(mode in mediaLoaded)) return;
    mediaLoaded[mode] = Boolean(has);
    applyZoom?.();
}

let applyZoom = null;

function initZoomCompensation() {
    const root = document.documentElement;
    const startDpr = window.devicePixelRatio || 1;
    const uiBase = parseFloat(getComputedStyle(root).getPropertyValue('--ui-base')) || 1.25;
    let watcher = null;

    const apply = () => {
        // Nothing to zoom into: let the page scale normally.
        if (!(ZOOMABLE.has(current) && mediaLoaded[current])) {
            root.style.setProperty('--ui', String(uiBase));
            return;
        }
        const zoom = (window.devicePixelRatio || 1) / startDpr;
        // Only ever hold the interface back, never inflate it.
        //
        // Compensating below 100% was a mistake: zooming out is how you ask to
        // see more at once, and scaling the interface up to cancel it means
        // nothing happens except that the panels outgrow the window and start
        // needing scrollbars of their own. Zooming in gives the picture the
        // room; zooming out shrinks everything, interface included, which is
        // what it is for.
        //
        // The upper clamp stands: past 3x someone zooming that far wants
        // everything bigger, including the furniture.
        const clamped = Math.max(1, Math.min(3, zoom));
        // A plain number, never a calc() — see the note beside --ui in app.css.
        root.style.setProperty('--ui', String(+(uiBase / clamped).toFixed(4)));
    };
    applyZoom = apply;

    /**
     * Re-arm on every change.
     *
     * `resize` alone is not enough: a zoom that does not change the window's
     * CSS size does not always fire one. A media query on the current
     * resolution does fire, but only for a move *away* from the value it was
     * built with, so it has to be rebuilt around the new value each time.
     */
    const rearm = () => {
        watcher?.removeEventListener('change', onChange);
        const dppx = window.devicePixelRatio || 1;
        watcher = matchMedia(`(resolution: ${dppx}dppx)`);
        watcher.addEventListener('change', onChange);
    };
    function onChange() { apply(); rearm(); }

    apply();
    rearm();
    window.addEventListener('resize', apply);
}

/* -------------------------------------------------------- launch screen */

/**
 * The launch screen: a picture, a name, and an invitation.
 *
 * The four workspaces are deliberately not on screen yet. Showing them straight
 * away in a bar means the first thing the app does is present a control panel;
 * making them arrive in the middle of the artwork, once asked for, means the
 * first thing it does is show you what it makes.
 */
/** Long enough to outlast the reveal animation and the click that follows it. */
const REVEAL_GUARD_MS = 500;

function initSplash() {
    const splash = $('splash');
    const grid = $('splash-grid');
    const hint = $('splash-hint');
    if (!splash || !grid) return;

    paintLogo($('splash-logo'), 6);

    let revealed = false;
    const reveal = () => {
        if (revealed) return;
        revealed = true;
        measureWelcome();      // the artwork may have swapped in since load
        hint.hidden = true;
        grid.hidden = false;

        // The press that asks for the choices must not also make one. The grid
        // appears under a finger that is still down, and the click which
        // follows is hit-tested when the finger lifts — by which time a tile is
        // where the empty artwork was, so it would be pressed by a gesture that
        // was never aimed at it. Holding the grid inert until the gesture is
        // over and the tiles have finished arriving is what separates "start"
        // from "choose".
        grid.style.pointerEvents = 'none';
        setTimeout(() => { grid.style.pointerEvents = ''; }, REVEAL_GUARD_MS);

        grid.querySelector('button')?.focus({ preventScroll: true });
    };

    // Any press anywhere on the launch screen, and Enter or Space for a
    // keyboard, since "click anywhere" is not an instruction a keyboard can
    // follow.
    splash.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.splash-grid')) return;   // that is a choice, not the invitation
        reveal();
    });
    document.addEventListener('keydown', (e) => {
        if (current !== 'welcome' || revealed) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); }
    });

    for (const btn of grid.querySelectorAll('button[data-mode]')) {
        btn.addEventListener('click', () => setMode(btn.dataset.mode));
    }
}

/* ------------------------------------------------------- in-app browser */

/** Which app we are inside, for the banner to name. */
function inAppName() {
    const ua = navigator.userAgent || '';
    if (/Instagram/i.test(ua)) return 'Instagram';
    if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'Facebook';
    if (/TikTok|musical_ly/i.test(ua)) return 'TikTok';
    if (/Snapchat/i.test(ua)) return 'Snapchat';
    if (/Pinterest/i.test(ua)) return 'Pinterest';
    if (/Twitter/i.test(ua)) return 'X';
    if (/Line\//i.test(ua)) return 'LINE';
    return 'another app';
}

function initInAppBanner() {
    const banner = $('inapp-banner');
    if (!banner || !isInAppBrowser()) return;

    $('inapp-name').textContent = inAppName();
    banner.classList.remove('hidden');

    $('inapp-dismiss').addEventListener('click', () => banner.remove());
    $('inapp-copy').addEventListener('click', async (e) => {
        try {
            await navigator.clipboard.writeText(location.href);
            e.target.textContent = 'Copied';
        } catch {
            // No clipboard permission in some WebViews; showing the URL at
            // least lets it be read out or typed.
            $('inapp-name').textContent = location.href;
        }
    });
}

/* ------------------------------------------------------------------ init */

export function init() {
    app = $('app');
    paintIcons();
    popover.init();

    for (const btn of document.querySelectorAll('.mode[data-mode]')) {
        btn.addEventListener('click', () => setMode(btn.dataset.mode));
    }
    initModeMenu();

    // A tool button that stands for a file input: the input itself is hidden,
    // because a styled <input type="file"> is a fight not worth having.
    for (const btn of document.querySelectorAll('[data-file]')) {
        btn.addEventListener('click', () => $(btn.dataset.file)?.click());
    }

    initZoomCompensation();
    initDragDrop();
    initPaste();
    initSplash();
    initInAppBanner();
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
