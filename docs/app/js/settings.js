// settings.js — the settings panel (currently: appearance).

import { THEMES, apply, save, getPreference, resolve, watchSystem } from './theme.js';
import { $, bindSlider } from './ui.js';
import { getColorModel, setColorModel } from './colorpicker.js';

/**
 * How long the outline of a stamp stays on the picture after it lands, in ms.
 *
 * Lives here rather than in photo.js because it is a preference, and it is read
 * on every stamp rather than passed down, so the value has one home. Kept in a
 * variable as well as in storage: the brush asks for it inside a pointermove
 * handler, and localStorage is not something to touch at that rate.
 */
const MARK_KEY = 'pixelatte-mark-linger';
const MARK_DEFAULT = 300;

let markLinger = (() => {
    try {
        // Tested for null before converting: Number(null) is 0, and 0 is a
        // legitimate stored value here — "never leave a mark" — so coercing
        // first would read a store that has never been written as a deliberate
        // choice to turn the feature off.
        const raw = localStorage.getItem(MARK_KEY);
        if (raw === null) return MARK_DEFAULT;
        const ms = Number(raw);
        return Number.isFinite(ms) && ms >= 0 ? ms : MARK_DEFAULT;
    } catch { return MARK_DEFAULT; }
})();

/** @returns {number} milliseconds; 0 means the mark is not left behind at all. */
export const getMarkLinger = () => markLinger;

function card(theme, activeId, onPick) {
    const el = document.createElement('button');
    el.className = 'theme-card';
    el.type = 'button';
    el.setAttribute('aria-pressed', String(theme.id === activeId));
    el.dataset.theme = theme.id;

    const bars = document.createElement('div');
    bars.className = 'bars';
    for (const c of theme.swatch) {
        const s = document.createElement('span');
        s.style.background = c;
        bars.appendChild(s);
    }

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = theme.name;

    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = theme.note;

    el.append(bars, name, note);
    el.addEventListener('click', () => onPick(theme.id));
    return el;
}

// Settings is a mode in the top bar now, shown and hidden by shell.js, so this
// module only has to render the panel's contents.
export function init() {
    const render = () => {
        const pref = getPreference();
        const activeId = resolve(pref);

        for (const [mode, gridId] of [['dark', 'theme-grid-dark'], ['light', 'theme-grid-light']]) {
            const grid = $(gridId);
            grid.innerHTML = '';
            for (const t of THEMES.filter((x) => x.mode === mode)) {
                grid.appendChild(card(t, activeId, (id) => { save(id); render(); }));
            }
        }

        const active = THEMES.find((t) => t.id === activeId);
        $('theme-current').textContent = pref === 'system'
            ? `Following your system setting — currently ${active.name}.`
            : `Using ${active.name}.`;
        // `on-toggle`, not `active-toggle`: the latter is the red "remove mode"
        // state from the palette editor, and red on a preference reads as a
        // warning rather than as "this is the current choice".
        $('theme-system').setAttribute('aria-pressed', String(pref === 'system'));
        $('theme-system').classList.toggle('on-toggle', pref === 'system');
    };

    $('theme-system').addEventListener('click', () => { save('system'); render(); });

    // --- how long a stamp's outline lingers ---
    const markNote = () => {
        $('mark-linger-note').textContent = markLinger === 0
            ? 'Off — the outline disappears with the finger.'
            : `Each stamp stays outlined for ${(markLinger / 1000).toFixed(1)} seconds.`;
    };
    bindSlider('mark-linger', null, (ms) => {
        markLinger = ms;
        $('mark-linger-val').textContent = (ms / 1000).toFixed(1);
        try { localStorage.setItem(MARK_KEY, String(ms)); } catch { /* session only */ }
        markNote();
    });
    // The slider's markup carries the default; a stored preference overrides it.
    $('mark-linger').value = String(markLinger);
    $('mark-linger-val').textContent = (markLinger / 1000).toFixed(1);
    markNote();

    // --- colour model ---
    const NOTES = {
        rgb: 'Red, green and blue, 0 to 255 — the same axes the palette matcher and the '
           + 'brush work in, so a slider here moves what they move.',
        hsl: 'Hue, saturation and lightness. Better for hunting a colour with no name yet, '
           + 'because sweeping hue at a fixed lightness has no RGB equivalent.',
    };
    const modelRow = $('cp-model');
    const paintModel = () => {
        const active = getColorModel();
        for (const btn of modelRow.querySelectorAll('.shape')) {
            btn.setAttribute('aria-pressed', String(btn.dataset.model === active));
        }
        $('cp-model-note').textContent = NOTES[active] ?? '';
    };
    for (const btn of modelRow.querySelectorAll('.shape')) {
        btn.addEventListener('click', () => { setColorModel(btn.dataset.model); paintModel(); });
    }
    paintModel();

    apply(getPreference());
    render();
    watchSystem(render);
}
