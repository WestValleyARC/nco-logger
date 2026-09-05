export declare const LOGGER_RESPONSIVE_LAYOUT_VERSION = 1;
export type LoggerLayoutContext = 'phonePortrait' | 'phoneLandscape' | 'tabletPortrait' | 'tabletLandscape' | 'desktop';
export declare function classifyLoggerLayout(width: number, height: number): LoggerLayoutContext;
export declare function isCurrentResponsiveLayout(value: unknown, context: LoggerLayoutContext): boolean;
//# sourceMappingURL=loggerResponsive.d.ts.map