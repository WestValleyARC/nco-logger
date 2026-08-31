export interface IdentifiedChatMessage {
    id: string;
    createdAt: string;
}
export interface CloseableChatStream {
    close(): void;
}
export declare class SingleChatStream<T extends CloseableChatStream> {
    private current;
    get active(): boolean;
    replace(create: () => T): T;
    owns(stream: T): boolean;
    close(): void;
}
export declare class ExclusiveChatOperation<T extends string> {
    private current;
    begin(operation: T): boolean;
    end(operation: T): void;
    isActive(operation?: T): boolean;
}
export declare const reconcileChatMessages: <T extends IdentifiedChatMessage>(messages: Map<string, T>, incoming: Iterable<T>) => number;
export declare const reconcileChatSnapshot: <T extends IdentifiedChatMessage>(messages: Map<string, T>, incoming: Iterable<T>, knownBeforeRequest: ReadonlySet<string>) => number;
export declare const sortChatMessages: <T extends IdentifiedChatMessage>(messages: Iterable<T>) => T[];
export declare const shouldScrollChatToLatest: (initialLoad: boolean, wasNearBottom: boolean) => boolean;
export declare const preserveScrollTop: (scrollTop: number, anchorOffsetBefore: number, anchorOffsetAfter: number) => number;
export declare const recordPrivateUnread: (counts: Map<string, number>, senderUserId: string, shouldCount: boolean) => void;
export declare const clearPrivateUnread: (counts: Map<string, number>, senderUserId: string) => void;
//# sourceMappingURL=chatState.d.ts.map