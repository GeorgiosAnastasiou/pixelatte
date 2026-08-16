// extractui.js — the Extract tab: build a palette from an image, preview it,
// tweak it, and only then save.

import { extractPalette } from './extract.js';
import { kmeans, samplePixels } from './kmeans.js';
import { rgbToHex, mapToPaletteExact, boxDownsample, blockHeight } from './core.js';
import { addPalette } from './palettes.js';
import { setSubject } from './subject.js';
import { $, makeLogger, bindSlider, fileToImageData, nextFrame, setLabel } from './ui.js';

const log = makeLogger('ex-log');

let imgData = null;
let sourceName = 'palette';
let candidate = [];        // [{hex, share}] awaiting save
let removeMode = false;

/** -1 on the separation slider means "auto", derived from the radius. */
const AUTO_SEP = -1;

const readSeparation = () => {
    const v = Number($('ex-sep').value);
    return v === AUTO_SEP ? null : v;
};

function paintRadiusNote() {
    const r = Number($('ex-radius').value);
    $('ex-radius-note').textContent = r === 0
        ? 'Strictest: counts exact colour matches only — the palette is the most literally common colours.'
        : `Each colour scores every pixel within ${r} of it in the RGB cube, so nearby shades reinforce ` +
          `one another instead of competing.`;
}

function paintSepNote() {
    const v = Number($('ex-sep').value);
    $('ex-sep-val').textContent =
        v === AUTO_SEP ? 'auto' : v === 0 ? '0 (off — expect near-duplicates)' : String(v);
}

function renderCandidate() {
    const wrap = $('ex-swatches');
    wrap.innerHTML = '';
    if (!candidate.length) {
        const n = document.createElement('div');
        n.className = 'empty-note';
        n.textContent = 'No palette yet — pick an image and press Extract.';
        wrap.appendChild(n);
        $('ex-breakdown').textContent = '';
        $('ex-save').disabled = true;
        return;
    }

    candidate.forEach((c, i) => {
        const sw = document.createElement('div');
        sw.className = 'swatch';
        sw.style.background = c.hex;
        sw.title = `${c.hex} — ${(c.share * 100).toFixed(1)}% of pixels`;
        if (removeMode) {
            const del = document.createElement('button');
            del.className = 'del';
            del.textContent = '×';
            del.onclick = (e) => { e.stopPropagation(); candidate.splice(i, 1); renderCandidate(); };
            sw.appendChild(del);
        }
        wrap.appendChild(sw);
    });

    $('ex-breakdown').innerHTML = candidate
        .map((c) => `<span class="badge">${c.hex} ${(c.share * 100).toFixed(1)}%</span>`).join(' ');
    $('ex-save').disabled = false;
    applyToSource();
}

/** Show the source image mapped to the candidate palette, so it can be judged. */
function applyToSource() {
    if (!imgData || !candidate.length) return;
    const cv = $('ex-applied');
    const bw = Math.min(320, imgData.width);
    const bh = blockHeight(bw, imgData.width, imgData.height);
    const small = boxDownsample(imgData.data, imgData.width, imgData.height, bw, bh);
    const pal = candidate.map((c) => [
        parseInt(c.hex.slice(1, 3), 16), parseInt(c.hex.slice(3, 5), 16), parseInt(c.hex.slice(5, 7), 16),
    ]);
    const mapped = mapToPaletteExact(small, pal);

    cv.width = bw; cv.height = bh;
    const ctx = cv.getContext('2d');
    const id = ctx.createImageData(bw, bh);
    for (let s = 0, d = 0; s < mapped.length; s += 3, d += 4) {
        id.data[d] = mapped[s]; id.data[d + 1] = mapped[s + 1]; id.data[d + 2] = mapped[s + 2]; id.data[d + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    cv.classList.remove('hidden');
    $('ex-applied-note').textContent =
        `Source mapped to the ${candidate.length} candidate colours (preview at ${bw}x${bh}).`;
}

async function run() {
    if (!imgData) { alert('Choose an image first.'); return; }
    const btn = $('ex-run');
    btn.disabled = true; setLabel(btn, 'Working…');
    await nextFrame();

    try {
        const count = Number($('ex-count').value);
        const method = $('ex-method').value;
        const t0 = performance.now();

        if (method === 'kmeans') {
            const pts = samplePixels(imgData.data);
            log(`k-means++ with k=${count} on ${pts.length.toLocaleString()} sampled pixels…`);
            const centres = kmeans(pts, count);
            candidate = centres.map(([r, g, b]) => ({ hex: rgbToHex(r, g, b), share: 1 / centres.length }));
            $('ex-timing').textContent =
                `k-means++, ${candidate.length} colours, ${Math.round(performance.now() - t0)} ms`;
        } else {
            const radius = Number($('ex-radius').value);
            const minSeparation = readSeparation();
            const r = extractPalette(imgData.data, { count, radius, minSeparation });
            candidate = r.colors.map((c) => ({ hex: rgbToHex(...c.rgb), share: c.share }));
            const sepUsed = minSeparation ?? Math.max(16, radius * 2);
            const memNote = r.mode === 'sums'
                ? `fast path (+${Math.round(r.extraBytes / 1048576)} MB)`
                : 'low-memory path (extra pass)';
            $('ex-timing').textContent =
                `${r.colors.length} of ${count} requested · radius ${radius} · separation ${sepUsed} · ` +
                `${r.distinctBins.toLocaleString()} occupied bins · ${Math.round(r.ms)} ms · ${memNote}`;
            if (r.colors.length < count) {
                log(`Only ${r.colors.length} colours were far enough apart. Lower the minimum ` +
                    `distance to get closer to ${count}.`);
            }
        }

        if (!$('ex-name').value.trim()) $('ex-name').value = sourceName.slice(0, 24);
        removeMode = false;
        $('ex-remove-mode').classList.remove('active-toggle');
        $('ex-remove-mode').textContent = 'Remove…';
        renderCandidate();
        log(`Extracted ${candidate.length} colours.`, 'good');
    } catch (err) {
        log(`Extraction failed: ${err.message}`, 'err');
    } finally {
        btn.disabled = false; setLabel(btn, 'Extract');
    }
}

export function init() {
    bindSlider('ex-count', 'ex-count-val');
    bindSlider('ex-radius', 'ex-radius-val', paintRadiusNote);
    $('ex-sep').addEventListener('input', paintSepNote);
    paintRadiusNote();
    paintSepNote();

    $('ex-method').addEventListener('change', () => {
        const peaks = $('ex-method').value === 'peaks';
        $('ex-peak-controls').classList.toggle('hidden', !peaks);
    });

    $('ex-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            sourceName = file.name.replace(/\.[^.]+$/, '');
            imgData = await fileToImageData(file);
            setSubject(imgData);        // the Palettes screen previews against it too
            // The screen is an upload prompt until there is something to work
            // on; from here the tool bar takes over. See "extract gating" in
            // app.css for the other half of this.
            $('ex-empty').classList.add('hidden');
            $('app').dataset.exReady = '1';
            $('ex-info').textContent =
                `${file.name} — ${imgData.width} x ${imgData.height} ` +
                `(${(imgData.width * imgData.height / 1e6).toFixed(1)} MP)`;

            const cv = $('ex-source');
            const scale = Math.min(1, 420 / imgData.width);
            cv.width = Math.round(imgData.width * scale);
            cv.height = Math.round(imgData.height * scale);
            const tmp = document.createElement('canvas');
            tmp.width = imgData.width; tmp.height = imgData.height;
            tmp.getContext('2d').putImageData(imgData, 0, 0);
            cv.getContext('2d').drawImage(tmp, 0, 0, cv.width, cv.height);
            cv.classList.remove('hidden');

            log(`Loaded ${file.name}.`);
        } catch (err) {
            log(`Could not read that image: ${err.message}`, 'err');
        }
    });

    $('ex-run').addEventListener('click', run);

    $('ex-remove-mode').addEventListener('click', () => {
        removeMode = !removeMode;
        $('ex-remove-mode').classList.toggle('active-toggle', removeMode);
        $('ex-remove-mode').textContent = removeMode ? 'Done removing' : 'Remove…';
        renderCandidate();
    });

    $('ex-save').addEventListener('click', () => {
        if (!candidate.length) return;
        const name = addPalette($('ex-name').value.trim() || sourceName, candidate.map((c) => c.hex));
        log(`Saved as "${name}".`, 'good');
    });

    renderCandidate();
    log('Ready — choose an image.');
}
