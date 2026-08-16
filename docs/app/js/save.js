// save.js — writing a result out, on the web and inside the Android app.
//
// These are two genuinely different operations wearing one button.
//
// In a browser, an <a download> pointed at a blob: URL is the whole mechanism
// and it works. Inside the Capacitor WebView it does nothing at all: a WebView
// has no download manager attached, and blob: URLs are not something Android's
// DownloadManager can fetch even when one is. The click is accepted, no error
// is raised, and no file appears — which is the worst possible failure, because
// there is nothing to report and nothing to retry.
//
// So the native platform gets the Filesystem plugin instead, and every path
// through here returns a description of where the file went or throws. Silence
// is not one of the outcomes.
//
// The plugin is reached through the runtime bridge rather than an import: the
// web build is plain ES modules served from a folder with no bundler and no
// node_modules, and a static import of @capacitor/filesystem would break it.

const bridge = () => (typeof window === 'undefined' ? undefined : window.Capacitor);

/**
 * The in-app browsers that open when you tap a link inside a social app.
 *
 * They are WebViews with no download manager attached, so the anchor trick
 * fails exactly as it does inside our own Android shell — the click is
 * accepted, no error is raised, and no file appears. Detecting them is the only
 * way to offer something that does work before the user concludes the app is
 * broken.
 */
const IN_APP_UA = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|TikTok|musical_ly|Snapchat|Pinterest|Twitter/i;

export const isInAppBrowser = () =>
    typeof navigator !== 'undefined' && IN_APP_UA.test(navigator.userAgent || '');

/**
 * Hand the file to the system share sheet.
 *
 * This is the one route that usually survives an in-app browser: "Save to
 * Photos" or "Save to Files" is a share target, so the WebView never has to
 * download anything itself.
 */
async function shareBlob(blob, filename) {
    if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return false;
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (!navigator.canShare({ files: [file] })) return false;
    try {
        await navigator.share({ files: [file], title: filename });
        return true;
    } catch (err) {
        // A cancelled sheet is a decision, not a failure, and must not fall
        // through to a second attempt the user did not ask for.
        if (err && err.name === 'AbortError') return true;
        return false;
    }
}

/**
 * Last resort: show the result and let the browser's own image handling save it.
 *
 * Long-press to save works in every in-app browser precisely because it is not
 * a download — it is the same gesture that saves any picture on any page.
 * Only images can be rescued this way; a video or a JSON file has no equivalent,
 * so those get told plainly to open the page in a real browser.
 */
function showFallback(blob, filename) {
    const isImage = (blob.type || '').startsWith('image/');
    const url = URL.createObjectURL(blob);

    const wrap = document.createElement('div');
    wrap.className = 'save-fallback';
    wrap.innerHTML = `
      <div class="save-fallback-panel" role="dialog" aria-modal="true" aria-label="Save this file">
        <h3>Saving is blocked here</h3>
        <p>This page is open inside another app's browser, which has no downloads.</p>
        ${isImage
            ? '<p><strong>Press and hold the picture below</strong>, then choose Save image.</p>'
            : '<p>Open this page in Chrome, Safari or Firefox and save it from there.</p>'}
        ${isImage ? `<img src="${url}" alt="${filename}">` : ''}
        <button type="button" class="green" data-act="copy">Copy the page link</button>
        <button type="button" class="ghost" data-act="close">Close</button>
      </div>`;

    const close = () => {
        wrap.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    };
    wrap.addEventListener('click', async (e) => {
        const act = e.target?.dataset?.act;
        if (act === 'close' || e.target === wrap) { close(); return; }
        if (act === 'copy') {
            try {
                await navigator.clipboard.writeText(location.href);
                e.target.textContent = 'Link copied';
            } catch {
                e.target.textContent = location.href;
            }
        }
    });
    document.body.appendChild(wrap);
}

/** True inside the Android/iOS shell, false in any browser. */
export const isNative = () => Boolean(bridge()?.isNativePlatform?.());

/** The plugin wants base64 without the data: prefix. */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const comma = String(reader.result).indexOf(',');
            resolve(comma === -1 ? '' : String(reader.result).slice(comma + 1));
        };
        reader.onerror = () => reject(new Error('could not read the result back'));
        reader.readAsDataURL(blob);
    });
}

/**
 * Where to try writing, best first.
 *
 * DOCUMENTS is the public Documents folder, which is what a person means by
 * "saved" — but since Android 10 scoped storage it is not writable without a
 * permission grant, so it usually fails and it is only worth attempting.
 * EXTERNAL is the app's own folder on external storage: no permission needed on
 * any version, and still reachable from a file manager or over USB. DATA is
 * app-private and effectively invisible, kept only because losing the render
 * outright is worse than putting it somewhere awkward.
 */
const DIRECTORIES = ['DOCUMENTS', 'EXTERNAL', 'DATA'];

/**
 * Write through the Filesystem plugin.
 *
 * The URI actually returned is reported rather than the one requested, so the
 * message can never claim a location the file is not in.
 */
async function saveNative(blob, filename) {
    const Filesystem = bridge()?.Plugins?.Filesystem;
    if (!Filesystem) {
        throw new Error('this build has no Filesystem plugin — run npm install and npx cap sync android');
    }

    // Only some versions and directories need this, and asking when it is not
    // required is a no-op, so a refusal here is not yet a reason to stop.
    try { await Filesystem.requestPermissions(); } catch { /* try the write anyway */ }

    const data = await blobToBase64(blob);
    let lastError = null;

    for (const directory of DIRECTORIES) {
        try {
            const res = await Filesystem.writeFile({ path: filename, data, directory, recursive: true });
            return (res?.uri || `${directory}/${filename}`).replace(/^file:\/\//, '');
        } catch (err) {
            lastError = err;
        }
    }
    throw new Error(lastError?.message || 'the file could not be written');
}

/** The browser path, and the only one that ever worked here. */
function saveViaAnchor(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    // Both deferred: removing the anchor or revoking the URL in the same tick
    // can cancel a download that has not started reading yet.
    setTimeout(() => a.remove(), 1000);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Save a blob under a filename.
 *
 * @returns {Promise<string>} a sentence describing where it went
 * @throws if the file could not be written, so callers can say so
 */
export async function saveBlob(blob, filename) {
    if (!blob || !blob.size) throw new Error('there is nothing to save yet');

    if (isNative()) {
        const where = await saveNative(blob, filename);
        return `Saved to ${where}`;
    }

    // Inside a social app's browser the anchor silently does nothing, so try
    // the share sheet first and show the long-press panel if that is refused
    // too. In an ordinary browser the anchor works and is far less intrusive
    // than a share sheet nobody asked for, so it stays the default there.
    if (isInAppBrowser()) {
        if (await shareBlob(blob, filename)) return `Shared ${filename}.`;
        showFallback(blob, filename);
        return 'Downloads are blocked in this browser — see the panel for how to save.';
    }

    saveViaAnchor(blob, filename);
    return `Saved ${filename}.`;
}
