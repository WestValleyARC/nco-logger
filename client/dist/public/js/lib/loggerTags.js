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
const SESSION_DETAIL_FIELDS = [...OPERATIONAL_TAG_FIELDS, 'note'];
export function resetOperationalTagsForLiveNet(state, liveNetId) {
    if (!liveNetId || state.liveNetId === liveNetId)
        return state;
    const details = Object.fromEntries(Object.entries(state.details).map(([callSign, current]) => {
        const next = { ...current };
        SESSION_DETAIL_FIELDS.forEach(field => delete next[field]);
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