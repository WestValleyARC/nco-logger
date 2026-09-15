import { type LoggerGridLayout } from './loggerGrid.js';
export type SharedBoundary = {
    id: string;
    axis: 'x' | 'y';
    position: number;
    start: number;
    end: number;
    before: string[];
    after: string[];
};
export type PaneMinimums = Record<string, {
    w: number;
    h: number;
}>;
export declare function sharedBoundaries(layout: LoggerGridLayout, visible: readonly string[]): SharedBoundary[];
export declare function boundaryLimits(layout: LoggerGridLayout, boundary: SharedBoundary, minimums: PaneMinimums): {
    min: number;
    max: number;
};
export declare function resizeSharedBoundary(layout: LoggerGridLayout, boundary: SharedBoundary, requested: number, minimums: PaneMinimums, visible: readonly string[]): LoggerGridLayout | null;
export declare function dockAtEdge(layout: LoggerGridLayout, moving: string, target: string, edge: 'left' | 'right' | 'top' | 'bottom', minimums: PaneMinimums, visible: readonly string[]): LoggerGridLayout | null;
//# sourceMappingURL=loggerSplitters.d.ts.map