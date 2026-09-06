export declare const LOGGER_RESPONSIVE_LAYOUT_VERSION = 1;
export declare const LOGGER_ROLE_LAYOUT_VERSION = 1;
export type LoggerLayoutContext = 'phonePortrait' | 'phoneLandscape' | 'tabletPortrait' | 'tabletLandscape' | 'desktop';
export type LoggerLayoutRole = 'nco' | 'logger' | 'relay' | 'viewer';
export declare function loggerLayoutRole(role: string): LoggerLayoutRole;
export declare function isSameLoggerModuleLayout(value: unknown, expected: unknown): boolean;
export declare function shouldResetLegacyLoggerLayout(value: unknown, role: string, operatorDefault: unknown, viewerDefault: unknown, inheritedViewerDefault?: unknown): boolean;
export declare function classifyLoggerLayout(width: number, height: number): LoggerLayoutContext;
export declare function isCurrentResponsiveLayout(value: unknown, context: LoggerLayoutContext): boolean;
//# sourceMappingURL=loggerResponsive.d.ts.map