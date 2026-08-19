// photo.js — the Photo tab. Same pipeline as video, minus the temporal blend.
//
// The stage is a view onto a block grid rather than a picture of one. Three
// buffers, each rebuilt only when its own inputs change:
//
//   base    the source reduced to blocks, before the palette. Depends on the
//           image, the block size and the RGB offsets — not on the palette, and
//           not on the brush, so dragging a palette does not re-read 12 MP.
//   deltas  the brush layer: a signed offset per block per channel.
//   mapped  base + deltas, matched to the palette. This is what is drawn, and
//           what gets saved.
//
// Splitting them is what makes both the live preview and the brush affordable:
// reducing a large photo costs tens of milliseconds, mapping ~20,000 blocks
// costs well under one, and a brush stroke only ever invalidates the third.

import { boxDownsample, mapToPalette, mapToPaletteExact, applyOffsets, blockHeight } from './core.js';
import { chooseMapper } from './pipeline.js';
import { getPaletteRgb, getPaletteHexes, getAddedCount, addHandColor,
         onPalettesChanged } from './palettes.js';
import { attachPalettePicker } from './palettepicker.js';
import { linkBlockSliders } from './blocksize.js';
import { setSubject } from './subject.js';
import { createView } from './view.js';
import { createBrushLayer, applyDeltas, SHAPES } from './brush.js';
import { createDrawLayer, applyDrawn, hexToPacked } from './draw.js';
import { createColorPicker } from './colorpicker.js';
import * as crop from './crop.js';
import { spatialSmooth, blendMasked, maxSize, windowFor } from './smooth.js';
import { saveBlob } from './save.js';
import { setMediaLoaded } from './shell.js';
import { $, makeLogger, bindSlider, fillPaletteSelect, fileToImageData, nextFrame,
         confirmButton, setStrengthActive } from './ui.js';

const log = makeLogger('ph-log');

let imgData = null;        // ImageData of the source, kept for re-reductions
let sourceName = 'image';
let renderTimer = null;
let blocks = null;         // aspect-locked width/height pair

let base = null;           // Float32Array, pre-palette block values
let baseKey = '';          // what `base` was built from
let layer = null;          // brush offsets + undo
let drawLayer = null;      // drawn colours + undo
let smoothMask = null;     // where the brush has asked for smoothing, 0-100
let filterCache = null;    // { key, rgb } — the filtered grid, which is not cheap
let view = null;
let painting = false;
/**
 * While held, the picture is rendered as though the RGB offsets were zero.
 *
 * A flag rather than temporarily zeroing the sliders: moving them would fire
 * their change events, redraw their readouts, and leave the panel flickering
 * between two states. This way the controls stay exactly where they were and
 * only the render differs.
 */
let compareNeutral = false;
let drawPicker = null;
let drawColor = null;      // packed RGB, or 0 for the eraser, or null if unset

/**
 * The original image, kept so a crop is always taken from the full photo.
 *
 * Cropping a crop would compound the resampling and make "back to the full
 * image" impossible, so `imgData` is always originalImgData put through the
 * current selection rather than the previous result put through it again.
 */
let originalImgData = null;
let cropRect = null;       // the selection being edited, in source pixels
let committedRect = null;  // the selection that produced the current imgData
let cropLock = null;       // locked ratio, or null for free
let cropDrag = null;       // { handle, startRect, startX, startY } mid-gesture

/**
 * One ordered history for everything the user can do to the picture.
 *
 * Each entry is a pair of closures rather than a tagged layer name: the brush
 * and draw layers keep their own stacks and only need telling when their turn
 * comes, but a crop is not a layer at all, and making the history speak in
 * "undo this / redo this" lets all three share one button without the button
 * needing to know what any of them are.
 */
const history = [];
const future = [];

/** The block-resolution image the view displays and the exporter writes. */
const surface = document.createElement('canvas');
let surfaceW = 0, surfaceH = 0;

const rgbOffsets = () =>
    [Number($('ph-r').value), Number($('ph-g').value), Number($('ph-b').value)];

const settings = () => ({
    ...blocks.dims(),
    offsets: compareNeutral ? [0, 0, 0] : rgbOffsets(),
    paletteName: $('ph-palette').value,
});

/**
 * How far from the finger the stroke lands, in screen pixels.
 *
 * A percentage of the stage height rather than a number of blocks: this exists
 * because a hand covers a fixed area of a screen, which has nothing to do with
 * how far the picture is zoomed in.
 */
function toolOffsetPx() {
    const pct = Number($('ph-tool-offset')?.value || 0);
    if (!pct) return 0;
    const r = $('ph-canvas').getBoundingClientRect();
    return (pct / 100) * r.height;
}

/** The one filter definition. Applied globally, locally by brush, or both. */
/**
 * The slider counts neighbours out from a block; the filter wants the window's
 * edge length. One block out is a 2x2 window, two is 3x3, and 0 is the single
 * block itself, which is to say nothing at all.
 */
const smoothSettings = () => ({
    mode: $('ph-smode').querySelector('[aria-pressed="true"]')?.dataset.smode ?? 'despeckle',
    shape: $('ph-sshape').querySelector('[aria-pressed="true"]')?.dataset.sshape ?? 'square',
    size: Number($('ph-sradius').value) + 1,
    strength: Number($('ph-sstrength').value) / 100,
});

/** The smoothing brush is its own tool, not a mode of the nudge brush. */
const smoothBrush = () => ({
    on: $('ph-smooth-brush-on').checked,
    shape: $('ph-smooth-shapes').querySelector('[aria-pressed="true"]')?.dataset.shape ?? 'circle',
    size: Number($('ph-smooth-size').value),
});

const drawSettings = () => ({
    on: $('ph-draw-on').checked,
    shape: $('ph-draw-shapes').querySelector('[aria-pressed="true"]')?.dataset.shape ?? 'square',
    size: Number($('ph-draw-size').value),
});

const brushSettings = () => ({
    on: $('ph-brush-on').checked,
    shape: $('ph-brush-shapes').querySelector('[aria-pressed="true"]')?.dataset.shape ?? 'circle',
    size: Number($('ph-brush-size').value),
    delta: [Number($('ph-brush-r').value), Number($('ph-brush-g').value), Number($('ph-brush-b').value)],
});

/* ------------------------------------------------------------- buffers */

/**
 * Rebuild the pre-palette block grid if anything it depends on has moved.
 * @returns {boolean} whether the grid was rebuilt
 */
function ensureBase({ bw, bh, offsets }) {
    const key = `${imgData.width}x${imgData.height}|${bw}x${bh}|${offsets.join(',')}`;
    if (key === baseKey && base) return false;

    // Copy: applyOffsets works in place and must not damage the source.
    const rgba = new Uint8ClampedArray(imgData.data);
    applyOffsets(rgba, offsets);
    base = boxDownsample(rgba, imgData.width, imgData.height, bw, bh);
    baseKey = key;

    // A new grid invalidates hand-placed work on both layers. Only the stroke
    // history goes with it: a crop or an image swap is still perfectly
    // undoable, and clearing everything here is what silently ate the undo step
    // a crop had just pushed — render() is async, so this runs afterwards.
    const moved = layer.resize(bw, bh);
    const movedDraw = drawLayer.resize(bw, bh);
    const movedMask = smoothMask.resize(bw, bh);
    if (moved || movedDraw || movedMask) dropStrokeHistory();
    filterCache = null;         // a new grid means a new filter
    surface.width = surfaceW = bw;
    surface.height = surfaceH = bh;
    return true;
}

/**
 * The filtered grid, cached.
 *
 * A median over a 20,000-block grid is tens of milliseconds — fine once, far
 * too slow to redo on every pointermove of a brush stroke. It depends on the
 * reduction and the filter settings and on nothing else, so brushing a mask
 * over it is a cache hit every time.
 */
function filteredGrid(size, shape, mode) {
    const key = `${baseKey}|${size}|${shape}|${mode}`;
    if (filterCache && filterCache.key === key) return filterCache.rgb;
    const rgb = spatialSmooth(base, surfaceW, surfaceH, { size, shape, mode, strength: 1 });
    filterCache = { key, rgb };
    return rgb;
}

/**
 * base -> spatial filter -> brush offsets -> palette -> drawn blocks.
 *
 * The filter runs before matching, which is the whole point: after matching
 * every value has been snapped to a palette colour, and averaging those
 * produces colours the palette does not contain. Drawing comes last precisely
 * because it is not up for matching at all.
 */
function composite(palette, lut) {
    const rgb = Float32Array.from(base);

    const sm = smoothSettings();
    if (sm.size > 1) {
        const filtered = filteredGrid(sm.size, sm.shape, sm.mode);
        // Globally first, then wherever the brush asked for more.
        if (sm.strength > 0) {
            const a = sm.strength, ia = 1 - a;
            for (let i = 0; i < rgb.length; i++) rgb[i] = ia * rgb[i] + a * filtered[i];
        }
        if (smoothMask.hasEdits) blendMasked(rgb, filtered, smoothMask.cells);
    }

    applyDeltas(rgb, layer.deltas);
    const mapped = lut ? mapToPalette(rgb, lut) : mapToPaletteExact(rgb, palette);
    applyDrawn(mapped, drawLayer.cells);

    const ctx = surface.getContext('2d');
    const id = ctx.createImageData(surfaceW, surfaceH);
    for (let i = 0, j = 0; i < mapped.length; i += 3, j += 4) {
        id.data[j] = mapped[i]; id.data[j + 1] = mapped[i + 1];
        id.data[j + 2] = mapped[i + 2]; id.data[j + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
}

/* -------------------------------------------------------------- render */

/** Debounced re-render so dragging a slider stays responsive. */
function scheduleRender() {
    if (!$('ph-live').checked || !imgData) return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => render(), 120);
}

async function render() {
    if (!imgData) { alert('Choose an image first.'); return; }
    const cfg = settings();
    const palette = getPaletteRgb(cfg.paletteName);
    if (!palette.length) {
        // Say so where the reader is looking. Leaving the previous render up
        // with its old timing means the status line describes a palette that is
        // not the one selected, which is worse than showing nothing.
        $('ph-timing').textContent = `"${cfg.paletteName}" has no colours to match against`;
        log(`Palette "${cfg.paletteName}" is empty — add a colour to it.`, 'err');
        return;
    }

    const btn = $('ph-run');
    btn.disabled = true;
    await nextFrame();

    try {
        const t0 = performance.now();
        ensureBase(cfg);
        const { lut } = chooseMapper(palette, surfaceW * surfaceH);
        composite(palette, lut);
        view.redraw();

        const ms = performance.now() - t0;
        $('ph-timing').textContent =
            `${imgData.width}x${imgData.height} -> ${surfaceW}x${surfaceH} blocks, ` +
            `${palette.length} colours, ${ms.toFixed(0)} ms` + (lut ? ' (LUT)' : ' (exact match)');
        $('ph-save').disabled = false;
    } catch (err) {
        log(`Render failed: ${err.message}`, 'err');
    } finally {
        btn.disabled = false;
    }
}

/**
 * Redraw after a brush stroke.
 *
 * Deliberately not the full render(): the reduction and the timing readout have
 * not changed, and rebuilding either mid-stroke is what would make painting
 * feel heavy. Only the mapping is redone.
 */
function repaintBrush() {
    const palette = getPaletteRgb($('ph-palette').value);
    if (!palette.length || !base) return;
    const { lut } = chooseMapper(palette, surfaceW * surfaceH);
    composite(palette, lut);
    view.redraw();
}

/* --------------------------------------------------------------- brush */

function syncHistoryButtons() {
    $('ph-undo').disabled = history.length === 0;
    $('ph-redo').disabled = future.length === 0;
}

/** Record one undoable step, in the order it happened. */
function pushHistory(entry) {
    history.push(entry);
    future.length = 0;
    syncHistoryButtons();
}

const layerFor = (which) =>
    (which === 'draw' ? drawLayer : which === 'smooth' ? smoothMask : layer);

/** A stroke on one of the two block layers. */
const strokeEntry = (which) => ({
    kind: 'stroke',
    undo: () => { layerFor(which).undo(); repaintBrush(); },
    redo: () => { layerFor(which).redo(); repaintBrush(); },
});

/**
 * Forget stroke steps, keeping everything else.
 *
 * Called when the block grid changes, which wipes both layers and with them
 * every offset those steps referred to. A stroke step whose layer has been
 * reset would undo nothing at all, which is worse than not offering it.
 */
function dropStrokeHistory() {
    for (const stack of [history, future]) {
        const kept = stack.filter((e) => e.kind !== 'stroke');
        stack.length = 0;
        stack.push(...kept);
    }
    syncHistoryButtons();
}

function undoStep() {
    const entry = history.pop();
    if (!entry) return;
    entry.undo();
    future.push(entry);
    syncHistoryButtons();
}

function redoStep() {
    const entry = future.pop();
    if (!entry) return;
    entry.redo();
    history.push(entry);
    syncHistoryButtons();
}

/** Whichever tool owns the pointer right now, or null if neither does. */
function activeTool() {
    const d = drawSettings();
    if (d.on) return { kind: 'draw', shape: d.shape, size: d.size };
    const sb = smoothBrush();
    if (sb.on) return { kind: 'smooth', shape: sb.shape, size: sb.size };
    const b = brushSettings();
    if (b.on) return { kind: 'brush', shape: b.shape, size: b.size };
    return null;
}

/**
 * A line from the finger to where the stroke is actually landing.
 *
 * Without it a reach offset is baffling: the stroke appears somewhere the
 * pointer is not, with nothing to connect the two.
 */
function drawReachLine(ctx, raw) {
    const off = toolOffsetPx();
    if (!off || !raw || !activeTool()) return;
    const r = $('ph-canvas').getBoundingClientRect();
    const x = raw.x - r.left, y = raw.y - r.top;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + off);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

/** Outline the blocks the active tool is about to cover, in view coordinates. */
function drawBrushCursor(ctx, g, at) {
    const b = activeTool();
    if (!b || !at) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    // Solid for drawing: that stroke lands exactly where the outline is, so it
    // should not look as provisional as a nudge does.
    if (b.kind === 'draw') ctx.setLineDash([]);
    // One rectangle around the stamp's bounding box rather than an outline per
    // block: at size 64 that is 4,000 strokes a frame for no extra information.
    const r = (Math.max(1, b.size) - 1) / 2;
    const w = b.shape === 'vline' ? 1 : Math.max(1, Math.round(b.size));
    const h = b.shape === 'hline' ? 1 : Math.max(1, Math.round(b.size));
    ctx.strokeRect(
        g.panX + (at.bx - Math.floor(r) * (b.shape === 'vline' ? 0 : 1)) * g.px,
        g.panY + (at.by - Math.floor(r) * (b.shape === 'hline' ? 0 : 1)) * g.px,
        w * g.px, h * g.px,
    );
    ctx.restore();
}

/* ---------------------------------------------------------------- draw */

/**
 * The colour chooser: every colour in the palette, with the divider shown, so
 * it is clear which ones drawing added and which ones matching can also use.
 */
function renderDrawSwatches() {
    const wrap = $('ph-draw-swatches');
    if (!wrap) return;
    const name = $('ph-palette').value;
    const colors = getPaletteHexes(name);
    const boundary = colors.length - getAddedCount(name);
    wrap.innerHTML = '';

    colors.forEach((hex, i) => {
        if (i === boundary && getAddedCount(name) > 0 && boundary > 0) {
            const div = document.createElement('i');
            div.className = 'swatch-div';
            div.title = 'Colours after this line are for drawing only — never matched to';
            wrap.appendChild(div);
        }
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'swatch';
        sw.style.background = hex;
        sw.title = hex + (i >= boundary ? ' (draw only)' : '');
        sw.setAttribute('aria-pressed', String(drawColor === hexToPacked(hex)));
        sw.addEventListener('click', () => selectDrawColor(hexToPacked(hex), hex));
        wrap.appendChild(sw);
    });
}

function selectDrawColor(packed, label) {
    drawColor = packed;
    $('ph-draw-current').textContent = packed === 0
        ? 'Eraser — puts blocks back under the palette matcher.'
        : `Drawing with ${label}.`;
    $('ph-draw-erase').setAttribute('aria-pressed', String(packed === 0));
    renderDrawSwatches();
}

function initDraw() {
    for (const btn of $('ph-draw-shapes').querySelectorAll('.shape')) {
        btn.addEventListener('click', () => {
            for (const other of $('ph-draw-shapes').querySelectorAll('.shape')) {
                other.setAttribute('aria-pressed', String(other === btn));
            }
            view.redraw();
        });
    }
    bindSlider('ph-draw-size', 'ph-draw-size-val', () => view.redraw());

    $('ph-draw-erase').addEventListener('click', () => selectDrawColor(0, 'eraser'));

    $('ph-draw-new').addEventListener('click', () => {
        const panel = $('ph-draw-create');
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden') && !drawPicker) {
            drawPicker = createColorPicker($('ph-draw-picker'), { initial: '#FF0000' });
        }
    });

    $('ph-draw-add').addEventListener('click', () => {
        const name = $('ph-palette').value;
        const hex = (drawPicker?.getHex() ?? '#FF0000').toUpperCase();
        if (addHandColor(name, hex)) {
            log(`Added ${hex} to "${name}" for drawing.`, 'good');
        } else {
            log(`${hex} is already in "${name}".`);
        }
        // Selected either way: asking for a colour and being given nothing
        // because it happened to exist already is not a useful outcome.
        selectDrawColor(hexToPacked(hex), hex);
        $('ph-draw-create').classList.add('hidden');
    });

    confirmButton('ph-draw-clear', 'Press again to clear', () => {
        if (drawLayer.clear()) { repaintBrush(); pushHistory(strokeEntry('draw')); log('Cleared all drawing.'); }
    });

    onPalettesChanged(renderDrawSwatches);
    $('ph-palette').addEventListener('change', renderDrawSwatches);
    renderDrawSwatches();
}

/* ----------------------------------------------------------------- rgb */

/** Put the three sliders back, and repaint. */
function setRgbOffsets([r, g, b]) {
    $('ph-r').value = String(r); $('ph-g').value = String(g); $('ph-b').value = String(b);
    $('ph-r-val').textContent = String(r);
    $('ph-g-val').textContent = String(g);
    $('ph-b-val').textContent = String(b);
    render();
}

function initRgbButtons() {
    /**
     * Reset is undoable, so it joins the same history as everything else.
     *
     * It is not a stroke, so it is not tagged as one: a change of block grid
     * wipes stroke steps, and there is no reason losing the grid should also
     * lose the fact that the offsets were reset.
     */
    $('ph-rgb-reset').addEventListener('click', () => {
        const before = rgbOffsets();
        if (before.every((v) => v === 0)) { log('The offsets are already at 0.'); return; }
        setRgbOffsets([0, 0, 0]);
        pushHistory({
            kind: 'settings',
            undo: () => setRgbOffsets(before),
            redo: () => setRgbOffsets([0, 0, 0]),
        });
        log(`Reset the RGB offsets from ${before.join(', ')}.`);
    });

    // Held, not toggled: a comparison you have to keep holding cannot be left
    // switched on by accident and mistaken for the real thing.
    const btn = $('ph-rgb-compare');
    const show = (neutral) => {
        if (compareNeutral === neutral) return;
        compareNeutral = neutral;
        btn.classList.toggle('on-toggle', neutral);
        render();
    };
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); show(true); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) {
        btn.addEventListener(ev, () => show(false));
    }
}

/* ---------------------------------------------------------------- crop */

const cropOn = () => $('ph-crop-on').checked && Boolean(originalImgData);
const cropSrc = () => ({ w: originalImgData.width, h: originalImgData.height });

/** Screen pixels per source pixel, for sizing the grab tolerance. */
function cropScale() {
    const g = view.geometry();
    return g ? g.drawnW / originalImgData.width : 1;
}

function pointerToSource(e) {
    const f = view.toFraction(e.clientX, e.clientY);
    if (!f) return null;
    const src = cropSrc();
    return { x: f.fx * src.w, y: f.fy * src.h };
}

/**
 * Draw the selection over the preview: everything outside dimmed, the edges
 * marked, and a handle at each corner and each side's midpoint.
 *
 * Drawn in view coordinates from the crop's own fractions, so it stays put
 * under zoom and pan without the crop needing to know either exists.
 */
function drawCropOverlay(ctx, g) {
    if (!cropOn() || !cropRect) return;
    const src = cropSrc();
    const x = g.panX + (cropRect.x / src.w) * g.drawnW;
    const y = g.panY + (cropRect.y / src.h) * g.drawnH;
    const w = (cropRect.w / src.w) * g.drawnW;
    const h = (cropRect.h / src.h) * g.drawnH;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(g.panX, g.panY, g.drawnW, g.drawnH);
    ctx.rect(x, y, w, h);
    ctx.fill('evenodd');

    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // Thirds: the one guide that helps place a crop and costs nothing to draw.
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
        ctx.moveTo(x + (w * i) / 3, y); ctx.lineTo(x + (w * i) / 3, y + h);
        ctx.moveTo(x, y + (h * i) / 3); ctx.lineTo(x + w, y + (h * i) / 3);
    }
    ctx.stroke();

    const s = 5;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    for (const [hx, hy] of [
        [x, y], [x + w / 2, y], [x + w, y],
        [x, y + h / 2], [x + w, y + h / 2],
        [x, y + h], [x + w / 2, y + h], [x + w, y + h],
    ]) {
        ctx.fillRect(hx - s, hy - s, s * 2, s * 2);
        ctx.strokeRect(hx - s + 0.5, hy - s + 0.5, s * 2 - 1, s * 2 - 1);
    }
    ctx.restore();
}

function paintCropReadout() {
    if (!cropRect) { $('ph-crop-size').textContent = ''; return; }
    const out = crop.outputSize(cropRect, { w: $('ph-crop-ow').value, h: $('ph-crop-oh').value });
    const r = crop.formatRatio(crop.ratioOf(cropRect));
    $('ph-crop-size').textContent = out.resampled
        ? `${cropRect.w} x ${cropRect.h} -> ${out.w} x ${out.h} · ${r}`
        : `${cropRect.w} x ${cropRect.h} · ${r}`;
    if (document.activeElement !== $('ph-crop-ratio')) $('ph-crop-ratio').value = r;
    $('ph-crop-ratio-note').textContent = cropLock
        ? `Locked to ${crop.formatRatio(cropLock)} — resizing keeps this shape.`
        : 'Free — each edge moves on its own.';
    $('ph-crop-lock').setAttribute('aria-pressed', String(Boolean(cropLock)));
}

function setCropRect(next) {
    cropRect = next;
    paintCropReadout();
    view.redraw();
}

/** The status line describes the image being worked on, not the file. */
function paintInfo() {
    if (!imgData) return;
    const cropped = committedRect && originalImgData
        && (imgData.width !== originalImgData.width || imgData.height !== originalImgData.height);
    $('ph-info').textContent = `${sourceName} — ${imgData.width} x ${imgData.height}`
        + (cropped ? ` (cropped from ${originalImgData.width} x ${originalImgData.height})` : '');
}

/**
 * Swap in a different working image, undoably.
 *
 * A crop changes the block grid, which invalidates the brush and draw layers
 * and every stroke recorded against them — those offsets were placed on a grid
 * that no longer exists. So this is a checkpoint: the finer history is cleared
 * and replaced by one step that puts the whole picture back, buffers included.
 * Undoing a crop returns your pixels; it does not return the stroke-by-stroke
 * history from before it, because there is no grid left to replay it onto.
 */
function commitImage(nextImg, nextRect, label) {
    const prev = {
        img: imgData, rect: committedRect,
        deltas: layer.deltas.slice(), cells: drawLayer.cells.slice(),
        bw: layer.width, bh: layer.height,
    };

    const put = async (img, rect, buffers) => {
        imgData = img;
        committedRect = rect;
        setSubject(imgData);
        base = null; baseKey = '';
        blocks.resync();
        view.reset();
        // Awaited: render() is what resizes the layers, so anything written
        // into them before it lands would be thrown away.
        await render();
        if (buffers && layer.width === buffers.bw && layer.height === buffers.bh) {
            layer.deltas.set(buffers.deltas);
            drawLayer.cells.set(buffers.cells);
            repaintBrush();
        }
        paintInfo();
        paintCropReadout();
    };

    (async () => {
        await put(nextImg, nextRect, null);

        const next = {
            img: nextImg, rect: nextRect,
            deltas: layer.deltas.slice(), cells: drawLayer.cells.slice(),
            bw: layer.width, bh: layer.height,
        };

        // Pushed after the render, so the stroke-history sweep it triggers
        // cannot arrive later and remove this step.
        pushHistory({
            kind: 'image',
            undo: () => put(prev.img, prev.rect, prev),
            redo: () => put(next.img, next.rect, next),
        });
        if (label) log(label, 'good');
    })();
}

function setCropLock(ratio) {
    cropLock = ratio;
    if (ratio && cropRect) {
        const src = cropSrc();
        cropRect = crop.toRatio(cropRect, ratio, src.w, src.h);
    }
    paintCropReadout();
    view.redraw();
}

/** Rebuild the working image from the original through the current selection. */
function applyCrop() {
    if (!originalImgData || !cropRect) return;
    const out = crop.outputSize(cropRect, { w: $('ph-crop-ow').value, h: $('ph-crop-oh').value });

    const full = document.createElement('canvas');
    full.width = originalImgData.width;
    full.height = originalImgData.height;
    full.getContext('2d').putImageData(originalImgData, 0, 0);

    const dest = document.createElement('canvas');
    dest.width = out.w; dest.height = out.h;
    const dctx = dest.getContext('2d', { willReadFrequently: true });
    // Smoothing on: this is a resample of a photograph, not of block art. The
    // pixelation happens afterwards, from whatever this produces.
    dctx.imageSmoothingEnabled = true;
    dctx.imageSmoothingQuality = 'high';
    dctx.drawImage(full, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, out.w, out.h);

    // Crop mode ends on apply: the selection is now committed, and leaving the
    // overlay up over a picture it no longer describes would be a lie.
    $('ph-crop-on').checked = false;
    $('ph-crop-tool').classList.remove('on-toggle');
    paintFlags();

    commitImage(dctx.getImageData(0, 0, out.w, out.h), { ...cropRect },
        `Cropped to ${cropRect.w}x${cropRect.h}` +
        (out.resampled ? `, resampled to ${out.w}x${out.h}.` : '.'));
}

function resetCrop() {
    if (!originalImgData) return;
    const src = { w: originalImgData.width, h: originalImgData.height };
    cropRect = { x: 0, y: 0, w: src.w, h: src.h };
    commitImage(originalImgData, null, 'Back to the full image.');
}

/* --------------------------------------------------------- active flags */

/**
 * Show a chip on the picture for every tool that is currently on.
 *
 * Read from the checkboxes rather than tracked alongside them, because they are
 * turned off from several places — the exclusivity rule, applying a crop, a
 * fresh image — and a mirror of that state would be one more thing to remember
 * to update. Repainting the lot costs four attribute writes.
 */
function paintFlags() {
    for (const flag of document.querySelectorAll('#ph-flags .flag')) {
        flag.hidden = !$(flag.dataset.flag)?.checked;
    }
}

/** Each chip opens the panel it came from, which is where its off switch is. */
function initFlags() {
    for (const flag of document.querySelectorAll('#ph-flags .flag')) {
        const tool = $(flag.dataset.opens);
        if (!tool) continue;
        // The <span>, not the button: the icon painted into it carries an SVG
        // <title> of its own, and textContent would read both of them.
        const name = flag.querySelector('span')?.textContent.trim() ?? 'This tool';
        flag.title = `${name} is on — open its settings`;
        flag.setAttribute('aria-label', `${name} is on. Open its settings.`);
        // Press the tool itself rather than reaching into popover.js: the tool
        // owns the panel, and going through it keeps one path for opening one.
        flag.addEventListener('click', () => tool.click());
    }
    paintFlags();
}

/** All the crop cursor classes, so setting one can clear the rest. */
const CROP_CURSORS = ['crop-move', 'crop-moving', 'crop-n', 'crop-s', 'crop-e', 'crop-w',
                      'crop-nw', 'crop-ne', 'crop-sw', 'crop-se'];

/**
 * Show what the pointer would do before it is pressed.
 *
 * A crop rectangle has nine different behaviours depending on a few pixels of
 * position, and without a cursor the only way to find out which one is under
 * the hand is to try it and see what moves.
 */
function paintCropCursor(e) {
    const canvas = $('ph-canvas');
    canvas.classList.remove(...CROP_CURSORS);
    if (!cropOn() || !cropRect) return;

    if (cropDrag) {
        canvas.classList.add(cropDrag.handle === 'move' ? 'crop-moving' : `crop-${cropDrag.handle}`);
        return;
    }
    const p = pointerToSource(e);
    if (!p) return;
    const handle = crop.hitTest(cropRect, p.x, p.y, Math.max(6, 12 / cropScale()));
    if (handle) canvas.classList.add(handle === 'move' ? 'crop-move' : `crop-${handle}`);
}

function initCrop() {
    $('ph-canvas').addEventListener('pointermove', paintCropCursor);
    $('ph-canvas').addEventListener('pointerleave',
        () => $('ph-canvas').classList.remove(...CROP_CURSORS));

    $('ph-crop-on').addEventListener('change', () => {
        const on = $('ph-crop-on').checked;
        $('ph-crop-tool').classList.toggle('on-toggle', on);

        if (on && originalImgData) {
            // Which tool owns the pointer is settled in one place, in initBrush.
            const src = cropSrc();
            if (!cropRect) cropRect = { x: 0, y: 0, w: src.w, h: src.h };

            // Cropping again works on the whole photo with the previous
            // selection still drawn on it. A crop of a crop would compound the
            // resampling and could never widen — and the overlay is measured
            // against the original, so it would not even line up.
            if (imgData !== originalImgData) {
                if (committedRect) cropRect = crop.clampInside(committedRect, src.w, src.h);
                imgData = originalImgData;
                setSubject(imgData);
                base = null; baseKey = '';
                blocks.resync();
                view.reset();
                render();
                log('Showing the full photo — the last crop is where it was left.');
            }
        }
        paintInfo();
        paintCropReadout();
        view.redraw();
    });

    for (const btn of $('ph-crop-presets').querySelectorAll('.shape')) {
        btn.addEventListener('click', () => {
            for (const o of $('ph-crop-presets').querySelectorAll('.shape')) {
                o.setAttribute('aria-pressed', String(o === btn));
            }
            const spec = btn.dataset.ratio;
            if (spec === 'free') { setCropLock(null); return; }
            const r = crop.parseRatio(spec);
            if (!r || !originalImgData) return;
            const src = cropSrc();
            cropRect = crop.largestRect(r, src.w, src.h);
            setCropLock(r);
        });
    }

    $('ph-crop-ratio').addEventListener('change', () => {
        const r = crop.parseRatio($('ph-crop-ratio').value);
        if (!r) { paintCropReadout(); log('That ratio could not be read — try 16:9.', 'err'); return; }
        setCropLock(r);
    });

    $('ph-crop-lock').addEventListener('click', () => {
        if (cropLock) setCropLock(null);
        else setCropLock(cropRect ? crop.ratioOf(cropRect) : 1);
    });

    // A typed output size implies its own ratio; leaving them blank implies none.
    const onOutput = () => {
        const w = Number($('ph-crop-ow').value), h = Number($('ph-crop-oh').value);
        if (w >= 1 && h >= 1) setCropLock(w / h); else paintCropReadout();
    };
    $('ph-crop-ow').addEventListener('change', onOutput);
    $('ph-crop-oh').addEventListener('change', onOutput);

    $('ph-crop-apply').addEventListener('click', applyCrop);
    $('ph-crop-reset').addEventListener('click', resetCrop);
}

function initBrush() {
    let hover = null;         // the block the stroke would land on
    let hoverRaw = null;      // where the pointer actually is, for the reach line

    /** The block a pointer event targets, once the reach offset is applied. */
    const toolBlock = (e) => view.toBlock(e.clientX, e.clientY + toolOffsetPx());

    view.setOverlay((ctx, g) => {
        drawReachLine(ctx, hoverRaw);
        drawBrushCursor(ctx, g, hover);
        drawCropOverlay(ctx, g);
    });

    let mode = null;              // which tool owns the stroke in progress

    const paintBrush = (at) => {
        const b = brushSettings();
        if (b.delta.every((d) => d === 0)) return;
        if (layer.stamp(at.bx, at.by, b.shape, b.size, b.delta)) repaintBrush();
    };

    /** Full strength: how much smoothing there is, is the filter's business. */
    const paintSmooth = (at) => {
        const sb = smoothBrush();
        if (smoothMask.stamp(at.bx, at.by, sb.shape, sb.size, 100)) repaintBrush();
    };

    const paintDraw = (at) => {
        const d = drawSettings();
        if (drawColor === null) return;      // nothing chosen yet
        if (drawLayer.stamp(at.bx, at.by, d.shape, d.size, drawColor)) repaintBrush();
    };

    const paintAt = (at) => (mode === 'draw' ? paintDraw(at)
                           : mode === 'smooth' ? paintSmooth(at)
                           : paintBrush(at));

    /* --- the smoothing filter, and the brush mode that applies it --- */

    const SMODE_NOTES = {
        despeckle: 'Median. Removes an isolated block outright and leaves edges where they are '
                 + '— the one for a sky with stray specks in it.',
        soften: 'Distance-weighted average. Reduces detail everywhere, edges included.',
    };
    const paintSmoothPanel = () => {
        const sm = smoothSettings();
        $('ph-smode-note').textContent = SMODE_NOTES[sm.mode] ?? '';
        // The ceiling is a property of the grid, not a fixed number.
        if (base) $('ph-sradius').max = String(maxSize(surfaceW, surfaceH) - 1);
        const [wx, wy] = windowFor(sm.size, sm.shape);
        $('ph-sradius-val').textContent = `${wx} x ${wy}`;
        setStrengthActive('ph-sstrength', sm.size > 1);
    };
    for (const btn of $('ph-smode').querySelectorAll('.shape')) {
        btn.addEventListener('click', () => {
            for (const o of $('ph-smode').querySelectorAll('.shape')) {
                o.setAttribute('aria-pressed', String(o === btn));
            }
            paintSmoothPanel();
            scheduleRender();
        });
    }
    // paintSmoothPanel too: the radius is what decides whether strength has
    // anything to act on, so moving it has to re-evaluate that.
    bindSlider('ph-sradius', 'ph-sradius-val', () => { paintSmoothPanel(); scheduleRender(); });
    for (const btn of $('ph-sshape').querySelectorAll('.shape')) {
        btn.addEventListener('click', () => {
            for (const o of $('ph-sshape').querySelectorAll('.shape')) {
                o.setAttribute('aria-pressed', String(o === btn));
            }
            paintSmoothPanel();
            scheduleRender();
        });
    }
    bindSlider('ph-sstrength', 'ph-sstrength-val', scheduleRender);
    paintSmoothPanel();

    for (const btn of $('ph-smooth-shapes').querySelectorAll('.shape')) {
        btn.addEventListener('click', () => {
            for (const o of $('ph-smooth-shapes').querySelectorAll('.shape')) {
                o.setAttribute('aria-pressed', String(o === btn));
            }
            view.redraw();
        });
    }
    bindSlider('ph-smooth-size', 'ph-smooth-size-val', () => view.redraw());

    // Four tools, one pointer: turning any on turns the others off.
    const TOOLS = ['ph-brush-on', 'ph-draw-on', 'ph-smooth-brush-on', 'ph-crop-on'];
    const TOOL_BUTTONS = {
        'ph-brush-on': 'ph-brush-tool', 'ph-draw-on': 'ph-draw-tool',
        'ph-smooth-brush-on': 'ph-smooth-tool', 'ph-crop-on': 'ph-crop-tool',
    };
    for (const id of TOOLS) {
        $(id).addEventListener('change', () => {
            if ($(id).checked) {
                for (const other of TOOLS) {
                    if (other === id) continue;
                    $(other).checked = false;
                    const btn = TOOL_BUTTONS[other];
                    if (btn) $(btn).classList.remove('on-toggle');
                }
            }
            const own = TOOL_BUTTONS[id];
            if (own) $(own).classList.toggle('on-toggle', $(id).checked);
            paintFlags();
            view.redraw();
        });
    }
    initFlags();

    confirmButton('ph-smooth-clear', 'Press again to clear', () => {
        if (smoothMask.clear()) {
            repaintBrush();
            pushHistory(strokeEntry('smooth'));
            log('Cleared the painted smoothing.');
        }
    });

    view.bindGestures({
        active: () => Boolean(base)
            && (cropOn() || brushSettings().on || drawSettings().on || smoothBrush().on),
        // Crop handles sit on the very edge of the image, and the one at the
        // corner is half outside it, so crop takes a press wherever it lands.
        // Crop handles sit on the edge, and a reach offset means the finger is
        // deliberately somewhere other than the target, so neither can require
        // the press itself to land on a block.
        anywhere: () => cropOn() || toolOffsetPx() !== 0,

        start: (at, e) => {
            if (cropOn()) {
                const p = pointerToSource(e);
                if (!p || !cropRect) return;
                const tol = Math.max(6, 12 / cropScale());
                const handle = crop.hitTest(cropRect, p.x, p.y, tol);
                if (!handle) return;
                mode = 'crop';
                cropDrag = { handle, startRect: { ...cropRect }, startX: p.x, startY: p.y };
                return;
            }
            const target = toolBlock(e);
            if (!target) return;
            painting = true;
            hover = target;
            hoverRaw = { x: e.clientX, y: e.clientY };
            mode = drawSettings().on ? 'draw'
                 : smoothBrush().on ? 'smooth' : 'brush';
            layerFor(mode).begin();
            paintAt(target);
        },

        move: (at, e) => {
            if (mode === 'crop') {
                const p = pointerToSource(e);
                if (!p || !cropDrag) return;
                const src = cropSrc();
                setCropRect(cropDrag.handle === 'move'
                    ? crop.moveRect(cropDrag.startRect, p.x - cropDrag.startX,
                                    p.y - cropDrag.startY, src.w, src.h)
                    : crop.dragHandle(cropDrag.startRect, cropDrag.handle, p.x, p.y,
                                      { ratio: cropLock, srcW: src.w, srcH: src.h }));
                return;
            }
            hover = toolBlock(e);
            hoverRaw = { x: e.clientX, y: e.clientY };
            if (painting && hover) paintAt(hover); else view.redraw();
        },

        end: () => {
            if (mode === 'crop') {
                // One undo step per gesture, not per pointermove.
                if (cropDrag) {
                    const before = cropDrag.startRect, after = { ...cropRect };
                    const moved = before.x !== after.x || before.y !== after.y
                        || before.w !== after.w || before.h !== after.h;
                    if (moved) {
                        pushHistory({
                            kind: 'crop',
                            undo: () => setCropRect(before),
                            redo: () => setCropRect(after),
                        });
                    }
                }
                cropDrag = null; mode = null;
                return;
            }
            painting = false;
            if (mode && layerFor(mode).end()) pushHistory(strokeEntry(mode));
            mode = null;
        },
    });

    // The dashed outline should follow the pointer even when not painting, so
    // the size slider can be judged before committing to a stroke.
    $('ph-canvas').addEventListener('pointermove', (e) => {
        if (!activeTool()) return;
        const at = toolBlock(e);
        if (at?.bx !== hover?.bx || at?.by !== hover?.by) {
            hover = at;
            hoverRaw = { x: e.clientX, y: e.clientY };
            view.redraw();
        }
    });
    $('ph-canvas').addEventListener('pointerleave', () => {
        hover = null; hoverRaw = null; view.redraw();
    });

    bindSlider('ph-tool-offset', 'ph-tool-offset-val', () => view.redraw());

    for (const btn of $('ph-brush-shapes').querySelectorAll('.shape')) {
        btn.addEventListener('click', () => {
            for (const other of $('ph-brush-shapes').querySelectorAll('.shape')) {
                other.setAttribute('aria-pressed', String(other === btn));
            }
            view.redraw();
        });
    }

    bindSlider('ph-brush-size', 'ph-brush-size-val', () => view.redraw());
    bindSlider('ph-brush-r', 'ph-brush-r-val');
    bindSlider('ph-brush-g', 'ph-brush-g-val');
    bindSlider('ph-brush-b', 'ph-brush-b-val');

    $('ph-undo').addEventListener('click', undoStep);
    $('ph-redo').addEventListener('click', redoStep);

    /**
     * Ctrl+Z and Ctrl+Shift+Z, plus Ctrl+Y for the Windows habit.
     *
     * Bound on the document rather than the canvas because the canvas is rarely
     * what has focus — the last thing pressed is usually a slider or a tool
     * button — and an undo shortcut that depends on where the focus happens to
     * be is one nobody can rely on. Ignored while typing, so Ctrl+Z still means
     * "undo my typing" inside a field, and ignored outside the Photo screen,
     * where these layers are not what is on show.
     */
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        if ($('app').dataset.mode !== 'photo') return;
        const el = document.activeElement;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) { e.preventDefault(); undoStep(); }
        else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redoStep(); }
    });
    confirmButton('ph-brush-clear', 'Press again to clear', () => {
        if (layer.clear()) { repaintBrush(); pushHistory(strokeEntry('brush')); log('Cleared all brushwork.'); }
    });
    $('ph-fit').addEventListener('click', () => view.reset());
}

/* ---------------------------------------------------------------- init */

export function init() {
    /**
     * Repaint when the palette itself changes, not only when a different one is
     * chosen.
     *
     * Adding a colour, removing one, or mixing one in the draw panel all change
     * what the picture should look like. Without this the canvas kept showing
     * the previous palette until some unrelated control was touched, which
     * reads as the edit having done nothing.
     */
    onPalettesChanged((palettes) => {
        fillPaletteSelect($('ph-palette'), palettes);
        scheduleRender();
    });
    attachPalettePicker('ph-palette');

    layer = createBrushLayer(1, 1);
    drawLayer = createDrawLayer(1, 1);
    // The smoothing mask is a grid of 0-100 per block, which is exactly what
    // the draw layer already is minus the meaning of the number.
    smoothMask = createDrawLayer(1, 1);
    view = createView($('ph-canvas'), () => (base ? { canvas: surface, w: surfaceW, h: surfaceH } : null));

    blocks = linkBlockSliders({
        wId: 'ph-bw', wValId: 'ph-bw-val', hId: 'ph-bh', hValId: 'ph-bh-val',
        wNumId: 'ph-bw-num', hNumId: 'ph-bh-num',
        badgeId: 'ph-blocks',
        getSourceSize: () => (imgData ? { w: imgData.width, h: imgData.height } : null),
        onChange: scheduleRender,
    });

    bindSlider('ph-r', 'ph-r-val', scheduleRender);
    bindSlider('ph-g', 'ph-g-val', scheduleRender);
    bindSlider('ph-b', 'ph-b-val', scheduleRender);
    initRgbButtons();
    $('ph-palette').addEventListener('change', scheduleRender);

    initBrush();
    initDraw();
    initCrop();

    $('ph-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            sourceName = file.name.replace(/\.[^.]+$/, '');
            imgData = await fileToImageData(file);
            originalImgData = imgData;  // crops are always taken from this, never from a crop
            setMediaLoaded('photo', true);
            cropRect = { x: 0, y: 0, w: imgData.width, h: imgData.height };
            committedRect = null;
            setSubject(imgData);        // the Palettes screen previews against it too
            base = null; baseKey = '';  // a new image invalidates everything downstream
            paintInfo();
            $('ph-empty').classList.add('hidden');
            $('ph-canvas').classList.remove('hidden');
            blocks.resync();            // new aspect ratio: recompute the locked dimension
            view.reset();
            paintCropReadout();
            log(`Loaded ${file.name} (${imgData.width}x${imgData.height}).`);
            render();
        } catch (err) {
            log(`Could not read that image: ${err.message}`, 'err');
        }
    });

    $('ph-run').addEventListener('click', render);

    // Render only earns a place in the bar when live preview is off. With it on
    // — the default — every change is already on screen by the time you could
    // reach the button, so it would do nothing but redraw what you are looking
    // at. It comes back for the slow-device case the toggle exists to serve.
    const syncRunButton = () => $('ph-run').classList.toggle('hidden', $('ph-live').checked);
    $('ph-live').addEventListener('change', () => {
        syncRunButton();
        scheduleRender();          // switching live back on should catch up at once
    });
    syncRunButton();

    $('ph-save').addEventListener('click', () => {
        // Exported from the block surface at one screen pixel per source pixel,
        // never from the canvas on screen: that one is showing whatever the
        // zoom happens to be pointed at, which is not what "save" means.
        const out = document.createElement('canvas');
        out.width = imgData ? imgData.width : surfaceW;
        out.height = imgData ? imgData.height : surfaceH;
        const ctx = out.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(surface, 0, 0, out.width, out.height);

        out.toBlob(async (blob) => {
            if (!blob) { log('Export failed — the canvas produced no image.', 'err'); return; }
            try {
                log(await saveBlob(blob, `${sourceName}-pixelated.png`), 'good');
            } catch (err) {
                log(`Could not save the PNG: ${err.message}`, 'err');
            }
        }, 'image/png');
    });

    log('Ready — choose an image.');
}

// Re-exported so tests and the video tab share the aspect helper.
export { blockHeight, SHAPES };
