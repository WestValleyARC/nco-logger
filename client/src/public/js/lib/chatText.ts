/* hamlive-oss — MIT License. See LICENSE. */

export type ChatTextPart =
    | { kind: 'text'; value: string }
    | { kind: 'link'; value: string };

const CHAT_URL_PATTERN = /(?:\bhttps?:\/\/[^\s<>"']+|(?<![@.\w-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s<>"']*)?)/gi;
const TRAILING_PUNCTUATION = /[.,!?;:]$/;
const CLOSING_DELIMITERS: Readonly<Record<string, string>> = Object.freeze({ ')': '(', ']': '[', '}': '{' });

const trimUrlEnd = (value: string): string => {
    let url = value;
    while (TRAILING_PUNCTUATION.test(url)) url = url.slice(0, -1);
    while (url.length) {
        const closing = url.at(-1) ?? '';
        const opening = CLOSING_DELIMITERS[closing];
        if (!opening) break;
        const openingCount = url.split(opening).length - 1;
        const closingCount = url.split(closing).length - 1;
        if (closingCount <= openingCount) break;
        url = url.slice(0, -1);
    }
    return url;
};

export const chatTextParts = (text: string): ChatTextPart[] => {
    const parts: ChatTextPart[] = [];
    let cursor = 0;
    for (const match of text.matchAll(CHAT_URL_PATTERN)) {
        const start = match.index ?? 0;
        const matched = match[0];
        const candidate = trimUrlEnd(matched);
        let valid = false;
        try {
            const url = new URL(chatLinkHref(candidate));
            valid = (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
        } catch {
            // Invalid URL-shaped text remains ordinary text.
        }
        if (!valid) continue;
        if (start > cursor) parts.push({ kind: 'text', value: text.slice(cursor, start) });
        parts.push({ kind: 'link', value: candidate });
        cursor = start + candidate.length;
    }
    if (cursor < text.length) parts.push({ kind: 'text', value: text.slice(cursor) });
    return parts.length ? parts : [{ kind: 'text', value: text }];
};

export const chatLinkHref = (value: string): string =>
    /^https?:\/\//i.test(value) ? value : `https://${value}`;

export const appendChatText = (container: HTMLElement, text: string): void => {
    chatTextParts(text).forEach(part => {
        if (part.kind === 'text') {
            container.append(document.createTextNode(part.value));
            return;
        }
        const link = document.createElement('a');
        link.href = chatLinkHref(part.value);
        link.textContent = part.value;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        container.append(link);
    });
};
