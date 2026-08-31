/* hamlive-oss — MIT License. See LICENSE. */

const LEGACY_NAME_KEYS = [
    'name', 'nameOverride', 'nameOrigin', 'nameOwnerRole', 'nameChangedAt',
    'nameChangeId', 'nameReleased'
];

function stripLegacyNameState(loggerState) {
    const affectedCallSigns = [];
    const details = loggerState?.details;
    if (!details || typeof details !== 'object') return { changed: false, affectedCallSigns };
    let changed = false;
    for (const [callSign, detail] of Object.entries(details)) {
        const profile = detail?.profile;
        if (!profile || typeof profile !== 'object') continue;
        const hadNameState = LEGACY_NAME_KEYS.some(key => Object.prototype.hasOwnProperty.call(profile, key));
        if (!hadNameState) continue;
        affectedCallSigns.push(String(callSign).toUpperCase());
        changed = true;
        for (const key of LEGACY_NAME_KEYS) delete profile[key];
        if (!Object.keys(profile).length) delete detail.profile;
    }
    return { changed, affectedCallSigns };
}

module.exports = { LEGACY_NAME_KEYS, stripLegacyNameState };
