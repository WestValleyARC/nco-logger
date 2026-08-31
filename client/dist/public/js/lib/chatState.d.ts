export interface IdentifiedChatMessage {
    id: string;
    createdAt: string;
}
export declare const reconcileChatMessages: <T extends IdentifiedChatMessage>(messages: Map<string, T>, incoming: Iterable<T>) => number;
export declare const sortChatMessages: <T extends IdentifiedChatMessage>(messages: Iterable<T>) => T[];
export declare const shouldScrollChatToLatest: (initialLoad: boolean, wasNearBottom: boolean) => boolean;
export declare const recordPrivateUnread: (counts: Map<string, number>, senderUserId: string, shouldCount: boolean) => void;
export declare const clearPrivateUnread: (counts: Map<string, number>, senderUserId: string) => void;
//# sourceMappingURL=chatState.d.ts.map