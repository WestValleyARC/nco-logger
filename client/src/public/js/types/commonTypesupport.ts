/* hamlive-oss — MIT License. See LICENSE. */

import {
    ServerInfo,
    EndPointResponse,
    Station,
    NetInfo,
    FollowListNetInfo,
    ProfileSchedulingSummary,
    FollowListResponse,
    FollowListLimits,
    FollowListMessage,
    NetInfoCommon,
    LiveNetDetailsResponse,
    FlexOptions,
    CommandItem,
    Alias,
    CommandList,
    CommandResponse,
    Client,
    LiveNetPresenceResponse,
    StrengthTone,
    ReportByType,
    RstReportBase,
    SigReportType,
    DefaultInteractionParams,
    InteractionPayload,
    SigReportInteractionPayload,
    NPID,
    SystemNotification,
    SystemNotificationResponse
} from '#@client/types/commonTypes.js';

/*
The typesupport.ts file contains typeguards (and custom Error classes) 
for shared types.ts. It's compiled to ES6 for the client and CommonJS for the server. 
This file is copied from the client to the server source tree. Always edit this version,
not the one in the server source tree.
*/

// EndPointReponseError type
export class EndPointReponseError extends Error {
    constructor(
        message: string,
        public readonly status: number
    ) {
        super(message);
        this.name = 'ReponseError';
    }
}

// NetNotFoundError type - used by realtimeClients.ts to cleanup SSE Items
export class NetNotFoundError extends Error {
    constructor(message = 'Net not found') {
        super(message);
        this.name = 'NetNotFoundError';
    }
}

// General utility typesupport
export const isObject = (obj: unknown): obj is Record<string, unknown> => typeof obj === 'object' && obj !== null;
export const isStringOrNull = (value: unknown): value is string | null => typeof value === 'string' || value === null;

// Type and typeguard pairs
type TypeGuard<T> = (obj: unknown) => obj is T;

const createTypeGuard = <T>(
    fields: Record<keyof T, (value: unknown) => boolean>,
    logErrors: boolean = false
): TypeGuard<T> => {
    return (obj: unknown): obj is T => {
        if (!isObject(obj)) {
            if (logErrors) console.error('Failed: Not an object');
            return false;
        }
        for (const key in fields) {
            if (!fields[key]((obj as T)[key])) {
                if (logErrors) console.error(`Failed at key: ${key as string}, value: ${String((obj as T)[key])}`);
                return false;
            }
        }
        return true;
    };
};

// EndPointReponseError typeguard
export const isEndPointResponseError = (obj: unknown): obj is EndPointReponseError =>
    obj instanceof EndPointReponseError;

// ServerInfo typeguard
export const isServerInfo = createTypeGuard<ServerInfo>({
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
    logLevel: value => value === 'info' || value === 'debug', // Check if logLevel is 'info' or 'debug'
    ts: value => value instanceof Date
});

// Fields for EndPointResponse
const endPointResponseFields: Record<keyof EndPointResponse, (value: unknown) => boolean> = {
    endpointVersion: value => typeof value === 'string',
    now: value => typeof value === 'string',
    ssePath: isStringOrNull,
    ttlMs: value => typeof value === 'number',
    hash: value => typeof value === 'string',
    errorMessage: value => value === undefined || typeof value === 'string',
    errorHash: value => value === undefined || typeof value === 'string'
};

// EndPointResponse typeguard
export const isEndPointResponse = createTypeGuard<EndPointResponse>(endPointResponseFields);

// Client typeguard
export const isClient = createTypeGuard<Client>({
    callSign: value => typeof value === 'string',
    level: value => typeof value === 'number'
});

// MongoId typeguard
export const isMongoId = (value: unknown): boolean => {
    const objectIdRegex = /^(new ObjectId\()?[a-fA-F0-9]{24}\)?$/;
    if (typeof value === 'string') {
        return objectIdRegex.test(value);
    } else if (typeof value === 'object' && value !== null) {
        const valueWithToHexString = value as { toHexString?: () => string };
        return typeof valueWithToHexString.toHexString === 'function';
    }
    return false;
};

// NPID typeguard
export const isNpid = (value: unknown): value is NPID => {
    return isMongoId(value);
};

// Station typeguard
export const isStation = createTypeGuard<Station>(
    {
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
    },
    true
);

// Common fields for NetInfo
export const netInfoCommonFields: Record<keyof NetInfoCommon, (value: unknown) => boolean> = {
    title: value => typeof value === 'string',
    frequency: value => typeof value === 'string',
    mode: value => typeof value === 'string',
    modeDetails: value => typeof value === 'string',
    permanent: value => typeof value === 'boolean'
};

// NetInfo typeguard
export const isNetInfo = createTypeGuard<NetInfo>({
    ...netInfoCommonFields,
    notes: value => typeof value === 'string',
    invisible: value => typeof value === 'boolean',
    restrictedSigReports: value => typeof value === 'boolean',
    countdownTimer: value => typeof value === 'number',
    createdAt: value => typeof value === 'string' || value instanceof Date,
    started: value => typeof value === 'boolean',
    sigReportType: value => typeof value === 'string' || value === null
});

// LiveNetPresenceResponse typeguard
export const isLiveNetPresenceResponse = createTypeGuard<LiveNetPresenceResponse>({
    ...endPointResponseFields,
    client: isClient
});

// LiveNetDetailsResponse typeguard
export const isLiveNetDetailsResponse = createTypeGuard<LiveNetDetailsResponse>(
    {
        ...endPointResponseFields,
        client: value => value === undefined || isClient(value),
        net: isNetInfo,
        stations: value => Array.isArray(value) && value.every(isStation)
    },
    true
);

// FollowListNetInfo typeguard
const isProfileSchedulingSummary = createTypeGuard<ProfileSchedulingSummary>({
    enabled: value => typeof value === 'boolean',
    summary: value => typeof value === 'string' || value === null,
    timezone: value => typeof value === 'string' || value === null,
    nextOccurrence: value => value === null || (
        isObject(value) && typeof value['id'] === 'string' &&
        (value['startAt'] instanceof Date || typeof value['startAt'] === 'string') &&
        ['scheduled', 'preparing', 'live'].includes(String(value['status']))
    ),
    preparing: value => typeof value === 'boolean',
    onAir: value => typeof value === 'boolean',
    canPrepare: value => typeof value === 'boolean',
    preparationOpensAt: value => value === null || value instanceof Date || typeof value === 'string',
    actionUrl: value => typeof value === 'string' || value === null
});

export const isFollowListNetInfo = createTypeGuard<FollowListNetInfo>({
    ...netInfoCommonFields,
    id: value => isMongoId(value),
    followCount: value => typeof value === 'number',
    scheduling: value => value === undefined || isProfileSchedulingSummary(value)
});

// FollowListLimits typeguard
export const isFollowListLimits = createTypeGuard<FollowListLimits>({
    maxFollowersPerNet: value => typeof value === 'number',
    maxFollowingPerUser: value => typeof value === 'number'
});

// FollowListMessage typeguard
export const isFollowListMessage = createTypeGuard<FollowListMessage>({
    limits: isFollowListLimits,
    netlist: value => Array.isArray(value) && value.every(isFollowListNetInfo)
});

// FollowListResponse typeguard
export const isFollowListResponse = createTypeGuard<FollowListResponse>({
    ...endPointResponseFields,
    message: isFollowListMessage
});



// Type guard for CommandItem
export const isCommandItem = createTypeGuard<CommandItem>({
    command: value => typeof value === 'string',
    label: value => typeof value === 'string',
    verboseUsage: value => typeof value === 'string',
    compactUsage: value => typeof value === 'string',
    advanced: value => typeof value === 'boolean'
});

// Type guard for Alias
export const isAlias = createTypeGuard<Alias>({
    alias: value => typeof value === 'string',
    command: value => typeof value === 'string'
});

// Type guard for CommandList
export const isCommandList = createTypeGuard<CommandList>({
    ...endPointResponseFields,
    commandDetail: value => Array.isArray(value) && value.every(isCommandItem),
    aliases: value => Array.isArray(value) && value.every(isAlias),
    role: value => value === undefined || typeof value === 'string',
    level: value => value === undefined || typeof value === 'number'
});

// Type guard for CommandResponse
export const isCommandResponse = createTypeGuard<CommandResponse>({
    ...endPointResponseFields,
    message: value => typeof value === 'string'
});

// FlexOptions typeguard
export const isFlexOptions = createTypeGuard<FlexOptions>({
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

// Helper function to check if a value is within a certain range
const isInRange = (value: number | undefined, min: number, max: number): boolean =>
    value !== undefined && value >= min && value <= max;

// SigReportType typeguard
export const isSigReportType = (value: unknown): value is SigReportType =>
    ['RST', 'RS', null].includes(value as SigReportType);

export const isRstReportBase = (value: unknown): value is RstReportBase => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const report = value as Partial<RstReportBase>;
    const basicChecks = typeof report.r === 'number' && typeof report.s === 'number';

    if (!basicChecks) {
        return false;
    }

    const r = parseInt(report.r ?? '');
    const s = parseInt(report.s ?? '');

    const rangeCheck = isInRange(r, 1, 5) && isInRange(s, 1, 9);

    return rangeCheck;
};

export const isRstReportBaseWithTone = (value: unknown): value is RstReportBase & { t: StrengthTone } => {
    if (!isRstReportBase(value)) return false;

    const report = value as Partial<RstReportBase & { t: StrengthTone }>;
    const t = parseInt(report.t ?? '');

    return isInRange(t, 1, 9);
};

export const isInteractionPayload = <T = DefaultInteractionParams>(
    value: unknown,
    isActionParams: (value: unknown) => value is T = (candidate: unknown): candidate is T => candidate !== undefined || candidate === undefined
): value is InteractionPayload<T> => {
    if (typeof value !== 'object' || value === null) return false;

    const payload = value as Partial<InteractionPayload<T>>;
    const basicChecks =
        typeof payload.action === 'string' &&
        payload.actionParams !== undefined &&
        typeof payload.dstStation === 'string';

    return basicChecks && isActionParams(payload.actionParams);
};

export const isSigReportInteractionPayload = (value: unknown): value is SigReportInteractionPayload => {
    return isInteractionPayload<ReportByType['report']>(
        value,
        (actionParams: unknown): actionParams is ReportByType['report'] => {
            return isRstReportBaseWithTone(actionParams) || isRstReportBase(actionParams);
        }
    );
};

// SystemNotification typeguard
export const isSystemNotification = createTypeGuard<SystemNotification>({
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

// SystemNotificationMessage typeguard (for the message property)
const isSystemNotificationMessage = (value: unknown): boolean => {
    if (!isObject(value)) {
        return false;
    }
    const obj = value;
    return (
        'notifications' in obj &&
        Array.isArray(obj['notifications']) &&
        obj['notifications'].every(isSystemNotification) &&
        'count' in obj &&
        typeof obj['count'] === 'number'
    );
};

// SystemNotificationResponse typeguard
export const isSystemNotificationResponse = createTypeGuard<SystemNotificationResponse>({
    ...endPointResponseFields,
    message: value => isSystemNotificationMessage(value)
});
