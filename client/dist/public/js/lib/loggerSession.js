const SESSION_TAGS = [
    'mobile', 'portable', 'shortTime', 'specialGuest', 'neededNext',
    'notResponding', 'skipped', 'inOut', 'recheck', 'pendingRole'
];
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export function clearLoggerSession(storage, npid) {
    const stateKey = `ncs-helper:${npid}`;
    const raw = storage.getItem(stateKey);
    if (raw !== null) {
        let state;
        try {
            state = JSON.parse(raw);
        }
        catch {
            state = null;
        }
        if (isRecord(state)) {
            if (isRecord(state['details'])) {
                for (const details of Object.values(state['details'])) {
                    if (!isRecord(details))
                        continue;
                    for (const tag of SESSION_TAGS)
                        delete details[tag];
                    delete details['tags'];
                }
            }
            state['ioCalls'] = [];
            state['recheckCalls'] = [];
            state['sharedUpdatedAt'] = 0;
            storage.setItem(stateKey, JSON.stringify(state));
        }
        else {
            storage.removeItem(stateKey);
        }
    }
    storage.removeItem(`ncs-helper:session:${npid}`);
}
export function prepareLoggerSession(storage, npid, createdAt) {
    const sessionKey = `ncs-helper:session:${npid}`;
    const session = new Date(createdAt).toISOString();
    if (storage.getItem(sessionKey) !== session) {
        clearLoggerSession(storage, npid);
        storage.setItem(sessionKey, session);
    }
}
//# sourceMappingURL=loggerSession.js.map