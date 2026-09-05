import { NetInfoCommon, StrengthTone, RstReportBase, SigReportType, DefaultInteractionParams, InteractionPayload, SigReportInteractionPayload, NPID } from '#@client/types/commonTypes.js';
export declare class EndPointReponseError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
export declare class NetNotFoundError extends Error {
    constructor(message?: string);
}
export declare const isObject: (obj: unknown) => obj is Record<string, unknown>;
export declare const isStringOrNull: (value: unknown) => value is string | null;
type TypeGuard<T> = (obj: unknown) => obj is T;
export declare const isEndPointResponseError: (obj: unknown) => obj is EndPointReponseError;
export declare const isServerInfo: TypeGuard<ServerInfo>;
export declare const isEndPointResponse: TypeGuard<EndPointResponse>;
export declare const isClient: TypeGuard<Client>;
export declare const isMongoId: (value: unknown) => boolean;
export declare const isNpid: (value: unknown) => value is NPID;
export declare const isStation: TypeGuard<Station>;
export declare const netInfoCommonFields: Record<keyof NetInfoCommon, (value: unknown) => boolean>;
export declare const isNetInfo: TypeGuard<NetInfo>;
export declare const isLiveNetPresenceResponse: TypeGuard<LiveNetPresenceResponse>;
export declare const isLiveNetDetailsResponse: TypeGuard<LiveNetDetailsResponse>;
export declare const isFollowListNetInfo: TypeGuard<FollowListNetInfo>;
export declare const isFollowListLimits: TypeGuard<FollowListLimits>;
export declare const isFollowListMessage: TypeGuard<FollowListMessage>;
export declare const isFollowListResponse: TypeGuard<FollowListResponse>;
export declare const isCommandItem: TypeGuard<CommandItem>;
export declare const isAlias: TypeGuard<Alias>;
export declare const isCommandList: TypeGuard<CommandList>;
export declare const isCommandResponse: TypeGuard<CommandResponse>;
export declare const isFlexOptions: TypeGuard<FlexOptions>;
export declare const isSigReportType: (value: unknown) => value is SigReportType;
export declare const isRstReportBase: (value: unknown) => value is RstReportBase;
export declare const isRstReportBaseWithTone: (value: unknown) => value is RstReportBase & {
    t: StrengthTone;
};
export declare const isInteractionPayload: <T = DefaultInteractionParams>(value: unknown, isActionParams?: (value: unknown) => value is T) => value is InteractionPayload<T>;
export declare const isSigReportInteractionPayload: (value: unknown) => value is SigReportInteractionPayload;
export declare const isSystemNotification: TypeGuard<SystemNotification>;
export declare const isSystemNotificationResponse: TypeGuard<SystemNotificationResponse>;
export {};
//# sourceMappingURL=commonTypesupport.d.ts.map