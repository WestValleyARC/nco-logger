export const reconcileChatMessages = (messages, incoming) => {
    let added = 0;
    for (const message of incoming) {
        if (!messages.has(message.id))
            added += 1;
        messages.set(message.id, message);
    }
    return added;
};
export const sortChatMessages = (messages) => [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
export const shouldScrollChatToLatest = (initialLoad, wasNearBottom) => initialLoad || wasNearBottom;
export const recordPrivateUnread = (counts, senderUserId, shouldCount) => {
    if (!shouldCount || !senderUserId)
        return;
    counts.set(senderUserId, (counts.get(senderUserId) || 0) + 1);
};
export const clearPrivateUnread = (counts, senderUserId) => {
    if (senderUserId)
        counts.delete(senderUserId);
};
//# sourceMappingURL=chatState.js.map