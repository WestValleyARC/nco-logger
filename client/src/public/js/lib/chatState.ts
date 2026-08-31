/* hamlive-oss — MIT License. See LICENSE. */

export interface IdentifiedChatMessage {
    id: string;
    createdAt: string;
}

export const reconcileChatMessages = <T extends IdentifiedChatMessage>(
    messages: Map<string, T>, incoming: Iterable<T>
): number => {
    let added = 0;
    for (const message of incoming) {
        if (!messages.has(message.id)) added += 1;
        messages.set(message.id, message);
    }
    return added;
};

export const sortChatMessages = <T extends IdentifiedChatMessage>(messages: Iterable<T>): T[] =>
    [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

export const shouldScrollChatToLatest = (initialLoad: boolean, wasNearBottom: boolean): boolean =>
    initialLoad || wasNearBottom;

export const recordPrivateUnread = (counts: Map<string, number>, senderUserId: string, shouldCount: boolean): void => {
    if (!shouldCount || !senderUserId) return;
    counts.set(senderUserId, (counts.get(senderUserId) || 0) + 1);
};

export const clearPrivateUnread = (counts: Map<string, number>, senderUserId: string): void => {
    if (senderUserId) counts.delete(senderUserId);
};
