import { LiveNetReactiveStore } from '#@client/lib/stores.js';
export declare class ChatWidget extends HTMLElement {
    private readonly npid;
    private messages;
    private eventSource;
    private maxMessageChars;
    private maxUploadBytes;
    private imageMimeTypes;
    connectedCallback(): void;
    disconnectedCallback(): void;
    private populateEmojiPicker;
    private toggleEmojiPicker;
    private insertEmoji;
    private connect;
    private openEvents;
    private reloadHistory;
    private send;
    private uploadImage;
    private deleteMessage;
    private render;
    private setStatus;
    static init(_store: LiveNetReactiveStore, _level: number): void;
}
export { ChatWidget as ChatClient };
//# sourceMappingURL=chat.d.ts.map