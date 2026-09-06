/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

(() => {
    const appearanceManager = window.ncoLoggerAppearance;
    const controls = document.querySelectorAll('[data-appearance-control]');
    if (!appearanceManager || !controls.length) return;

    const syncControls = () => {
        const appearance = appearanceManager.getAppearance();
        const theme = appearanceManager.getTheme();
        controls.forEach(control => {
            control.checked = theme === 'dark';
            control.setAttribute('aria-checked', String(control.checked));
            control.dataset.resolvedTheme = theme;
            const label = control.closest('.app-theme-toggle')?.querySelector('[data-appearance-label]');
            if (label) label.textContent = theme === 'dark' ? 'Dark' : 'Light';
            const description = appearance === 'system' ? `System preference currently resolves to ${theme}` : `${theme} theme selected`;
            control.closest('.app-theme-toggle')?.setAttribute('title', `${description}. Toggle theme.`);
        });
    };

    controls.forEach(control => {
        control.addEventListener('change', () => appearanceManager.setAppearance(control.checked ? 'dark' : 'light'));
    });
    window.addEventListener('ncoLogger:appearancechange', syncControls);
    syncControls();
})();
