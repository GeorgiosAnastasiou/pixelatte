// popover.js — the tool menus that rise out of the bottom bar.
//
// One panel is open at a time. A panel closes when a press lands anywhere that
// is neither the panel nor the button that opened it; pressing that button
// again toggles it shut. Everything else — another tool, the stage, the mode
// bar — dismisses it, and in the same gesture does whatever it would normally
// do, because the listener observes rather than swallows the event.

const GAP = 10;                    // panel to tool bar
const MARGIN = 12;                 // panel to screen edge

// Matches the desktop breakpoint in app.css, where the tool bar becomes a rail
// down the left instead of a strip along the bottom.
const SIDE_RAIL = matchMedia('(min-width: 900px)');

let openPanel = null;
let openTrigger = null;

const isOpen = () => openPanel !== null;

/**
 * Anchor the panel to its trigger and point the notch back at it.
 *
 * Two arrangements, one rule: sit on the open side of the tool bar, aligned to
 * the trigger, clamped to stay fully on screen. Below the desktop breakpoint
 * that means above a bottom bar; at or above it, beside a left rail.
 */
function position(panel, trigger) {
    const bar = document.querySelector('.toolbar');
    const barRect = bar ? bar.getBoundingClientRect() : null;
    const arrow = document.getElementById('pop-arrow');
    const t = trigger.getBoundingClientRect();
    const side = SIDE_RAIL.matches;

    // Reset whichever pair of offsets the other arrangement set.
    panel.style.left = panel.style.right = panel.style.top = panel.style.bottom = '';

    if (side) {
        const h = panel.offsetHeight;
        const wanted = t.top + t.height / 2 - h / 2;
        const top = Math.max(MARGIN, Math.min(wanted, window.innerHeight - h - MARGIN));
        panel.style.left = `${Math.round((barRect ? barRect.right : 0) + GAP)}px`;
        panel.style.top = `${Math.round(top)}px`;
    } else {
        const w = panel.offsetWidth;
        const wanted = t.left + t.width / 2 - w / 2;
        const left = Math.max(MARGIN, Math.min(wanted, window.innerWidth - w - MARGIN));
        panel.style.left = `${Math.round(left)}px`;
        panel.style.bottom =
            `${Math.round(window.innerHeight - (barRect ? barRect.top : window.innerHeight) + GAP)}px`;
    }

    if (!arrow) return;

    // Measure where the panel actually landed rather than recomputing it, then
    // pin the notch to the trigger's centre line, kept clear of the corners.
    const p = panel.getBoundingClientRect();
    arrow.hidden = false;
    arrow.classList.toggle('side', side);

    if (side) {
        const y = Math.max(p.top + 14, Math.min(t.top + t.height / 2, p.bottom - 14));
        arrow.style.left = `${Math.round(p.left - 6)}px`;
        arrow.style.top = `${Math.round(y - 6)}px`;
    } else {
        const x = Math.max(p.left + 14, Math.min(t.left + t.width / 2, p.right - 14));
        arrow.style.left = `${Math.round(x - 6)}px`;
        arrow.style.top = `${Math.round(p.bottom - 6)}px`;
    }
}

/**
 * Tell the shell a panel is up.
 *
 * On a phone the panel covers the lower half of the screen, which is where the
 * picture was. The stage reads this and shrinks its own box, so the image
 * re-fits into the strip that is still visible and the effect of whatever the
 * panel is changing can actually be seen while changing it.
 */
function markOpen(open) {
    const app = document.getElementById('app');
    if (!app) return;
    if (open) app.dataset.popOpen = '';
    else delete app.dataset.popOpen;
}

export function close() {
    if (!isOpen()) return;
    const arrow = document.getElementById('pop-arrow');
    if (arrow) arrow.hidden = true;
    openPanel.hidden = true;
    openTrigger.classList.remove('open');
    openTrigger.setAttribute('aria-expanded', 'false');
    openPanel = null;
    openTrigger = null;
    markOpen(false);
}

export function open(panel, trigger) {
    if (openPanel === panel) { close(); return; }
    close();

    panel.hidden = false;
    openPanel = panel;
    openTrigger = trigger;
    trigger.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    markOpen(true);
    // Positioned after the stage has been told to shrink, so the panel is
    // measured against the layout it will actually sit in.
    requestAnimationFrame(() => position(panel, trigger));
    position(panel, trigger);
}

/** Re-anchor whatever is open — after a resize, rotate, or tool-bar scroll. */
export function reposition() {
    if (isOpen()) position(openPanel, openTrigger);
}

export function init() {
    for (const trigger of document.querySelectorAll('[data-pop]')) {
        const panel = document.getElementById(trigger.dataset.pop);
        if (!panel) continue;
        trigger.setAttribute('aria-haspopup', 'true');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            open(panel, trigger);
        });
    }

    // Capture phase: this must run before the pressed element's own handlers,
    // so that tapping a second tool closes the first panel and opens that one
    // rather than the two fighting over the same gesture.
    document.addEventListener('pointerdown', (e) => {
        if (!isOpen()) return;
        if (openPanel.contains(e.target) || openTrigger.contains(e.target)) return;
        close();
    }, true);

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    window.addEventListener('resize', reposition);
    // Crossing the breakpoint moves the tool bar itself; an open panel would be
    // anchored to where it used to be, so dismiss rather than re-solve it.
    SIDE_RAIL.addEventListener?.('change', close);
    // Scrolling the tool bar moves the trigger out from under its own panel.
    for (const tools of document.querySelectorAll('.tools')) {
        tools.addEventListener('scroll', reposition, { passive: true });
    }
}
