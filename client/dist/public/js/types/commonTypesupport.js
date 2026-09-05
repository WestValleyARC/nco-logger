export class EndPointReponseError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'ReponseError';
    }
}
export class NetNotFoundError extends Error {
    constructor(message = 'Net not found') {
        super(message);
        this.name = 'NetNotFoundError';
    }
}
export const isObject = (obj) => typeof obj === 'object' && obj !== null;
export const isStringOrNull = (value) => typeof value === 'string' || value === null;
const createTypeGuard = (fields, logErrors = false) => {
    return (obj) => {
        if (!isObject(obj)) {
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
export const isEndPointResponseError = (obj) => obj instanceof EndPointReponseError;
export const isServerInfo = createTypeGuard({
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
    ssePath: isStringOrNull,
    ttlMs: value => typeof value === 'number',
    hash: value => typeof value === 'string',
    errorMessage: value => value === undefined || typeof value === 'string',
    errorHash: value => value === undefined || typeof value === 'string'
};
export const isEndPointResponse = createTypeGuard(endPointResponseFields);
export const isClient = createTypeGuard({
    callSign: value => typeof value === 'string',
    level: value => typeof value === 'number'
});
export const isMongoId = (value) => {
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
export const isNpid = (value) => {
    return isMongoId(value);
};
export const isStation = createTypeGuard({
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
    userProfile: value => value === null || isMongoId(value),
    averageSigReport: value => value === null || typeof value === 'string'
}, true);
export const netInfoCommonFields = {
    title: value => typeof value === 'string',
    frequency: value => typeof value === 'string',
    mode: value => typeof value === 'string',
    modeDetails: value => typeof value === 'string',
    permanent: value => typeof value === 'boolean'
};
export const isNetInfo = createTypeGuard({
    ...netInfoCommonFields,
    notes: value => typeof value === 'string',
    invisible: value => typeof value === 'boolean',
    restrictedSigReports: value => typeof value === 'boolean',
    countdownTimer: value => typeof value === 'number',
    createdAt: value => typeof value === 'string' || value instanceof Date,
    started: value => typeof value === 'boolean',
    sigReportType: value => typeof value === 'string' || value === null
});
export const isLiveNetPresenceResponse = createTypeGuard({
    ...endPointResponseFields,
    client: isClient
});
export const isLiveNetDetailsResponse = createTypeGuard({
    ...endPointResponseFields,
    client: value => value === undefined || isClient(value),
    net: isNetInfo,
    stations: value => Array.isArray(value) && value.every(isStation)
}, true);
const isProfileSchedulingSummary = createTypeGuard({
    enabled: value => typeof value === 'boolean',
    summary: value => typeof value === 'string' || value === null,
    timezone: value => typeof value === 'string' || value === null,
    nextOccurrence: value => value === null || (isObject(value) && typeof value['id'] === 'string' &&
        (value['startAt'] instanceof Date || typeof value['startAt'] === 'string') &&
        ['scheduled', 'preparing', 'live'].includes(String(value['status']))),
    preparing: value => typeof value === 'boolean',
    onAir: value => typeof value === 'boolean',
    canPrepare: value => typeof value === 'boolean',
    preparationOpensAt: value => value === null || value instanceof Date || typeof value === 'string',
    actionUrl: value => typeof value === 'string' || value === null
});
export const isFollowListNetInfo = createTypeGuard({
    ...netInfoCommonFields,
    id: value => isMongoId(value),
    followCount: value => typeof value === 'number',
    scheduling: value => value === undefined || isProfileSchedulingSummary(value)
});
export const isFollowListLimits = createTypeGuard({
    maxFollowersPerNet: value => typeof value === 'number',
    maxFollowingPerUser: value => typeof value === 'number'
});
export const isFollowListMessage = createTypeGuard({
    limits: isFollowListLimits,
    netlist: value => Array.isArray(value) && value.every(isFollowListNetInfo)
});
export const isFollowListResponse = createTypeGuard({
    ...endPointResponseFields,
    message: isFollowListMessage
});
export const isCommandItem = createTypeGuard({
    command: value => typeof value === 'string',
    label: value => typeof value === 'string',
    verboseUsage: value => typeof value === 'string',
    compactUsage: value => typeof value === 'string',
    advanced: value => typeof value === 'boolean'
});
export const isAlias = createTypeGuard({
    alias: value => typeof value === 'string',
    command: value => typeof value === 'string'
});
export const isCommandList = createTypeGuard({
    ...endPointResponseFields,
    commandDetail: value => Array.isArray(value) && value.every(isCommandItem),
    aliases: value => Array.isArray(value) && value.every(isAlias),
    role: value => value === undefined || typeof value === 'string',
    level: value => value === undefined || typeof value === 'number'
});
export const isCommandResponse = createTypeGuard({
    ...endPointResponseFields,
    message: value => typeof value === 'string'
});
export const isFlexOptions = createTypeGuard({
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
    qrzCheckInWaitMs: value => typeof value === 'number',
    qrzReqQuota: value => typeof value === 'number',
    maxFollowersPerNet: value => typeof value === 'number',
    maxFollowingPerUser: value => typeof value === 'number',
    sigReportTypeByMode: value => isObject(value) && Object.values(value).every(isSigReportType)
});
const isInRange = (value, min, max) => value !== undefined && value >= min && value <= max;
export const isSigReportType = (value) => ['RST', 'RS', null].includes(value);
export const isRstReportBase = (value) => {
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
export const isRstReportBaseWithTone = (value) => {
    if (!isRstReportBase(value))
        return false;
    const report = value;
    const t = parseInt(report.t ?? '');
    return isInRange(t, 1, 9);
};
export const isInteractionPayload = (value, isActionParams = (candidate) => candidate !== undefined || candidate === undefined) => {
    if (typeof value !== 'object' || value === null)
        return false;
    const payload = value;
    const basicChecks = typeof payload.action === 'string' &&
        payload.actionParams !== undefined &&
        typeof payload.dstStation === 'string';
    return basicChecks && isActionParams(payload.actionParams);
};
export const isSigReportInteractionPayload = (value) => {
    return isInteractionPayload(value, (actionParams) => {
        return isRstReportBaseWithTone(actionParams) || isRstReportBase(actionParams);
    });
};
export const isSystemNotification = createTypeGuard({
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
    if (!isObject(value)) {
        return false;
    }
    const obj = value;
    return ('notifications' in obj &&
        Array.isArray(obj['notifications']) &&
        obj['notifications'].every(isSystemNotification) &&
        'count' in obj &&
        typeof obj['count'] === 'number');
};
export const isSystemNotificationResponse = createTypeGuard({
    ...endPointResponseFields,
    message: value => isSystemNotificationMessage(value)
});
//# sourceMappingURL=commonTypesupport.js.map