// ui.js — small shared DOM helpers.

export const $ = (id) => document.getElementById(id);

/**
 * Which screen a log line came from. The four screens used to own four log
 * panels; there is one now, on Settings, so each line carries its origin
 * instead of its position carrying it.
 */
const LOG_TAGS = {
    'pal-log': 'palettes', 'ex-log': 'extract', 'ph-log': 'photo', 'vid-log': 'video',
};

/** Append a line to the shared log. Newest at the top. */
export function makeLogger(source) {
    const tag = LOG_TAGS[source] || source;
    return (msg, kind = '') => {
        if (kind === 'err') console.error(msg); else console.log(msg);
        // Looked up per call: the logger is built at import time, which for a
        // deferred module is after parse, but this keeps it true regardless.
        const el = $('log');
        if (!el) return;
        const line = document.createElement('div');
        if (kind) line.className = kind;
        const label = document.createElement('span');
        label.className = 'tag';
        label.textContent = `${tag} `;
        line.append(label, document.createTextNode(msg));
        el.prepend(line);
        while (el.childElementCount > 200) el.lastElementChild.remove();
    };
}

/**
 * Set a control's visible text without disturbing anything else inside it.
 * Tool-bar buttons hold an <svg> next to their <span>, so assigning
 * textContent — as the old single-element buttons did — would delete the icon.
 */
export function setLabel(el, text) {
    const target = (typeof el === 'string' ? $(el) : el);
    if (!target) return;
    const span = target.querySelector('span');
    if (span) span.textContent = text; else target.textContent = text;
}

/** Wire a range input to its value readout; onChange fires on every input. */
export function bindSlider(sliderId, valueId, onChange) {
    const s = $(sliderId), v = $(valueId);
    const update = () => {
        if (v) v.textContent = s.value;
        if (onChange) onChange(Number(s.value));
    };
    s.addEventListener('input', update);
    if (v) v.textContent = s.value;
    return () => Number(s.value);
}

/** Fill a <select> with palette names, preserving the current choice if possible. */
export function fillPaletteSelect(sel, palettes, preferred) {
    const names = Object.keys(palettes);
    const keep = preferred ?? sel.value;
    sel.innerHTML = '';
    for (const n of names) {
        const o = document.createElement('option');
        o.value = n; o.textContent = `${n} (${palettes[n].length})`;
        sel.appendChild(o);
    }
    if (keep && names.includes(keep)) sel.value = keep;
    else if (names.length) sel.value = names[0];
}

// Saving a blob lives in save.js, not here: it is one call on the web and a
// different one entirely inside the WebView, and leaving a browser-only
// downloadBlob() in the shared helpers is how the Android build ended up with
// three buttons that quietly did nothing.

/**
 * Turn a button into a two-press confirmation.
 *
 * The first press asks, the second acts, and the question withdraws itself
 * after a few seconds so a button left mid-question does not sit there armed.
 * Chosen over a dialog because the action is destructive but small: a modal for
 * clearing a brush layer is more interruption than the risk deserves, while no
 * guard at all makes one stray tap cost every stroke.
 *
 * @param {string} id button id
 * @param {string} question what the armed button says
 * @param {() => void} onConfirm run on the second press
 */
export function confirmButton(id, question, onConfirm) {
    const btn = $(id);
    if (!btn) return;
    const resting = btn.textContent;
    let armed = false;
    let timer = null;

    const disarm = () => {
        armed = false;
        clearTimeout(timer);
        setLabel(btn, resting);
        btn.classList.remove('armed');
    };

    btn.addEventListener('click', () => {
        if (!armed) {
            armed = true;
            setLabel(btn, question);
            btn.classList.add('armed');
            timer = setTimeout(disarm, 5000);
            return;
        }
        disarm();
        onConfirm();
    });

    // An armed button that scrolls out of sight should not stay armed.
    btn.addEventListener('blur', disarm);
}

/**
 * Enable or disable a strength slider that has nothing to act on.
 *
 * At radius 0 the filter is not running, so strength cannot change anything and
 * a live-looking slider would be a lie. It keeps whatever value it was left at
 * rather than snapping back: coming out of radius 0 should restore the setting
 * that was in use, not overwrite it with a default. Fresh launches start at
 * 100 because the markup says so, which is as much memory as this needs.
 */
export function setStrengthActive(id, active) {
    const el = $(id);
    if (!el) return;
    el.disabled = !active;
    el.closest('.field')?.classList.toggle('inert', !active);
    el.title = active ? '' : 'Nothing to apply at radius 0';
}

/** Decode a File into ImageData plus its natural size. */
export async function fileToImageData(file) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Yield to the event loop so progress bars actually repaint. */
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
