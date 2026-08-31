export interface ChatEmojiEntry {
    emoji: string;
    name: string;
}
export interface ChatEmojiCategory {
    id: string;
    label: string;
    icon: string;
    emoji: ChatEmojiEntry[];
}
export declare const CHAT_EMOJI_CATEGORIES: ChatEmojiCategory[];
export declare const filterChatEmoji: (categoryId: string, query: string) => ChatEmojiEntry[];
export declare const insertChatEmoji: (value: string, selectionStart: number, selectionEnd: number, emoji: string) => {
    value: string;
    caret: number;
};
//# sourceMappingURL=chatEmoji.d.ts.map