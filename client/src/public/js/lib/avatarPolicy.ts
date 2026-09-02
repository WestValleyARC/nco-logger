/* hamlive-oss — MIT License. See LICENSE. */

export const AVATAR_CACHE_LIMIT = 256;
export const AVATAR_TRANSIENT_RETRY_MS = 5 * 60 * 1000;
export const AVATAR_DEFINITIVE_TTL_MS = 24 * 60 * 60 * 1000;
export const QRZ_NAME_FRESH_TTL_MS = 24 * 60 * 60 * 1000;

const DEFINITIVE_NO_PHOTO = new Set(['not-found', 'no-data']);
const SUCCESSFUL_NAME_LOOKUP = new Set(['success', 'success-cache']);

export const isDefinitiveNoPhoto = (outcome: string, hasPhoto: boolean): boolean =>
    !hasPhoto && (DEFINITIVE_NO_PHOTO.has(outcome) || ['success', 'success-cache'].includes(outcome));

export const avatarRetryAt = (outcome: string, hasPhoto: boolean, now = Date.now()): number =>
    now + (hasPhoto || isDefinitiveNoPhoto(outcome, hasPhoto)
        ? AVATAR_DEFINITIVE_TTL_MS
        : AVATAR_TRANSIENT_RETRY_MS);

export const isQrzNameFresh = (
    outcome: string,
    nameVersion: unknown,
    requiredNameVersion: number,
    checkedAt: unknown,
    now = Date.now()
): boolean => SUCCESSFUL_NAME_LOOKUP.has(outcome) && nameVersion === requiredNameVersion &&
    Number(checkedAt || 0) > now - QRZ_NAME_FRESH_TTL_MS;

export const selectNcoAvatarSource = (qrzPhoto: string, resolvedPhoto: string, defaultAvatar: string): string =>
    qrzPhoto && resolvedPhoto ? resolvedPhoto : defaultAvatar;

export const setBoundedCache = <K, V>(cache: Map<K, V>, key: K, value: V, limit = AVATAR_CACHE_LIMIT): void => {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > limit) cache.delete(cache.keys().next().value as K);
};
