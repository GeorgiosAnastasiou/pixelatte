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
import { $, makeLogger, setLabel } from './ui.js';
import { saveBlob } from './save.js';

const log = makeLogger('pal-log');

/** How long the undo offer stays up before the change becomes permanent. */
const UNDO_MS = 12000;

let palettes = {};
/**
 * Per palette, how many of its last colours were mixed by hand.
 *
 * A palette extracted from a picture says something about that picture. A
 * colour you added afterwards does not, and the strip draws a divider so the
 * two are never confused for one another. Hand-added colours are always
 * appended, so a single count is enough to locate the boundary.
 */
let addedCounts = {};
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
/** How many trailing colours of a palette were added by hand. */
export const getAddedCount = (name) => addedCounts[name] || 0;
/**
 * The colours pixelation is allowed to match against — everything before the
 * divider.
 *
 * A colour mixed to draw one detail must not become a target for the whole
 * image: add a bright pink for a sign and every warm block in the frame starts
 * drifting towards it. Drawing places a colour deliberately, on the blocks you
 * choose; matching would place it everywhere you did not.
 *
 * The exception is a palette with nothing before the divider. A palette built
 * entirely by hand is still a palette, and excluding all of it would leave
 * nothing to match and render a blank frame.
 */
export function matchableHexes(name) {
    const colors = palettes[name] || [];
    const boundary = colors.length - (addedCounts[name] || 0);
    return boundary > 0 ? colors.slice(0, boundary) : colors;
}

export const getPaletteRgb = (name) => matchableHexes(name).map(hexToRgb).filter(Boolean);

/** Every colour, including draw-only ones. What the draw tool offers. */
export const getPaletteHexes = (name) => (palettes[name] || []).slice();

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
    // Drop counts for palettes that no longer exist, and never let a count
    // exceed the palette it describes.
    for (const name of Object.keys(addedCounts)) {
        if (!(name in palettes)) delete addedCounts[name];
        else addedCounts[name] = Math.min(addedCounts[name], palettes[name].length);
    }
    store.saveAdded(addedCounts);
    notify();
}

/**
 * Append a colour and record that it did not come from a picture.
 *
 * Used by the draw tool, which needs somewhere to put a colour you mixed on the
 * spot. Returns false if the palette already had it — the same colour twice
 * would be two entries mapping to one, which is only a way to confuse yourself.
 */
export function addHandColor(name, hex) {
    const target = (hex || '').toUpperCase();
    if (!palettes[name] || !/^#[0-9A-F]{6}$/.test(target)) return false;
    if (palettes[name].includes(target)) return false;
    palettes[name].push(target);
    addedCounts[name] = (addedCounts[name] || 0) + 1;
    persist();
    render();
    notifySelection();
    return true;
}

/** Keep the hand-added count honest when a colour is removed by index. */
function forgetAt(name, index) {
    const n = addedCounts[name] || 0;
    if (n > 0 && index >= palettes[name].length - n) addedCounts[name] = n - 1;
}

/* ------------------------------------------------------------------ undo */

/** Snapshot the whole store before a destructive edit. */
function offerUndo(label) {
    undoState = {
        label,
        palettes: JSON.parse(JSON.stringify(palettes)),
        added: { ...addedCounts },
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
    const { label, palettes: snapshot, added: addedSnapshot, selected: was } = undoState;
    palettes = snapshot;
    addedCounts = { ...addedSnapshot };
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

/**
 * Display order for a palette: picture colours, a divider, then hand-added.
 *
 * Returns positions in the *original* array, never the sorted one. Everything
 * that draws a palette also has to be able to say which entry a swatch is, and
 * removing "the third one on screen" would otherwise delete whichever colour
 * happened to sort into that slot.
 */
function orderedSwatches(colors, added = 0) {
    const boundary = Math.max(0, colors.length - added);
    const out = [];
    const group = (from, to) => {
        const slice = colors.slice(from, to);
        for (const i of proximityOrder(slice)) out.push({ index: from + i });
    };
    group(0, boundary);
    if (added > 0 && boundary > 0) out.push({ divider: true });
    group(boundary, colors.length);
    return out;
}

/**
 * How many swatches a compact strip will show.
 *
 * The strip is a palette's face, not an inventory: the exact count is printed
 * beside it. A 53-colour palette across a fixed 95px gives 1.75px a colour,
 * which is a smear rather than a palette, so beyond this the strip shows an
 * even sample and the full set stays on the editing surface below.
 */
const STRIP_MAX = 24;

/** Every nth item, always keeping the first, the last and the divider. */
function sampleForStrip(items) {
    if (items.length <= STRIP_MAX) return items;
    const dividers = items.filter((it) => it.divider);
    const colours = items.filter((it) => !it.divider);
    const keep = Math.max(1, STRIP_MAX - dividers.length);
    const step = colours.length / keep;
    const picked = [];
    for (let i = 0; i < keep; i++) picked.push(colours[Math.min(colours.length - 1, Math.round(i * step))]);
    // Put the divider back where it was proportionally.
    if (!dividers.length) return picked;
    const at = items.findIndex((it) => it.divider);
    const cut = Math.round((at / items.length) * picked.length);
    return [...picked.slice(0, cut), ...dividers, ...picked.slice(cut)];
}

function dividerEl(className) {
    const el = document.createElement('i');
    el.className = className;
    el.title = 'Colours to the right were mixed by hand, not taken from a picture';
    return el;
}

/**
 * A palette's face: colours from the picture, then a divider, then the ones
 * added by hand.
 *
 * Each group is ordered by proximity within itself rather than the whole strip
 * being sorted, because the divider has to stay at the boundary to mean
 * anything. The strip keeps a fixed width whatever it holds — the swatches get
 * narrower as colours are added instead of the strip getting longer, so a
 * palette occupies the same space in a list however large it grows.
 */
function swatchStrip(colors, added = 0) {
    const wrap = document.createElement('div');
    wrap.className = 'strip';
    for (const item of sampleForStrip(orderedSwatches(colors, added))) {
        if (item.divider) { wrap.appendChild(dividerEl('strip-div')); continue; }
        const s = document.createElement('span');
        s.style.background = colors[item.index];
        wrap.appendChild(s);
    }
    return wrap;
}

function renderList() {
    const list = $('pal-list');
    list.innerHTML = '';

    const names = Object.keys(palettes);
    // Yours first: the shipped ones are reference material to scroll past, the
    // ones made here are what the screen is for.
    const mine = names.filter((n) => !store.isBuiltIn(n));
    const shipped = names.filter((n) => store.isBuiltIn(n));

    $('pal-total').textContent = `${mine.length} yours, ${shipped.length} in the library`;

    if (mine.length) {
        list.appendChild(sectionHeading('Your palettes'));
        for (const name of mine) list.appendChild(paletteRow(name));
    }

    // The library, by group. Thirty-odd shipped palettes under one heading is a
    // list to endure; under four it is a list to browse.
    const byGroup = new Map();
    for (const name of shipped) {
        const g = store.groupOf(name) ?? 'Other';
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g).push(name);
    }
    const ordered = [...store.GROUPS, ...[...byGroup.keys()].filter((g) => !store.GROUPS.includes(g))];
    for (const group of ordered) {
        const inGroup = byGroup.get(group);
        if (!inGroup?.length) continue;
        list.appendChild(sectionHeading(`${group} · ${inGroup.length}`));
        for (const name of inGroup) list.appendChild(paletteRow(name));
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

    row.append(swatchStrip(colors, addedCounts[name] || 0), label, count);
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
    for (const item of orderedSwatches(colors, addedCounts[selected] || 0)) {
        if (item.divider) { wrap.appendChild(dividerEl('swatch-div')); continue; }
        const index = item.index;
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
                forgetAt(selected, index);
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
    for (const el of orderedSwatches(colors, addedCounts[selected] || 0)) {
        if (el.divider) { wrap.appendChild(dividerEl('swatch-div')); continue; }
        const sw = document.createElement('div');
        sw.className = 'swatch';
        sw.style.background = colors[el.index];
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
    addedCounts = store.loadAdded();
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
        if (addedCounts[old] !== undefined) {
            addedCounts[name] = addedCounts[old];
            delete addedCounts[old];
        }
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
        // Added on the palette editor, so it is part of the palette proper and
        // matching may use it. Only the draw tool adds draw-only colours.
        palettes[selected].splice(palettes[selected].length - (addedCounts[selected] || 0), 0, color);
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
            if (!palettes[selected].includes(c)) {
                // Before the divider: pasted lists are palette building, not drawing.
                palettes[selected].splice(palettes[selected].length - (addedCounts[selected] || 0), 0, c);
                added++;
            }
        }
        persist();
        render();
        notifySelection();
        $('pal-hexlist').value = '';
        log(`Added ${added} colour${added === 1 ? '' : 's'}${bad ? `, skipped ${bad} malformed` : ''}.`);
    });

    // --- export / import ---
    $('pal-export').addEventListener('click', async () => {
        const blob = new Blob([store.toJSON(palettes, addedCounts)], { type: 'application/json' });
        const name = `pixelator-palettes-${new Date().toISOString().slice(0, 10)}.json`;
        try {
            const where = await saveBlob(blob, name);
            log(`Exported ${Object.keys(palettes).length} palettes. ${where}`, 'good');
        } catch (err) {
            log(`Could not export the palettes: ${err.message}`, 'err');
        }
    });

    $('pal-import-btn').addEventListener('click', () => $('pal-import').click());
    $('pal-import').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const { merged, added, renamed, mergedAdded } =
                store.mergeImported(palettes, await file.text(), addedCounts);
            // An import can bring in a lot at once; make it reversible too.
            offerUndo(`Imported ${added} palette${added === 1 ? '' : 's'}`);
            palettes = merged;
            addedCounts = mergedAdded;
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
