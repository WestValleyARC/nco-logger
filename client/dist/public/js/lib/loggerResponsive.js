export const LOGGER_RESPONSIVE_LAYOUT_VERSION = 1;
export const LOGGER_ROLE_LAYOUT_VERSION = 1;
export function loggerLayoutRole(role) {
    if (role === 'netcontrol')
        return 'nco';
    if (role === 'netlogger')
        return 'logger';
    if (role === 'netrelay')
        return 'relay';
    return 'viewer';
}
export function isSameLoggerModuleLayout(value, expected) {
    if (!value || typeof value !== 'object' || !expected || typeof expected !== 'object')
        return false;
    const valueLayout = value;
    const expectedLayout = expected;
    const valueItems = valueLayout['items'];
    const expectedItems = expectedLayout['items'];
    if (!valueItems || typeof valueItems !== 'object' || !expectedItems || typeof expectedItems !== 'object')
        return false;
    const leftItems = valueItems;
    const rightItems = expectedItems;
    const leftCollapsed = valueLayout['collapsed'] && typeof valueLayout['collapsed'] === 'object'
        ? valueLayout['collapsed'] : {};
    const rightCollapsed = expectedLayout['collapsed'] && typeof expectedLayout['collapsed'] === 'object'
        ? expectedLayout['collapsed'] : {};
    return ['controls', 'active', 'chat', 'lurkers', 'checkedOut'].every(id => {
        const left = leftItems[id];
        const right = rightItems[id];
        if (!left || typeof left !== 'object' || !right || typeof right !== 'object')
            return false;
        const leftGeometry = left;
        const rightGeometry = right;
        return ['x', 'y', 'w', 'h'].every(key => Number(leftGeometry[key]) === Number(rightGeometry[key]))
            && Boolean(leftCollapsed[id]) === Boolean(rightCollapsed[id]);
    });
}
export function shouldResetLegacyLoggerLayout(value, role, operatorDefault, viewerDefault, inheritedViewerDefault = viewerDefault) {
    if (loggerLayoutRole(role) === 'viewer') {
        return isSameLoggerModuleLayout(value, operatorDefault)
            || isSameLoggerModuleLayout(value, inheritedViewerDefault);
    }
    return isSameLoggerModuleLayout(value, viewerDefault)
        || isSameLoggerModuleLayout(value, inheritedViewerDefault);
}
export function classifyLoggerLayout(width, height) {
    const viewportWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : 0;
    const viewportHeight = Number.isFinite(height) && height > 0 ? Math.round(height) : 0;
    if (!viewportWidth || !viewportHeight)
        return 'desktop';
    const orientation = viewportWidth > viewportHeight ? 'Landscape' : 'Portrait';
    if (viewportWidth <= 600 || (orientation === 'Landscape' && viewportHeight <= 500 && viewportWidth <= 950)) {
        return `phone${orientation}`;
    }
    if (viewportWidth <= 1200)
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