// photo.js — the Photo tab. Same pipeline as video, minus the temporal blend.

import { renderStill } from './preview.js';
import { chooseMapper } from './pipeline.js';
import { getPaletteRgb, onPalettesChanged } from './palettes.js';
import { linkBlockSliders } from './blocksize.js';
import { setSubject } from './subject.js';
import { $, makeLogger, bindSlider, fillPaletteSelect, downloadBlob, fileToImageData, nextFrame } from './ui.js';

const log = makeLogger('ph-log');

let imgData = null;       // ImageData of the source, kept for re-renders
let sourceName = 'image';
let renderTimer = null;
let blocks = null;        // aspect-locked width/height pair

const settings = () => ({
    ...blocks.dims(),
    offsets: [Number($('ph-r').value), Number($('ph-g').value), Number($('ph-b').value)],
    paletteName: $('ph-palette').value,
});

/** Debounced re-render so dragging a slider stays responsive. */
function scheduleRender() {
    if (!$('ph-live').checked || !imgData) return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => render(), 120);
}

async function render() {
    if (!imgData) { alert('Choose an image first.'); return; }
    const { bw, bh: wantH, offsets, paletteName } = settings();
    const palette = getPaletteRgb(paletteName);
    if (!palette.length) { log(`Palette "${paletteName}" is empty.`, 'err'); return; }

    const btn = $('ph-run');
    btn.disabled = true;
    await nextFrame();

    try {
        const t0 = performance.now();
        // Threshold on pixels per frame, not palette size — see pipeline.js.
        const { lut } = chooseMapper(palette, bw * (wantH || 1));
        const { bw: obw, bh } = renderStill($('ph-canvas'), imgData,
            { bw, bh: wantH, offsets, palette, lut });

        const ms = performance.now() - t0;
        $('ph-timing').textContent =
            `${imgData.width}x${imgData.height} -> ${obw}x${bh} blocks, ${palette.length} colours, ${ms.toFixed(0)} ms` +
            (lut ? ' (LUT)' : ' (exact match)');
        $('ph-save').disabled = false;
    } catch (err) {
        log(`Render failed: ${err.message}`, 'err');
    } finally {
        btn.disabled = false;
    }
}

export function init() {
    onPalettesChanged((palettes) => fillPaletteSelect($('ph-palette'), palettes));

    blocks = linkBlockSliders({
        wId: 'ph-bw', wValId: 'ph-bw-val', hId: 'ph-bh', hValId: 'ph-bh-val',
        badgeId: 'ph-blocks',
        getSourceSize: () => (imgData ? { w: imgData.width, h: imgData.height } : null),
        onChange: scheduleRender,
    });

    bindSlider('ph-r', 'ph-r-val', scheduleRender);
    bindSlider('ph-g', 'ph-g-val', scheduleRender);
    bindSlider('ph-b', 'ph-b-val', scheduleRender);
    $('ph-palette').addEventListener('change', scheduleRender);

    $('ph-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            sourceName = file.name.replace(/\.[^.]+$/, '');
            imgData = await fileToImageData(file);
            setSubject(imgData);        // the Palettes screen previews against it too
            $('ph-info').textContent = `${file.name} — ${imgData.width} x ${imgData.height}`;
            $('ph-empty').classList.add('hidden');
            $('ph-canvas').classList.remove('hidden');
            blocks.resync();   // new aspect ratio: recompute the locked dimension
            log(`Loaded ${file.name} (${imgData.width}x${imgData.height}).`);
            render();
        } catch (err) {
            log(`Could not read that image: ${err.message}`, 'err');
        }
    });

    $('ph-run').addEventListener('click', render);

    $('ph-save').addEventListener('click', () => {
        $('ph-canvas').toBlob((blob) => {
            if (!blob) { log('Export failed.', 'err'); return; }
            downloadBlob(blob, `${sourceName}-pixelated.png`);
            log('Saved PNG.', 'good');
        }, 'image/png');
    });

    log('Ready — choose an image.');
}
