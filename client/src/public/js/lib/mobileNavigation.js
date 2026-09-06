/* hamlive-oss — MIT License. See LICENSE. */

'use strict';
(() => {
    const trigger = document.querySelector('[data-mobile-nav-trigger]');
    const drawer = document.querySelector('[data-mobile-nav-drawer]');
    const closeButton = document.querySelector('[data-mobile-nav-close]');
    const backdrop = document.querySelector('[data-mobile-nav-backdrop]');
    if (!(trigger instanceof HTMLButtonElement) || !(drawer instanceof HTMLElement)
        || !(closeButton instanceof HTMLButtonElement) || !(backdrop instanceof HTMLElement)) return;

    const desktop = window.matchMedia('(min-width: 992px)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let isOpen = false;
    let lockedScrollY = 0;
    let hideTimer;

    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const restorePageScroll = () => {
        document.body.classList.remove('app-mobile-nav-open');
        document.body.style.removeProperty('top');
        window.scrollTo(0, lockedScrollY);
    };

    const finishClose = () => {
        if (isOpen) return;
        backdrop.hidden = true;
    };

    const closeDrawer = ({ restoreFocus = true, immediate = false } = {}) => {
        if (!isOpen) return;
        isOpen = false;
        drawer.classList.remove('is-open');
        backdrop.classList.remove('is-open');
        drawer.setAttribute('aria-hidden', 'true');
        drawer.setAttribute('inert', '');
        drawer.removeAttribute('role');
        drawer.removeAttribute('aria-modal');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', 'Open navigation menu');
        restorePageScroll();
        window.clearTimeout(hideTimer);
        if (immediate || reducedMotion.matches) finishClose();
        else hideTimer = window.setTimeout(finishClose, 180);
        if (restoreFocus && !desktop.matches) trigger.focus({ preventScroll: true });
    };

    const openDrawer = () => {
        if (isOpen || desktop.matches) return;
        isOpen = true;
        lockedScrollY = window.scrollY;
        window.clearTimeout(hideTimer);
        backdrop.hidden = false;
        drawer.removeAttribute('inert');
        drawer.setAttribute('aria-hidden', 'false');
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-modal', 'true');
        trigger.setAttribute('aria-expanded', 'true');
        trigger.setAttribute('aria-label', 'Close navigation menu');
        document.body.style.top = `-${lockedScrollY}px`;
        document.body.classList.add('app-mobile-nav-open');
        requestAnimationFrame(() => {
            if (!isOpen) return;
            drawer.classList.add('is-open');
            backdrop.classList.add('is-open');
            closeButton.focus({ preventScroll: true });
        });
    };

    const syncBreakpoint = () => {
        if (desktop.matches) {
            closeDrawer({ restoreFocus: false, immediate: true });
            drawer.removeAttribute('aria-hidden');
            drawer.removeAttribute('inert');
            drawer.removeAttribute('role');
            drawer.removeAttribute('aria-modal');
            backdrop.hidden = true;
            return;
        }
        drawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        if (!isOpen) {
            drawer.setAttribute('inert', '');
            drawer.removeAttribute('role');
            drawer.removeAttribute('aria-modal');
        }
    };

    trigger.addEventListener('click', () => isOpen ? closeDrawer() : openDrawer());
    closeButton.addEventListener('click', () => closeDrawer());
    backdrop.addEventListener('click', () => closeDrawer());
    drawer.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => closeDrawer({ restoreFocus: false })));

    document.addEventListener('keydown', event => {
        if (!isOpen) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDrawer();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...drawer.querySelectorAll(focusableSelector)].filter(element => element instanceof HTMLElement);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });

    desktop.addEventListener('change', syncBreakpoint);
    syncBreakpoint();
})();
