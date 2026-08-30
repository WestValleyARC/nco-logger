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
//# sourceMappingURL=chatState.js.map