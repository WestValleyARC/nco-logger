/* hamlive-oss — MIT License. See LICENSE. */

import { ObjectId } from 'mongodb';

// System Notifications
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

// Node Environment type
export type NodeEnv = 'development' | 'production' | null;

/**
 * Ham.Live user roles within a net
 * Hierarchy: netcontrol (0) > netlogger (1) > netrelay (2) > netuser (3)
 *
 * NOTE: Role hierarchy/levels are defined in sharedNetOps.js:roleLevels
 */
export type HamLiveRole = 'netcontrol' | 'netlogger' | 'netrelay' | 'netuser';

// StringAble type
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
    r: Rating; // Readability
    s: StrengthTone; // Signal Strength
};

export type ReportByType =
    | {
          type: 'RST';
          report: RstReportBase & { t: StrengthTone }; // Tone is mandatory
      }
    | {
          type: 'RS';
          report: RstReportBase; // Tone is optional
      }
    | {
          type: null;
          report?: undefined;
      };

// InteractionPayload type
export interface InteractionPayload<T = DefaultInteractionParams> {
    action: string;
    actionParams: T;
    dstStation: string;
}

export type SigReportInteractionPayload = InteractionPayload<ReportByType['report']>;

// ServerInfo type
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
    logLevel: 'info' | 'debug'; // Restrict logLevel to 'info' or 'debug'
    ts: Date;
}

// EndPointResponse type
export interface EndPointResponse {
    endpointVersion: string;
    now: string;
    ssePath: string | null;
    ttlMs: number;
    hash: string;
    errorMessage?: string;
    errorHash?: string;
}

// Station type
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

// Client type
export interface Client {
    callSign: string;
    level: number;
}

// NetInfoCommon type
export interface NetInfoCommon {
    title: string;
    frequency: string;
    mode: string;
    modeDetails: string;
    permanent: boolean;
}

// NetInfo type
export interface NetInfo extends NetInfoCommon {
    notes: string;
    invisible: boolean;
    restrictedSigReports: boolean;
    countdownTimer: number;
    createdAt: Date | string;
    started: boolean;
    sigReportType: string | null;
}

// FollowListNet type
export interface FollowListNetInfo extends NetInfoCommon {
    id: NPID;
    followCount: number;
}

// FollowListLimits type
export interface FollowListLimits {
    maxFollowersPerNet: number;
    maxFollowingPerUser: number;
}

// FollowListMessage type
export interface FollowListMessage {
    netlist: FollowListNetInfo[];
    limits: FollowListLimits;
}

// FollowListResponse type
export interface FollowListResponse extends EndPointResponse {
    message: FollowListMessage;
}


// LiveNetDetailsResponse type
export interface LiveNetDetailsResponse extends EndPointResponse {
    client?: Client;
    net: NetInfo;
    stations: Station[];
}

// LiveNetPresenceResponse type
export interface LiveNetPresenceResponse extends EndPointResponse {
    client: Client;
}

// Admin Commands type
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

//FlexOptions type
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
    qrzCheckInWaitMs: number;
    qrzReqQuota: number;
    maxFollowersPerNet: number;
    maxFollowingPerUser: number;
    sigReportTypeByMode: Record<string, SigReportType>;
}
