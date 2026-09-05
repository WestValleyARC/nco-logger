import { serverInfo } from '#@client/lib/serverInfo.js';
const loggerMethods = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console)
};
const logLevelStyles = {
    error: 'color: red;',
    warn: 'color: orange;',
    info: 'color: white;',
    debug: 'color: cyan;'
};
const primitiveString = (arg) => {
    if (arg === null)
        return 'null';
    if (arg === undefined)
        return 'undefined';
    if (typeof arg === 'string')
        return arg;
    if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint' || typeof arg === 'symbol')
        return String(arg);
    return JSON.stringify(arg, null, 2) ?? '[unserializable value]';
};
const formatArgs = (args) => args.map(arg => typeof arg === 'object' ? arg : primitiveString(arg));
const shouldLog = (level) => {
    return serverInfo && (serverInfo.logLevel === 'debug' || (serverInfo.logLevel === 'info' && level !== 'debug'));
};
const formatLogMessage = (args, filename, level) => {
    const styledFilename = `%c${filename}%c `;
    const filenameStyle = 'color: black; background-color: white;';
    const messageStyle = logLevelStyles[level];
    const otherArgs = args
        .map(arg => {
        if (arg instanceof Error) {
            return `${arg.name}: ${arg.message}\n${arg.stack}`;
        }
        return primitiveString(arg);
    })
        .join(' ');
    return [styledFilename + otherArgs, filenameStyle, messageStyle];
};
export function createLogger(filename) {
    return new Proxy(loggerMethods, {
        get: (target, level) => {
            if (level in target) {
                return (...args) => {
                    args = formatArgs(args);
                    if (args.length > 0 && shouldLog(level)) {
                        const logMessage = formatLogMessage(args, filename, level);
                        Reflect.apply(target[level], console, logMessage);
                    }
                };
            }
            else {
                return () => { };
            }
        }
    });
}
//# sourceMappingURL=logger.js.map