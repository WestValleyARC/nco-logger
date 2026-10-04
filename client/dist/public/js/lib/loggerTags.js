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
];
export function resetOperationalTagsForLiveNet(state, liveNetId) {
    if (!liveNetId || state.liveNetId === liveNetId)
        return state;
    const details = Object.fromEntries(Object.entries(state.details).map(([callSign, current]) => {
        const next = { ...current };
        OPERATIONAL_TAG_FIELDS.forEach(field => delete next[field]);
        return [callSign, next];
    }));
    return {
        ...state,
        liveNetId,
        ioCalls: [],
        recheckCalls: [],
        sharedUpdatedAt: 0,
        details
    };
}
//# sourceMappingURL=loggerTags.js.map