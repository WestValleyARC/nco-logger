'use strict';
(() => {
    if (window.ncoLoggerAppearance)
        return;
    const STORAGE_KEY = 'ncoLogger.appearance';
    const DEFAULT_APPEARANCE = 'system';
    const allowedAppearances = new Set(['system', 'light', 'dark']);
    const systemDarkMode = window.matchMedia('(prefers-color-scheme: dark)');
    const normalizeAppearance = value => typeof value === 'string' && allowedAppearances.has(value) ? value : DEFAULT_APPEARANCE;
    const readAppearance = () => {
        try {
            return normalizeAppearance(window.localStorage.getItem(STORAGE_KEY));
        }
        catch (_error) {
            return DEFAULT_APPEARANCE;
        }
    };
    let appearance = readAppearance();
    const resolveTheme = value => (value === 'system' ? (systemDarkMode.matches ? 'dark' : 'light') : value);
    const applyAppearance = value => {
        appearance = normalizeAppearance(value);
        const theme = resolveTheme(appearance);
        const root = document.documentElement;
        root.dataset.appearance = appearance;
        root.dataset.theme = theme;
        root.style.colorScheme = theme;
        window.dispatchEvent(new CustomEvent('ncoLogger:appearancechange', {
            detail: { appearance, theme }
        }));
    };
    const setAppearance = value => {
        const normalized = normalizeAppearance(value);
        try {
            window.localStorage.setItem(STORAGE_KEY, normalized);
        }
        catch (_error) {
        }
        applyAppearance(normalized);
    };
    const handleSystemChange = () => {
        if (appearance === 'system')
            applyAppearance(appearance);
    };
    if (typeof systemDarkMode.addEventListener === 'function') {
        systemDarkMode.addEventListener('change', handleSystemChange);
    }
    else {
        systemDarkMode.addListener(handleSystemChange);
    }
    window.addEventListener('storage', event => {
        if (event.key === STORAGE_KEY)
            applyAppearance(event.newValue);
    });
    window.ncoLoggerAppearance = Object.freeze({
        STORAGE_KEY,
        getAppearance: () => appearance,
        getTheme: () => resolveTheme(appearance),
        setAppearance
    });
    applyAppearance(appearance);
})();
//# sourceMappingURL=appearance.js.map