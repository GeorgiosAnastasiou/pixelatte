// palettes.js — the Palettes screen: create, choose, edit, delete, transfer.
//
// Every palette you have ever made is listed, because a palette you cannot see
// is a palette you will remake by accident. Selection lives here rather than in
// a <select>, and the other screens keep their own dropdowns fed by
// onPalettesChanged.
//
// Destructive actions are undoable exactly once. That is a deliberate ceiling:
// a full history would need a model of what "a step" means across renames,
// imports and colour edits, whereas one snapshot answers the only question
// anyone actually asks — "put that back, I misclicked".

import * as store from './store.js';
import { hexToRgb } from './core.js';
import { createColorPicker } from './colorpicker.js';
import { proximityOrder } from './palette_order.js';
import { $, makeLogger, downloadBlob, setLabel } from './ui.js';

const log = makeLogger('pal-log');

/** How long the undo offer stays up before the change becomes permanent. */
const UNDO_MS = 12000;

let palettes = {};
let selected = null;
let removeMode = false;
let picker = null;

let undoState = null;       // { label, palettes, selected } — one level, no more
let undoTimer = null;

/** Other screens subscribe so their palette dropdowns stay in sync. */
const listeners = new Set();
export const onPalettesChanged = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn(palettes));

/** The Palettes screen's own selection, which drives the preview thumbnail. */
const selectionListeners = new Set();
export const onSelectionChanged = (fn) => selectionListeners.add(fn);
const notifySelection = () => selectionListeners.forEach((fn) => fn(selected));

export const getPalettes = () => palettes;
export const getSelected = () => selected;
export const getPaletteRgb = (name) => (palettes[name] || []).map(hexToRgb).filter(Boolean);

/**
 * Add a palette from elsewhere (the Extract screen). Names are made unique
 * rather than overwriting, so extracting twice never destroys the earlier
 * attempt.
 * @returns {string} the name actually used
 */
export function addPalette(name, hexes) {
    let target = (name || 'Palette').trim() || 'Palette';
    if (palettes[target]) {
        let n = 2;
        while (palettes[`${target} (${n})`]) n++;
        target = `${target} (${n})`;
    }
    palettes[target] = hexes.map((h) => h.toUpperCase());
    persist();
    select(target);
    log(`Added "${target}" with ${hexes.length} colours.`, 'good');
    return target;
}

function persist() {
    if (!store.save(palettes)) log('Could not save — storage is full or blocked.', 'err');
    notify();
}

/* ------------------------------------------------------------------ undo */

/** Snapshot the whole store before a destructive edit. */
function offerUndo(label) {
    undoState = {
        label,
        palettes: JSON.parse(JSON.stringify(palettes)),
        selected,
    };
    $('pal-undo-text').textContent = label;
    $('pal-undo').classList.remove('hidden');

    clearTimeout(undoTimer);
    undoTimer = setTimeout(dismissUndo, UNDO_MS);
}

function dismissUndo() {
    clearTimeout(undoTimer);
    undoState = null;
    $('pal-undo').classList.add('hidden');
}

function undo() {
    if (!undoState) return;
    const { label, palettes: snapshot, selected: was } = undoState;
    palettes = snapshot;
    dismissUndo();
    persist();
    select(was && palettes[was] ? was : Object.keys(palettes)[0] ?? null);
    log(`Undid: ${label.toLowerCase()}`, 'good');
}

/* ------------------------------------------------------------- selection */

function select(name) {
    selected = name && palettes[name] ? name : (Object.keys(palettes)[0] ?? null);
    setRemoveMode(false);
    render();
    notifySelection();
}

/* ------------------------------------------------------------- rendering */

function swatchStrip(colors) {
    const wrap = document.createElement('div');
    wrap.className = 'strip';
    for (const i of proximityOrder(colors)) {
        const s = document.createElement('span');
        s.style.background = colors[i];
        wrap.appendChild(s);
    }
    return wrap;
}

function renderList() {
    const list = $('pal-list');
    list.innerHTML = '';

    const names = Object.keys(palettes);
    // Yours first: the shipped ones are reference material you scroll past, the
    // ones you made are what you came here for.
    const mine = names.filter((n) => !store.isBuiltIn(n));
    const shipped = names.filter((n) => store.isBuiltIn(n));

    $('pal-total').textContent = `${mine.length} yours, ${shipped.length} built in`;

    if (mine.length) {
        list.appendChild(sectionHeading('Your palettes'));
        for (const name of mine) list.appendChild(paletteRow(name));
    }
    if (shipped.length) {
        list.appendChild(sectionHeading('Built in'));
        for (const name of shipped) list.appendChild(paletteRow(name));
    }
}


function sectionHeading(text) {
    const el = document.createElement('p');
    el.className = 'pal-section';
    el.textContent = text;
    return el;
}


function paletteRow(name) {
    const colors = palettes[name];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'pal-row';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(name === selected));

    const label = document.createElement('span');
    label.className = 'pal-row-name';
    label.textContent = name;

    const count = document.createElement('span');
    count.className = 'pal-row-count';
    count.textContent = String(colors.length);

    row.append(swatchStrip(colors), label, count);
    row.addEventListener('click', () => select(name));
    return row;
}

function renderSwatches() {
    const colors = palettes[selected] || [];
    const wrap = $('pal-swatches');
    wrap.innerHTML = '';

    $('pal-selected-name').textContent = selected ?? 'No palette';
    $('pal-count').textContent = `${colors.length} colour${colors.length === 1 ? '' : 's'}`;

    if (!colors.length) {
        const note = document.createElement('div');
        note.className = 'empty-note';
        note.textContent = 'Empty palette — add some colours.';
        wrap.appendChild(note);
        return;
    }

    // Sorted for display, but each swatch remembers the entry it came from, so
    // removing one removes the colour under the finger rather than whichever
    // colour happened to sort into that slot.
    for (const index of proximityOrder(colors)) {
        const color = colors[index];
        const sw = document.createElement('div');
        sw.className = 'swatch';
        sw.style.background = color;
        sw.title = color;
        if (removeMode) {
            const del = document.createElement('button');
            del.className = 'del';
            del.textContent = '×';
            del.setAttribute('aria-label', `Remove ${color}`);
            del.onclick = (e) => {
                e.stopPropagation();
                // Snapshot before the edit, so Undo restores this exact colour
                // at this exact position rather than appending it at the end.
                offerUndo(`Removed ${color}`);
                palettes[selected].splice(index, 1);
                persist();
                render();
                notifySelection();
            };
            sw.appendChild(del);
        } else {
            // Tap a swatch to load it into the picker for tweaking.
            sw.onclick = () => picker?.setHex(color);
        }
        wrap.appendChild(sw);
    }
}

/** Keep the delete panel showing what is currently in the firing line. */
function renderDeletePanel() {
    const colors = palettes[selected] || [];
    const onlyOne = Object.keys(palettes).length <= 1;

    $('pal-delete-name').textContent = selected ?? '—';
    $('pal-delete-count').textContent = String(colors.length);

    const wrap = $('pal-delete-swatches');
    wrap.innerHTML = '';
    for (const i of proximityOrder(colors)) {
        const sw = document.createElement('div');
        sw.className = 'swatch';
        sw.style.background = colors[i];
        wrap.appendChild(sw);
    }

    const btn = $('pal-delete-confirm');
    btn.disabled = !selected || onlyOne;
    setLabel(btn, onlyOne ? 'Keep at least one palette' : 'Delete permanently');
}

function render() {
    renderList();
    renderSwatches();
    renderDeletePanel();
}

function setRemoveMode(on) {
    removeMode = on && Boolean(selected);
    $('pal-remove-mode').classList.toggle('active-toggle', removeMode);
    setLabel('pal-remove-mode', removeMode ? 'Done' : 'Remove');
    renderSwatches();
}

/* ------------------------------------------------------------------ init */

export function init() {
    picker = createColorPicker($('pal-picker-mount'), { initial: '#FF0000' });
    palettes = store.load();
    selected = Object.keys(palettes)[0] ?? null;
    render();
    notify();
    notifySelection();

    $('pal-undo-btn').addEventListener('click', undo);

    $('pal-new').addEventListener('click', () => {
        const name = prompt('Name for the new palette:');
        if (!name) return;
        if (palettes[name]) { alert('A palette with that name already exists.'); return; }
        palettes[name] = [];
        persist();
        select(name);
        log(`Created "${name}".`);
    });

    $('pal-rename').addEventListener('click', () => {
        if (!selected) return;
        const old = selected;
        const name = prompt('New name:', old);
        if (!name || name === old) return;
        if (palettes[name]) { alert('A palette with that name already exists.'); return; }
        // Rebuild in order so the renamed palette keeps its place in the list.
        palettes = Object.fromEntries(
            Object.entries(palettes).map(([k, v]) => (k === old ? [name, v] : [k, v])));
        persist();
        select(name);
        log(`Renamed "${old}" to "${name}".`);
    });

    // Delete is two presses: opening this panel is the first, and the panel
    // names what is about to go. Undo covers the rest.
    $('pal-delete-confirm').addEventListener('click', () => {
        if (!selected) return;
        if (Object.keys(palettes).length <= 1) {
            alert('Keep at least one palette.');
            return;
        }
        const name = selected;
        offerUndo(`Deleted "${name}"`);
        delete palettes[name];
        persist();
        select(null);
        log(`Deleted "${name}".`);
    });

    $('pal-add').addEventListener('click', () => {
        if (!selected) return;
        const color = (picker ? picker.getHex() : '#FF0000').toUpperCase();
        if (palettes[selected].includes(color)) { log(`${color} is already in this palette.`); return; }
        palettes[selected].push(color);
        persist();
        render();
        notifySelection();
    });

    $('pal-remove-mode').addEventListener('click', () => setRemoveMode(!removeMode));

    $('pal-add-list').addEventListener('click', () => {
        if (!selected) return;
        const raw = $('pal-hexlist').value.split(/[,\s]+/).map((c) => c.trim()).filter(Boolean);
        let added = 0, bad = 0;
        for (let c of raw) {
            if (!c.startsWith('#')) c = '#' + c;
            c = c.toUpperCase();
            if (!/^#[0-9A-F]{6}$/.test(c)) { bad++; continue; }
            if (!palettes[selected].includes(c)) { palettes[selected].push(c); added++; }
        }
        persist();
        render();
        notifySelection();
        $('pal-hexlist').value = '';
        log(`Added ${added} colour${added === 1 ? '' : 's'}${bad ? `, skipped ${bad} malformed` : ''}.`);
    });

    // --- export / import ---
    $('pal-export').addEventListener('click', () => {
        downloadBlob(new Blob([store.toJSON(palettes)], { type: 'application/json' }),
            `pixelator-palettes-${new Date().toISOString().slice(0, 10)}.json`);
        log(`Exported ${Object.keys(palettes).length} palettes.`);
    });

    $('pal-import-btn').addEventListener('click', () => $('pal-import').click());
    $('pal-import').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const { merged, added, renamed } = store.mergeImported(palettes, await file.text());
            // An import can bring in a lot at once; make it reversible too.
            offerUndo(`Imported ${added} palette${added === 1 ? '' : 's'}`);
            palettes = merged;
            persist();
            render();
            log(`Imported ${added} palette${added === 1 ? '' : 's'}.` +
                (renamed.length ? ` Renamed to avoid clashes: ${renamed.join(', ')}` : ''), 'good');
        } catch (err) {
            log(`Import failed: ${err.message}`, 'err');
        }
        e.target.value = '';
    });

    log('Ready.');
}
