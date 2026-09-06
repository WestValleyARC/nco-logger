'use strict';
(() => {
    const appearanceManager = window.ncoLoggerAppearance;
    const controls = document.querySelectorAll('[data-appearance-control]');
    if (!appearanceManager || !controls.length)
        return;
    const syncControls = () => {
        const appearance = appearanceManager.getAppearance();
        const theme = appearanceManager.getTheme();
        controls.forEach(control => {
            control.checked = theme === 'dark';
            control.setAttribute('aria-checked', String(control.checked));
            control.dataset.resolvedTheme = theme;
            const current = theme === 'dark' ? 'Dark' : 'Light';
            const target = theme === 'dark' ? 'light' : 'dark';
            const source = appearance === 'system' ? ' from system preference' : '';
            control.setAttribute('aria-label', `${current} theme active${source}. Switch to ${target} theme.`);
            control.closest('.app-theme-toggle')?.setAttribute('title', `${current} theme active${source}. Switch to ${target} theme.`);
        });
    };
    controls.forEach(control => {
        control.addEventListener('change', () => appearanceManager.setAppearance(control.checked ? 'dark' : 'light'));
    });
    window.addEventListener('ncoLogger:appearancechange', syncControls);
    syncControls();
})();
//# sourceMappingURL=themeControl.js.map