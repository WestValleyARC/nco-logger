type LoggerFunction = (...args: unknown[]) => void;
export declare function createLogger(filename: string): {
    error: LoggerFunction;
    warn: LoggerFunction;
    info: LoggerFunction;
    debug: LoggerFunction;
};
export {};
//# sourceMappingURL=logger.d.ts.map