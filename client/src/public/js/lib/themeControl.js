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
            control.value = appearance;
            control.dataset.resolvedTheme = theme;
            control.title = appearance === 'system' ? `System theme (currently ${theme})` : `${theme[0].toUpperCase()}${theme.slice(1)} theme`;
        });
    };

    controls.forEach(control => {
        control.addEventListener('change', () => appearanceManager.setAppearance(control.value));
    });
    window.addEventListener('ncoLogger:appearancechange', syncControls);
    syncControls();
})();
