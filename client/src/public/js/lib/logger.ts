/* hamlive-oss — MIT License. See LICENSE. */

//This object contains information about the server, including the log level.
import { serverInfo } from '#@client/lib/serverInfo.js';

// Define the possible log levels as a type. This restricts the log levels to a specific set of strings.
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

// Define the type for a logger function. This function can take any number of arguments of any type.
type LoggerFunction = (...args: unknown[]) => void;

// Create an object that maps log levels to console methods. This allows us to call the appropriate console method based on the log level.
// We use the bind method to ensure that the console methods are called with the correct context (i.e., the console object itself).
const loggerMethods: { [key in LogLevel]: LoggerFunction } = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console)
};

// Define styles for each log level. These styles will be applied to the log messages in the console.
const logLevelStyles: { [key in LogLevel]: string } = {
    error: 'color: red;',
    warn: 'color: orange;',
    info: 'color: white;',
    debug: 'color: cyan;'
};

// Define a function to format the arguments for logging. If an argument is an object, it is left as is. Otherwise, it is converted to a string.
const primitiveString = (arg: unknown): string => {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'string') return arg;
    if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint' || typeof arg === 'symbol') return String(arg);
    return JSON.stringify(arg, null, 2) ?? '[unserializable value]';
};
const formatArgs = (args: unknown[]): unknown[] => args.map(arg => typeof arg === 'object' ? arg : primitiveString(arg));

// Define a function to determine if a log should be made based on the server's log level. If the server's log level is 'debug', all logs are allowed.
// If the server's log level is 'info', only 'info', 'warn', and 'error' logs are allowed.
const shouldLog = (level: LogLevel): boolean => {
    return serverInfo && (serverInfo.logLevel === 'debug' || (serverInfo.logLevel === 'info' && level !== 'debug'));
};

// Define a function to format the log message with styles. The filename is styled with a black color and white background.
// The rest of the message is styled based on the log level. If an argument is an object, it is stringified with indentation for readability.
const formatLogMessage = (args: unknown[], filename: string, level: LogLevel) => {
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

// Define a function to create a logger with a filename. This function returns a Proxy object that intercepts calls to the logger methods.
// If the called method exists in the loggerMethods object, a function is returned that formats the arguments and logs the message if allowed.
// If the called method does not exist, an empty function is returned.
export function createLogger(filename: string) {
    return new Proxy(loggerMethods, {
        get: (target, level: LogLevel) => {
            if (level in target) {
                return (...args: unknown[]) => {
                    args = formatArgs(args);

                    if (args.length > 0 && shouldLog(level)) {
                        const logMessage = formatLogMessage(args, filename, level);
                        Reflect.apply(target[level], console, logMessage);
                    }
                };
            } else {
                return () => {}; // Return an empty function if the property does not exist
            }
        }
    });
}
