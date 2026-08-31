/* hamlive-oss — MIT License. See LICENSE. */

export interface IdentifiedChatMessage {
    id: string;
    createdAt: string;
}

export interface CloseableChatStream {
    close(): void;
}

export class SingleChatStream<T extends CloseableChatStream> {
    private current: T | null = null;

    get active(): boolean {
        return this.current !== null;
    }

    replace(create: () => T): T {
        this.close();
        const stream = create();
        this.current = stream;
        return stream;
    }

    owns(stream: T): boolean {
        return this.current === stream;
    }

    close(): void {
        this.current?.close();
        this.current = null;
    }
}

export class ExclusiveChatOperation<T extends string> {
    private current: T | null = null;

    begin(operation: T): boolean {
        if (this.current !== null) return false;
        this.current = operation;
        return true;
    }

    end(operation: T): void {
        if (this.current === operation) this.current = null;
    }

    isActive(operation?: T): boolean {
        return operation === undefined ? this.current !== null : this.current === operation;
    }
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

export const reconcileChatSnapshot = <T extends IdentifiedChatMessage>(
    messages: Map<string, T>, incoming: Iterable<T>, knownBeforeRequest: ReadonlySet<string>
): number => {
    const snapshot = [...incoming];
    const incomingIds = new Set(snapshot.map(message => message.id));
    knownBeforeRequest.forEach(id => {
        if (!incomingIds.has(id)) messages.delete(id);
    });
    return reconcileChatMessages(messages, snapshot);
};

export const sortChatMessages = <T extends IdentifiedChatMessage>(messages: Iterable<T>): T[] =>
    [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

export const shouldScrollChatToLatest = (initialLoad: boolean, wasNearBottom: boolean): boolean =>
    initialLoad || wasNearBottom;

export const preserveScrollTop = (scrollTop: number, anchorOffsetBefore: number, anchorOffsetAfter: number): number =>
    Math.max(0, scrollTop + anchorOffsetAfter - anchorOffsetBefore);

export const recordPrivateUnread = (counts: Map<string, number>, senderUserId: string, shouldCount: boolean): void => {
    if (!shouldCount || !senderUserId) return;
    counts.set(senderUserId, (counts.get(senderUserId) || 0) + 1);
};

export const shouldRecordPrivateUnread = ({
    countUnread, isNew, mine, ignored, selected
}: {
    countUnread: boolean;
    isNew: boolean;
    mine: boolean;
    ignored: boolean;
    selected: boolean;
}): boolean => countUnread && isNew && !mine && !ignored && !selected;

export const clearPrivateUnread = (counts: Map<string, number>, senderUserId: string): void => {
    if (senderUserId) counts.delete(senderUserId);
};

export const chatRequestErrorMessage = (status: number, serverMessage: string | undefined, fallback: string): string => {
    if (status === 401) return 'Sign in required';
    if (status === 403) return 'Permission denied';
    if (status === 429) return 'Rate limit reached';
    return serverMessage || fallback;
};
