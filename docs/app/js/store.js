// store.js — palette persistence.
//
// Local-first by design: palettes are a few KB, so they live on the device and
// never need an account. The on-disk shape is deliberately plain, portable JSON
// ({ name: ["#RRGGBB", ...] }) so it can be exported, emailed, committed, or
// later synced by an optional account service without touching this file.

import { CATALOGUE, DEFAULTS_VERSION, GROUPS } from './library.js';

const KEY = 'pixelator-palettes';
const LEGACY_KEY = 'video-pixelator-palettes';   // the original pixelator.html key
const VERSION_KEY = 'pixelator-defaults-version';
/**
 * How many trailing colours of each palette were added by hand.
 *
 * Kept beside the palettes rather than inside them so the main store stays the
 * plain { name: ["#RRGGBB", ...] } shape that anything can read. A colour you
 * mixed yourself is not one the picture suggested, and the strip says so with a
 * divider — but that is a fact *about* the palette, not one of its colours.
 */
const ADDED_KEY = 'pixelator-palette-added';



export { CATALOGUE, DEFAULTS_VERSION, GROUPS };

/** Which group a shipped palette belongs to, or null if it is the user's own. */
export function groupOf(name) {
    return CATALOGUE.find((e) => e.name === name)?.group ?? null;
}

export const DEFAULT_PALETTES = Object.fromEntries(
    CATALOGUE.map((p) => [p.name, p.colors]));

const BUILT_IN_NAMES = new Set(CATALOGUE.map((p) => p.name));

/**
 * Whether a palette is one this app ships.
 *
 * Decided by name, which has one consequence worth knowing: editing a shipped
 * palette's colours leaves it listed as built-in, while renaming it makes it
 * yours. That is the right way round — a rename is a deliberate act of adoption,
 * an edit is just tuning.
 */
export function isBuiltIn(name) {
    return BUILT_IN_NAMES.has(name);
}

const isHex = (c) => /^#[0-9A-F]{6}$/i.test(c);

/** Drop anything malformed so a corrupted store can't break the app. */
function sanitize(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const [name, colors] of Object.entries(obj)) {
        if (typeof name !== 'string' || !Array.isArray(colors)) continue;
        const clean = colors.filter((c) => typeof c === 'string' && isHex(c)).map((c) => c.toUpperCase());
        out[name] = clean;
    }
    return out;
}

function storedVersion() {
    const raw = Number(localStorage.getItem(VERSION_KEY));
    // A store that predates this mechanism holds version 1 by definition.
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/**
 * Add palettes introduced since the store was last seen.
 *
 * Only entries newer than the recorded version are considered, so a palette the
 * user deleted stays deleted; only genuinely new ones appear. A name already in
 * use is left alone — the user's version of "Nord" wins over the shipped one.
 */
function addNewDefaults(palettes) {
    const from = storedVersion();
    if (from >= DEFAULTS_VERSION) return { palettes, added: 0 };

    let added = 0;
    for (const entry of CATALOGUE) {
        if (entry.since > from && !(entry.name in palettes)) {
            palettes[entry.name] = entry.colors.slice();
            added++;
        }
    }
    return { palettes, added };
}


/**
 * Yours first, then the shipped ones in catalogue order.
 *
 * The stored object keeps insertion order, so a store written by an older
 * version has the old arrangement baked into it. Reordering on load is what
 * lets the shipped list be rearranged without asking anyone to reset anything.
 */
function inCatalogueOrder(palettes) {
    const rank = new Map(CATALOGUE.map((e, i) => [e.name, i]));
    const names = Object.keys(palettes);
    const mine = names.filter((n) => !rank.has(n));
    const shipped = names.filter((n) => rank.has(n)).sort((a, b) => rank.get(a) - rank.get(b));

    const out = {};
    for (const n of mine) out[n] = palettes[n];
    for (const n of shipped) out[n] = palettes[n];
    return out;
}

export function load() {
    try {
        let raw = localStorage.getItem(KEY);
        if (!raw) {
            // One-time migration from the original single-file version.
            const legacy = localStorage.getItem(LEGACY_KEY);
            if (legacy) {
                raw = legacy;
                localStorage.setItem(KEY, legacy);
            }
        }
        if (!raw) {
            save({ ...DEFAULT_PALETTES });
            localStorage.setItem(VERSION_KEY, String(DEFAULTS_VERSION));
            return { ...DEFAULT_PALETTES };
        }

        const parsed = sanitize(JSON.parse(raw));
        if (!Object.keys(parsed).length) {
            localStorage.setItem(VERSION_KEY, String(DEFAULTS_VERSION));
            return { ...DEFAULT_PALETTES };
        }

        const { palettes, added } = addNewDefaults(parsed);
        const ordered = inCatalogueOrder(palettes);
        if (added) save(ordered);
        localStorage.setItem(VERSION_KEY, String(DEFAULTS_VERSION));
        return ordered;
    } catch {
        return { ...DEFAULT_PALETTES };
    }
}

/** { name: count } — how many of each palette's last colours were hand-added. */
export function loadAdded() {
    try {
        const raw = JSON.parse(localStorage.getItem(ADDED_KEY) || '{}');
        const out = {};
        if (raw && typeof raw === 'object') {
            for (const [name, n] of Object.entries(raw)) {
                if (typeof name === 'string' && Number.isFinite(n) && n > 0) out[name] = Math.floor(n);
            }
        }
        return out;
    } catch {
        return {};
    }
}

export function saveAdded(added) {
    try {
        // Only the non-zero entries: the common case is a palette with none,
        // and storing those would grow the record for no information.
        const trimmed = {};
        for (const [name, n] of Object.entries(added || {})) if (n > 0) trimmed[name] = n;
        localStorage.setItem(ADDED_KEY, JSON.stringify(trimmed));
        return true;
    } catch {
        return false;
    }
}

export function save(palettes) {
    try {
        localStorage.setItem(KEY, JSON.stringify(palettes));
        return true;
    } catch {
        return false;   // quota or private mode; caller surfaces it
    }
}

/**
 * Serialise for the export button.
 *
 * Wrapped rather than flat once there is anything to say beyond the colours, so
 * the divider survives a round trip through a file. The old flat shape is still
 * written when no palette has hand-added colours, and still read either way, so
 * files move in both directions between versions.
 */
export function toJSON(palettes, added) {
    const meta = {};
    for (const [name, n] of Object.entries(added || {})) if (n > 0 && name in palettes) meta[name] = n;
    if (!Object.keys(meta).length) return JSON.stringify(palettes, null, 2);
    return JSON.stringify({ format: 'pixelator-palettes', palettes, added: meta }, null, 2);
}

/** Accept either the flat map or the wrapped form. */
function unwrap(parsed) {
    if (parsed && typeof parsed === 'object' && parsed.palettes && typeof parsed.palettes === 'object') {
        return { palettes: parsed.palettes, added: parsed.added || {} };
    }
    return { palettes: parsed, added: {} };
}

/**
 * Merge an imported file into the current set. Name collisions get a suffix
 * rather than overwriting, so importing can never destroy existing work.
 * @returns {{merged: object, added: number, renamed: string[]}}
 */
export function mergeImported(current, text, currentAdded = {}) {
    const raw = unwrap(JSON.parse(text));
    const incoming = sanitize(raw.palettes);
    const merged = { ...current };
    const mergedAdded = { ...currentAdded };
    const renamed = [];
    let added = 0;
    for (const [name, colors] of Object.entries(incoming)) {
        let target = name;
        if (target in merged) {
            if (JSON.stringify(merged[target]) === JSON.stringify(colors)) continue; // identical, skip
            let n = 2;
            while (`${name} (${n})` in merged) n++;
            target = `${name} (${n})`;
            renamed.push(target);
        }
        merged[target] = colors;
        // Clamp: a file could claim more hand-added colours than the palette has.
        const claimed = Number(raw.added?.[name]);
        if (Number.isFinite(claimed) && claimed > 0) {
            mergedAdded[target] = Math.min(Math.floor(claimed), colors.length);
        }
        added++;
    }
    return { merged, added, renamed, mergedAdded };
}
