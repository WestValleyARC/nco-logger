export const LOGGER_RESPONSIVE_LAYOUT_VERSION = 1;

export type LoggerLayoutContext =
  | 'phonePortrait'
  | 'phoneLandscape'
  | 'tabletPortrait'
  | 'tabletLandscape'
  | 'desktop';

export function classifyLoggerLayout(width: number, height: number): LoggerLayoutContext {
    const viewportWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : 0;
    const viewportHeight = Number.isFinite(height) && height > 0 ? Math.round(height) : 0;
    if (!viewportWidth || !viewportHeight) return 'desktop';

    const orientation = viewportWidth > viewportHeight ? 'Landscape' : 'Portrait';
    if (viewportWidth <= 600 || (orientation === 'Landscape' && viewportHeight <= 500 && viewportWidth <= 950)) {
        return `phone${orientation}`;
    }
    if (viewportWidth <= 1100) return `tablet${orientation}`;
    return 'desktop';
}

export function isCurrentResponsiveLayout(value: unknown, context: LoggerLayoutContext): boolean {
    if (!value || typeof value !== 'object' || context === 'desktop') return false;
    const layout = value as Record<string, unknown>;
    if (layout['responsiveLayoutVersion'] !== LOGGER_RESPONSIVE_LAYOUT_VERSION
        || layout['layoutContext'] !== context) return false;
    if (context !== 'phonePortrait') return true;

    const items = layout['items'];
    if (!items || typeof items !== 'object') return false;
    const itemRecords = items as Record<string, unknown>;
    return ['controls', 'active', 'chat', 'lurkers', 'checkedOut'].every(id => {
        const item = itemRecords[id];
        if (!item || typeof item !== 'object') return false;
        const geometry = item as Record<string, unknown>;
        return geometry['x'] === 0 && geometry['w'] === 24;
    });
}
