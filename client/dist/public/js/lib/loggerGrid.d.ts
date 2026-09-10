export type LoggerGridRect = {
    x: number;
    y: number;
    w: number;
    h: number;
};
export type LoggerGridLayout = {
    items: Record<string, LoggerGridRect>;
    [key: string]: unknown;
};
export declare const loggerGridRectsOverlap: (left: LoggerGridRect, right: LoggerGridRect) => boolean;
export declare function loggerGridLayoutIsCollisionFree(layout: LoggerGridLayout, visibleIds: readonly string[]): boolean;
export declare function replaceLoggerGridItem(layout: LoggerGridLayout, itemId: string, nextItem: LoggerGridRect, visibleIds: readonly string[]): LoggerGridLayout | null;
export declare function swapLoggerGridItemAtPosition(layout: LoggerGridLayout, itemId: string, requested: {
    x: number;
    y: number;
}, bounds: {
    maxX: number;
    maxY: number;
}, visibleIds: readonly string[]): LoggerGridLayout | null;
export declare function findLoggerGridItemPosition(layout: LoggerGridLayout, itemId: string, requested: {
    x: number;
    y: number;
}, previous: {
    x: number;
    y: number;
}, bounds: {
    maxX: number;
    maxY: number;
}, visibleIds: readonly string[]): LoggerGridLayout | null;
//# sourceMappingURL=loggerGrid.d.ts.map