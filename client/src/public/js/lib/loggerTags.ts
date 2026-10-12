export interface LoggerTagState {
    liveNetId?: string;
    ioCalls: string[];
    recheckCalls: string[];
    details: Record<string, Record<string, unknown>>;
    sharedUpdatedAt?: number;
    [key: string]: unknown;
}

const OPERATIONAL_TAG_FIELDS = [
    'inOut',
    'recheck',
    'mobile',
    'shortTime',
    'portable',
    'notResponding',
    'neededNext',
    'skipped',
    'specialGuest'
] as const;

// Per-occurrence station data; names, locations and other profile fields persist.
const SESSION_DETAIL_FIELDS = [...OPERATIONAL_TAG_FIELDS, 'note'] as const;

export function resetOperationalTagsForLiveNet(state: LoggerTagState, liveNetId: string): LoggerTagState {
    if (!liveNetId || state.liveNetId === liveNetId) return state;

    const details = Object.fromEntries(
        Object.entries(state.details).map(([callSign, current]) => {
            const next = { ...current };
            SESSION_DETAIL_FIELDS.forEach(field => delete next[field]);
            return [callSign, next];
        })
    );

    return {
        ...state,
        liveNetId,
        ioCalls: [],
        recheckCalls: [],
        sharedUpdatedAt: 0,
        details
    };
}