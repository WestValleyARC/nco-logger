export class SingleChatStream {
    current = null;
    get active() {
        return this.current !== null;
    }
    replace(create) {
        this.close();
        const stream = create();
        this.current = stream;
        return stream;
    }
    owns(stream) {
        return this.current === stream;
    }
    close() {
        this.current?.close();
        this.current = null;
    }
}
export class ExclusiveChatOperation {
    current = null;
    begin(operation) {
        if (this.current !== null)
            return false;
        this.current = operation;
        return true;
    }
    end(operation) {
        if (this.current === operation)
            this.current = null;
    }
    isActive(operation) {
        return operation === undefined ? this.current !== null : this.current === operation;
    }
}
export const reconcileChatMessages = (messages, incoming) => {
    let added = 0;
    for (const message of incoming) {
        if (!messages.has(message.id))
            added += 1;
        messages.set(message.id, message);
    }
    return added;
};
export const reconcileChatSnapshot = (messages, incoming, knownBeforeRequest) => {
    const snapshot = [...incoming];
    const incomingIds = new Set(snapshot.map(message => message.id));
    knownBeforeRequest.forEach(id => {
        if (!incomingIds.has(id))
            messages.delete(id);
    });
    return reconcileChatMessages(messages, snapshot);
};
export const sortChatMessages = (messages) => [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
export const shouldScrollChatToLatest = (initialLoad, wasNearBottom) => initialLoad || wasNearBottom;
export const preserveScrollTop = (scrollTop, anchorOffsetBefore, anchorOffsetAfter) => Math.max(0, scrollTop + anchorOffsetAfter - anchorOffsetBefore);
export const recordPrivateUnread = (counts, senderUserId, shouldCount) => {
    if (!shouldCount || !senderUserId)
        return;
    counts.set(senderUserId, (counts.get(senderUserId) || 0) + 1);
};
export const shouldRecordPrivateUnread = ({ countUnread, isNew, mine, ignored, selected }) => countUnread && isNew && !mine && !ignored && !selected;
export const clearPrivateUnread = (counts, senderUserId) => {
    if (senderUserId)
        counts.delete(senderUserId);
};
export const chatRequestErrorMessage = (status, serverMessage, fallback) => {
    if (status === 401)
        return 'Sign in required';
    if (status === 403)
        return 'Permission denied';
    if (status === 429)
        return 'Rate limit reached';
    return serverMessage || fallback;
};
//# sourceMappingURL=chatState.js.map