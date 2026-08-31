export interface IdentifiedChatMessage {
    id: string;
    createdAt: string;
}
export declare const reconcileChatMessages: <T extends IdentifiedChatMessage>(messages: Map<string, T>, incoming: Iterable<T>) => number;
export declare const sortChatMessages: <T extends IdentifiedChatMessage>(messages: Iterable<T>) => T[];
export declare const shouldScrollChatToLatest: (initialLoad: boolean, wasNearBottom: boolean) => boolean;
//# sourceMappingURL=chatState.d.ts.map