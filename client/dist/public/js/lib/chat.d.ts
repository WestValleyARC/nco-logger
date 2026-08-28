import { LiveNetReactiveStore } from '#@client/lib/stores.js';
export declare class ChatWidget extends HTMLElement {
    private readonly npid;
    private messages;
    private eventSource;
    private maxMessageChars;
    connectedCallback(): void;
    disconnectedCallback(): void;
    private connect;
    private openEvents;
    private reloadHistory;
    private send;
    private deleteMessage;
    private render;
    private setStatus;
    static init(_store: LiveNetReactiveStore, _level: number): void;
}
export { ChatWidget as ChatClient };
//# sourceMappingURL=chat.d.ts.map