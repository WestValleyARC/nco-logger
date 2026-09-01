export declare const AVATAR_CACHE_LIMIT = 256;
export declare const AVATAR_TRANSIENT_RETRY_MS: number;
export declare const AVATAR_DEFINITIVE_TTL_MS: number;
export declare const isDefinitiveNoPhoto: (outcome: string, hasPhoto: boolean) => boolean;
export declare const avatarRetryAt: (outcome: string, hasPhoto: boolean, now?: number) => number;
export declare const selectNcoAvatarSource: (qrzPhoto: string, resolvedPhoto: string, defaultAvatar: string) => string;
export declare const setBoundedCache: <K, V>(cache: Map<K, V>, key: K, value: V, limit?: number) => void;
//# sourceMappingURL=avatarPolicy.d.ts.map