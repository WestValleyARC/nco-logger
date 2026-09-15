import { type PaneMinimums, type SharedBoundary } from './loggerSplitters.js';
import type { LoggerGridLayout } from './loggerGrid.js';
type Options = {
    read: () => LoggerGridLayout;
    visible: (layout: LoggerGridLayout) => string[];
    minimums: () => PaneMinimums;
    labels: Record<string, string>;
    allowed?: (boundary: SharedBoundary) => boolean;
    apply: (layout: LoggerGridLayout) => void;
    save: () => void;
};
export declare class LoggerSplitterControls {
    private dashboard;
    private options;
    private drag;
    private handles;
    private observer;
    constructor(dashboard: HTMLElement, options: Options);
    render(): void;
    private start;
    private move;
    private finish;
    cancel(): void;
    private key;
    destroy(): void;
}
export {};
//# sourceMappingURL=loggerSplitterControls.d.ts.map