// app.js — start-up.
//
// Every screen is initialised behind its own guard. A module that throws while
// wiring itself up used to take the whole app with it — main() aborted at the
// first exception and nothing after it ran, so the page sat there looking like
// it had failed to load, with the real reason only in a console nobody had
// open. Now a failure is contained to its own screen and said out loud.

import * as shell from './shell.js';
import * as settings from './settings.js';
import * as palettes from './palettes.js';
import * as extractui from './extractui.js';
import * as photo from './photo.js';
import * as video from './video.js';

const failures = [];

function step(name, fn) {
    try {
        fn();
    } catch (err) {
        console.error(`[pixelatte] ${name} failed to start`, err);
        failures.push({ name, message: err?.message || String(err) });
    }
}

/**
 * Say what broke, and offer the one fix that usually works.
 *
 * Almost every failure that survives testing but appears on a real machine
 * comes from stored data — a palette store written by an older build, a
 * preference naming something that no longer exists. Clearing it is the repair,
 * and it should not require knowing what localStorage is.
 */
function reportFailure(list) {
    const panel = document.createElement('div');
    panel.className = 'boot-failure';
    panel.innerHTML = `
      <div class="boot-failure-panel" role="alert">
        <h3>Pixelatte could not start properly</h3>
        <p>${list.length} part${list.length === 1 ? '' : 's'} of the app failed to
           load. The rest still works.</p>
        <ul>${list.map((f) => `<li><b>${f.name}</b> — ${f.message}</li>`).join('')}</ul>
        <p>This is nearly always caused by saved data from an older version.
           Resetting it clears your palettes and preferences on this device;
           nothing else is affected.</p>
        <button type="button" data-act="reset" class="yellow">Reset stored data and reload</button>
        <button type="button" data-act="close" class="ghost">Continue anyway</button>
      </div>`;

    panel.addEventListener('click', (e) => {
        const act = e.target?.dataset?.act;
        if (act === 'close') panel.remove();
        if (act === 'reset') {
            try {
                for (const key of Object.keys(localStorage)) {
                    if (key.startsWith('pixelator-') || key.startsWith('pixelatte-')) {
                        localStorage.removeItem(key);
                    }
                }
            } catch { /* private mode: nothing stored to clear */ }
            location.reload();
        }
    });
    document.body.appendChild(panel);
}

function main() {
    step('Settings', settings.init);
    // The shell subscribes to palette changes to keep its preview current, and
    // so do photo and video for their dropdowns — all of them must be wired up
    // before palettes.init() publishes the first set.
    step('Shell', shell.init);
    step('Photo', photo.init);
    step('Video', video.init);
    step('Extract', extractui.init);
    step('Palettes', palettes.init);

    // The watchdog in the page checks this. Set even when something failed:
    // the modules did run, and a half-started app is a different problem from
    // one whose scripts never arrived at all.
    document.documentElement.dataset.booted = '1';

    if (failures.length) reportFailure(failures);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
