/* hamlive-oss — MIT License. See LICENSE. */

const SESSION_TAGS = [
    'mobile', 'portable', 'shortTime', 'specialGuest', 'neededNext',
    'notResponding', 'skipped', 'inOut', 'recheck', 'pendingRole'
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

export function clearLoggerSession(storage: Storage, npid: string): void {
    const stateKey = `ncs-helper:${npid}`;
    const raw = storage.getItem(stateKey);
    if (raw !== null) {
        let state: unknown;
        try {
            state = JSON.parse(raw);
        } catch {
            state = null;
        }
        if (isRecord(state)) {
            if (isRecord(state['details'])) {
                for (const details of Object.values(state['details'])) {
                    if (!isRecord(details)) continue;
                    for (const tag of SESSION_TAGS) delete details[tag];
                    delete details['tags'];
                }
            }
            state['ioCalls'] = [];
            state['recheckCalls'] = [];
            state['sharedUpdatedAt'] = 0;
            storage.setItem(stateKey, JSON.stringify(state));
        } else {
            storage.removeItem(stateKey);
        }
    }
    storage.removeItem(`ncs-helper:session:${npid}`);
}

export function prepareLoggerSession(storage: Storage, npid: string, createdAt: Date | string): void {
    // A recurring net reuses its profile ID, but each live net has a new creation time.
    const sessionKey = `ncs-helper:session:${npid}`;
    const session = new Date(createdAt).toISOString();
    if (storage.getItem(sessionKey) !== session) {
        clearLoggerSession(storage, npid);
        storage.setItem(sessionKey, session);
    }
}
