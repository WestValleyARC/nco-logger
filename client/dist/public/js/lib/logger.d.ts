type LoggerFunction = (...args: unknown[]) => void;
export declare function createLogger(filename: string): {
    info: LoggerFunction;
    debug: LoggerFunction;
    error: LoggerFunction;
    warn: LoggerFunction;
};
export {};
//# sourceMappingURL=logger.d.ts.map