export interface LoggerTagState {
    liveNetId?: string;
    ioCalls: string[];
    recheckCalls: string[];
    details: Record<string, Record<string, unknown>>;
    sharedUpdatedAt?: number;
    [key: string]: unknown;
}
export declare function resetOperationalTagsForLiveNet(state: LoggerTagState, liveNetId: string): LoggerTagState;
//# sourceMappingURL=loggerTags.d.ts.map