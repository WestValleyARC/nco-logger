export const LOGGER_RESPONSIVE_LAYOUT_VERSION = 1;
export function classifyLoggerLayout(width, height) {
    const viewportWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : 0;
    const viewportHeight = Number.isFinite(height) && height > 0 ? Math.round(height) : 0;
    if (!viewportWidth || !viewportHeight)
        return 'desktop';
    const orientation = viewportWidth > viewportHeight ? 'Landscape' : 'Portrait';
    if (viewportWidth <= 600 || (orientation === 'Landscape' && viewportHeight <= 500 && viewportWidth <= 950)) {
        return `phone${orientation}`;
    }
    if (viewportWidth <= 1100)
        return `tablet${orientation}`;
    return 'desktop';
}
export function isCurrentResponsiveLayout(value, context) {
    if (!value || typeof value !== 'object' || context === 'desktop')
        return false;
    const layout = value;
    if (layout['responsiveLayoutVersion'] !== LOGGER_RESPONSIVE_LAYOUT_VERSION
        || layout['layoutContext'] !== context)
        return false;
    if (context !== 'phonePortrait')
        return true;
    const items = layout['items'];
    if (!items || typeof items !== 'object')
        return false;
    const itemRecords = items;
    return ['controls', 'active', 'chat', 'lurkers', 'checkedOut'].every(id => {
        const item = itemRecords[id];
        if (!item || typeof item !== 'object')
            return false;
        const geometry = item;
        return geometry['x'] === 0 && geometry['w'] === 24;
    });
}
//# sourceMappingURL=loggerResponsive.js.map