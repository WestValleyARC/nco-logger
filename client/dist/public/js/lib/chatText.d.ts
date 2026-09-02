export type ChatTextPart = {
    kind: 'text';
    value: string;
} | {
    kind: 'link';
    value: string;
};
export declare const chatTextParts: (text: string) => ChatTextPart[];
export declare const chatLinkHref: (value: string) => string;
export declare const appendChatText: (container: HTMLElement, text: string) => void;
//# sourceMappingURL=chatText.d.ts.map