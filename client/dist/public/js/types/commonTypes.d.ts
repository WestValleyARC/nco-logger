import { ObjectId } from 'mongodb';
export interface SystemNotification {
    id: string;
    notificationId: string;
    title: string;
    message: string;
    severity: 'info' | 'warning' | 'critical';
    active: boolean;
    expiresAt?: Date | string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
}
export interface SystemNotificationResponse extends EndPointResponse {
    message: {
        notifications: SystemNotification[];
        count: number;
    };
}
export type NodeEnv = 'development' | 'production' | null;
export type HamLiveRole = 'netcontrol' | 'netlogger' | 'netrelay' | 'netuser';
export type StringAble = {
    toString(): string;
};
export type NPID = ObjectId;
export type SimpleInteractionParams = {
    state: boolean;
};
export type DefaultInteractionParams = object;
export type SigReportType = 'RST' | 'RS' | null;
export type Rating = '1' | '2' | '3' | '4' | '5';
export type StrengthTone = Rating | '6' | '7' | '8' | '9';
export type RstReportBase = {
    r: Rating;
    s: StrengthTone;
};
export type ReportByType = {
    type: 'RST';
    report: RstReportBase & {
        t: StrengthTone;
    };
} | {
    type: 'RS';
    report: RstReportBase;
} | {
    type: null;
    report?: undefined;
};
export interface InteractionPayload<T = DefaultInteractionParams> {
    action: string;
    actionParams: T;
    dstStation: string;
}
export type SigReportInteractionPayload = InteractionPayload<ReportByType['report']>;
export interface ServerInfo {
    nodeEnv: NodeEnv;
    app: string;
    view: string;
    requestRateFactor: number;
    httpClientTimeout: number;
    awayInMs: number;
    cmdHelpUrl: string;
    isLoggedIn: boolean;
    newAccount: boolean;
    callSign: string | null;
    displayName: string | null;
    chat: boolean;
    userId: string | null;
    logLevel: 'info' | 'debug';
    ts: Date;
}
export interface EndPointResponse {
    endpointVersion: string;
    now: string;
    ssePath: string | null;
    ttlMs: number;
    hash: string;
    errorMessage?: string;
    errorHash?: string;
}
export interface Station {
    callSign: string;
    checkedState: boolean | null;
    checkedInAt: string | Date | null;
    presence: 'online' | 'offline';
    role: HamLiveRole;
    level: number;
    hand: boolean;
    highlight: boolean;
    photo: string | null;
    displayName: string | null;
    location: string | null;
    chatEnabled: boolean;
    userProfile: ObjectId | string | null;
    averageSigReport: string | null;
}
export interface Client {
    callSign: string;
    level: number;
}
export interface NetInfoCommon {
    title: string;
    frequency: string;
    mode: string;
    modeDetails: string;
    permanent: boolean;
}
export interface NetInfo extends NetInfoCommon {
    notes: string;
    invisible: boolean;
    restrictedSigReports: boolean;
    countdownTimer: number;
    createdAt: Date | string;
    started: boolean;
    sigReportType: string | null;
}
export interface FollowListNetInfo extends NetInfoCommon {
    id: NPID;
    followCount: number;
}
export interface FollowListLimits {
    maxFollowersPerNet: number;
    maxFollowingPerUser: number;
}
export interface FollowListMessage {
    netlist: FollowListNetInfo[];
    limits: FollowListLimits;
}
export interface FollowListResponse extends EndPointResponse {
    message: FollowListMessage;
}
export interface LiveNetDetailsResponse extends EndPointResponse {
    client?: Client;
    net: NetInfo;
    stations: Station[];
}
export interface LiveNetPresenceResponse extends EndPointResponse {
    client: Client;
}
export interface CommandItem {
    command: string;
    label: string;
    verboseUsage: string;
    compactUsage: string;
    advanced: boolean;
}
export interface Alias {
    alias: string;
    command: string;
}
export interface CommandList extends EndPointResponse {
    commandDetail: CommandItem[];
    aliases: Alias[];
    role?: string;
    level?: number;
}
export interface CommandResponse extends EndPointResponse {
    message: string;
}
export interface FlexOptions {
    chat: boolean;
    email: boolean;
    maxNetsPerUser: number;
    maxOwnersPerNet: number;
    baseTtlMs: number;
    awayInMs: number;
    httpClientTimeout: number;
    requestRateFactor: number;
    qrzDataReqTimeoutMs: number;
    qrzSessionReqTimeoutMs: number;
    qrzReqQuota: number;
    maxFollowersPerNet: number;
    maxFollowingPerUser: number;
    sigReportTypeByMode: Record<string, SigReportType>;
}
//# sourceMappingURL=commonTypes.d.ts.map