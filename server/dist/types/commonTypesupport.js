"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSystemNotificationResponse = exports.isSystemNotification = exports.isSigReportInteractionPayload = exports.isInteractionPayload = exports.isRstReportBaseWithTone = exports.isRstReportBase = exports.isSigReportType = exports.isFlexOptions = exports.isCommandResponse = exports.isCommandList = exports.isAlias = exports.isCommandItem = exports.isFollowListResponse = exports.isFollowListMessage = exports.isFollowListLimits = exports.isFollowListNetInfo = exports.isLiveNetDetailsResponse = exports.isLiveNetPresenceResponse = exports.isNetInfo = exports.netInfoCommonFields = exports.isStation = exports.isNpid = exports.isMongoId = exports.isClient = exports.isEndPointResponse = exports.isServerInfo = exports.isEndPointResponseError = exports.isStringOrNull = exports.isObject = exports.NetNotFoundError = exports.EndPointReponseError = void 0;
class EndPointReponseError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'ReponseError';
    }
}
exports.EndPointReponseError = EndPointReponseError;
class NetNotFoundError extends Error {
    constructor(message = 'Net not found') {
        super(message);
        this.name = 'NetNotFoundError';
    }
}
exports.NetNotFoundError = NetNotFoundError;
const isObject = (obj) => typeof obj === 'object' && obj !== null;
exports.isObject = isObject;
const isStringOrNull = (value) => typeof value === 'string' || value === null;
exports.isStringOrNull = isStringOrNull;
const createTypeGuard = (fields, logErrors = false) => {
    return (obj) => {
        if (!(0, exports.isObject)(obj)) {
            if (logErrors)
                console.error('Failed: Not an object');
            return false;
        }
        for (const key in fields) {
            if (!fields[key](obj[key])) {
                if (logErrors)
                    console.error(`Failed at key: ${key}, value: ${String(obj[key])}`);
                return false;
            }
        }
        return true;
    };
};
const isEndPointResponseError = (obj) => obj instanceof EndPointReponseError;
exports.isEndPointResponseError = isEndPointResponseError;
exports.isServerInfo = createTypeGuard({
    nodeEnv: value => value === 'production' || value === 'development',
    app: value => typeof value === 'string',
    view: value => typeof value === 'string',
    requestRateFactor: value => typeof value === 'number',
    awayInMs: value => typeof value === 'number',
    httpClientTimeout: value => typeof value === 'number',
    cmdHelpUrl: value => typeof value === 'string',
    isLoggedIn: value => typeof value === 'boolean',
    newAccount: value => typeof value === 'boolean',
    callSign: value => typeof value === 'string' || value === null,
    displayName: value => typeof value === 'string' || value === null,
    userId: value => typeof value === 'string' || value === null,
    chat: value => typeof value === 'boolean',
    logLevel: value => value === 'info' || value === 'debug',
    ts: value => value instanceof Date
});
const endPointResponseFields = {
    endpointVersion: value => typeof value === 'string',
    now: value => typeof value === 'string',
    ssePath: exports.isStringOrNull,
    ttlMs: value => typeof value === 'number',
    hash: value => typeof value === 'string',
    errorMessage: value => value === undefined || typeof value === 'string',
    errorHash: value => value === undefined || typeof value === 'string'
};
exports.isEndPointResponse = createTypeGuard(endPointResponseFields);
exports.isClient = createTypeGuard({
    callSign: value => typeof value === 'string',
    level: value => typeof value === 'number'
});
const isMongoId = (value) => {
    const objectIdRegex = /^(new ObjectId\()?[a-fA-F0-9]{24}\)?$/;
    if (typeof value === 'string') {
        return objectIdRegex.test(value);
    }
    else if (typeof value === 'object' && value !== null) {
        const valueWithToHexString = value;
        return typeof valueWithToHexString.toHexString === 'function';
    }
    return false;
};
exports.isMongoId = isMongoId;
const isNpid = (value) => {
    return (0, exports.isMongoId)(value);
};
exports.isNpid = isNpid;
exports.isStation = createTypeGuard({
    callSign: value => typeof value === 'string',
    checkedState: value => value === null || typeof value === 'boolean',
    checkedInAt: value => typeof value === 'string' || value === null || value instanceof Date,
    presence: value => typeof value === 'string',
    role: value => typeof value === 'string',
    level: value => typeof value === 'number',
    hand: value => typeof value === 'boolean',
    highlight: value => typeof value === 'boolean',
    photo: value => value === null || typeof value === 'string',
    displayName: value => value === null || typeof value === 'string',
    location: value => value === null || typeof value === 'string',
    chatEnabled: value => typeof value === 'boolean',
    userProfile: value => value === null || (0, exports.isMongoId)(value),
    averageSigReport: value => value === null || typeof value === 'string'
}, true);
exports.netInfoCommonFields = {
    title: value => typeof value === 'string',
    frequency: value => typeof value === 'string',
    mode: value => typeof value === 'string',
    modeDetails: value => typeof value === 'string',
    permanent: value => typeof value === 'boolean'
};
exports.isNetInfo = createTypeGuard({
    ...exports.netInfoCommonFields,
    notes: value => typeof value === 'string',
    invisible: value => typeof value === 'boolean',
    restrictedSigReports: value => typeof value === 'boolean',
    countdownTimer: value => typeof value === 'number',
    createdAt: value => typeof value === 'string' || value instanceof Date,
    started: value => typeof value === 'boolean',
    sigReportType: value => typeof value === 'string' || value === null
});
exports.isLiveNetPresenceResponse = createTypeGuard({
    ...endPointResponseFields,
    client: exports.isClient
});
exports.isLiveNetDetailsResponse = createTypeGuard({
    ...endPointResponseFields,
    client: value => value === undefined || (0, exports.isClient)(value),
    net: exports.isNetInfo,
    stations: value => Array.isArray(value) && value.every(exports.isStation)
}, true);
exports.isFollowListNetInfo = createTypeGuard({
    ...exports.netInfoCommonFields,
    id: value => (0, exports.isMongoId)(value),
    followCount: value => typeof value === 'number'
});
exports.isFollowListLimits = createTypeGuard({
    maxFollowersPerNet: value => typeof value === 'number',
    maxFollowingPerUser: value => typeof value === 'number'
});
exports.isFollowListMessage = createTypeGuard({
    limits: exports.isFollowListLimits,
    netlist: value => Array.isArray(value) && value.every(exports.isFollowListNetInfo)
});
exports.isFollowListResponse = createTypeGuard({
    ...endPointResponseFields,
    message: exports.isFollowListMessage
});
exports.isCommandItem = createTypeGuard({
    command: value => typeof value === 'string',
    label: value => typeof value === 'string',
    verboseUsage: value => typeof value === 'string',
    compactUsage: value => typeof value === 'string',
    advanced: value => typeof value === 'boolean'
});
exports.isAlias = createTypeGuard({
    alias: value => typeof value === 'string',
    command: value => typeof value === 'string'
});
exports.isCommandList = createTypeGuard({
    ...endPointResponseFields,
    commandDetail: value => Array.isArray(value) && value.every(exports.isCommandItem),
    aliases: value => Array.isArray(value) && value.every(exports.isAlias),
    role: value => value === undefined || typeof value === 'string',
    level: value => value === undefined || typeof value === 'number'
});
exports.isCommandResponse = createTypeGuard({
    ...endPointResponseFields,
    message: value => typeof value === 'string'
});
exports.isFlexOptions = createTypeGuard({
    chat: value => typeof value === 'boolean',
    email: value => typeof value === 'boolean',
    maxNetsPerUser: value => typeof value === 'number',
    maxOwnersPerNet: value => typeof value === 'number',
    baseTtlMs: value => typeof value === 'number',
    awayInMs: value => typeof value === 'number',
    httpClientTimeout: value => typeof value === 'number',
    requestRateFactor: value => typeof value === 'number',
    qrzDataReqTimeoutMs: value => typeof value === 'number',
    qrzSessionReqTimeoutMs: value => typeof value === 'number',
    qrzReqQuota: value => typeof value === 'number',
    maxFollowersPerNet: value => typeof value === 'number',
    maxFollowingPerUser: value => typeof value === 'number',
    sigReportTypeByMode: value => (0, exports.isObject)(value) && Object.values(value).every(exports.isSigReportType)
});
const isInRange = (value, min, max) => value !== undefined && value >= min && value <= max;
const isSigReportType = (value) => ['RST', 'RS', null].includes(value);
exports.isSigReportType = isSigReportType;
const isRstReportBase = (value) => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const report = value;
    const basicChecks = typeof report.r === 'number' && typeof report.s === 'number';
    if (!basicChecks) {
        return false;
    }
    const r = parseInt(report.r ?? '');
    const s = parseInt(report.s ?? '');
    const rangeCheck = isInRange(r, 1, 5) && isInRange(s, 1, 9);
    return rangeCheck;
};
exports.isRstReportBase = isRstReportBase;
const isRstReportBaseWithTone = (value) => {
    if (!(0, exports.isRstReportBase)(value))
        return false;
    const report = value;
    const t = parseInt(report.t ?? '');
    return isInRange(t, 1, 9);
};
exports.isRstReportBaseWithTone = isRstReportBaseWithTone;
const isInteractionPayload = (value, isActionParams = (_) => true) => {
    if (typeof value !== 'object' || value === null)
        return false;
    const payload = value;
    const basicChecks = typeof payload.action === 'string' &&
        payload.actionParams !== undefined &&
        typeof payload.dstStation === 'string';
    return basicChecks && isActionParams(payload.actionParams);
};
exports.isInteractionPayload = isInteractionPayload;
const isSigReportInteractionPayload = (value) => {
    return (0, exports.isInteractionPayload)(value, (actionParams) => {
        return (0, exports.isRstReportBaseWithTone)(actionParams) || (0, exports.isRstReportBase)(actionParams);
    });
};
exports.isSigReportInteractionPayload = isSigReportInteractionPayload;
exports.isSystemNotification = createTypeGuard({
    id: value => typeof value === 'string',
    notificationId: value => typeof value === 'string',
    title: value => typeof value === 'string',
    message: value => typeof value === 'string',
    severity: value => value === 'info' || value === 'warning' || value === 'critical',
    active: value => typeof value === 'boolean',
    expiresAt: value => value === undefined || value === null || value instanceof Date || typeof value === 'string',
    createdAt: value => value instanceof Date || typeof value === 'string',
    updatedAt: value => value instanceof Date || typeof value === 'string'
});
const isSystemNotificationMessage = (value) => {
    if (!(0, exports.isObject)(value)) {
        return false;
    }
    const obj = value;
    return ('notifications' in obj &&
        Array.isArray(obj['notifications']) &&
        obj['notifications'].every(exports.isSystemNotification) &&
        'count' in obj &&
        typeof obj['count'] === 'number');
};
exports.isSystemNotificationResponse = createTypeGuard({
    ...endPointResponseFields,
    message: value => isSystemNotificationMessage(value)
});
