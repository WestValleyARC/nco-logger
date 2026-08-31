/* hamlive-oss — MIT License. See LICENSE. */

import { LiveNetReactiveStore } from '#@client/lib/stores.js';
import { createLogger } from '#@client/lib/logger.js';
import { serverInfo } from '#@client/lib/serverInfo.js';
import { getNpid } from '#@client/lib/clientUtils.js';
import {
    chatRequestErrorMessage, clearPrivateUnread, preserveScrollTop, reconcileChatMessages, reconcileChatSnapshot,
    recordPrivateUnread, shouldRecordPrivateUnread, ExclusiveChatOperation, shouldScrollChatToLatest, SingleChatStream,
    sortChatMessages
} from '#@client/lib/chatState.js';
import { CHAT_EMOJI_CATEGORIES, filterChatEmoji, insertChatEmoji } from '#@client/lib/chatEmoji.js';

const logger = createLogger('lib/chat.ts');

interface LocalChatMessage {
    id: string;
    scope: 'public' | 'direct';
    senderUserId: string;
    recipientUserId: string | null;
    conversationUserId: string | null;
    callSign: string;
    displayName: string;
    text: string;
    attachment: { kind: 'image'; mimeType: string; size: number; url: string } | null;
    createdAt: string;
    editedAt: string | null;
    deleted: boolean;
    cleared: boolean;
    replyTo: string | null;
    reactions: { emoji: string; count: number; reactedByMe: boolean }[];
    pinned: boolean;
    mine: boolean;
    canReact: boolean;
    canReply: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canPin: boolean;
    canBan: boolean;
    canMessagePrivately: boolean;
}

interface ChatRecipient {
    userId: string;
    callSign: string;
    displayName: string;
    role: 'netcontrol' | 'netlogger' | 'netrelay' | 'netuser';
    presence: 'online' | 'offline';
    presenceLabel: string;
    ignored: boolean;
}

interface ChatHistoryResponse {
    messages: LocalChatMessage[];
    directMessages: LocalChatMessage[];
    recipients: ChatRecipient[];
    currentUserId: string;
    limits: { maxMessageChars: number; maxUploadBytes: number; imageMimeTypes: string[] };
    ssePath: string;
    viewerRole: 'netcontrol' | 'netlogger' | 'netrelay' | 'netuser';
    error?: string;
}

interface ChatScrollSnapshot {
    scrollTop: number;
    nearBottom: boolean;
    anchorId: string | null;
    anchorOffset: number;
}

const isLocalChatMessage = (value: unknown): value is LocalChatMessage => {
    if (!value || typeof value !== 'object') return false;
    const message = value as Record<string, unknown>;
    const attachment = message['attachment'];
    const validAttachment = attachment === null || (typeof attachment === 'object' && attachment !== null
        && (attachment as Record<string, unknown>)['kind'] === 'image'
        && typeof (attachment as Record<string, unknown>)['mimeType'] === 'string'
        && typeof (attachment as Record<string, unknown>)['size'] === 'number'
        && typeof (attachment as Record<string, unknown>)['url'] === 'string');
    return typeof message['id'] === 'string'
        && typeof message['callSign'] === 'string'
        && (message['scope'] === 'public' || message['scope'] === 'direct')
        && typeof message['senderUserId'] === 'string'
        && (message['recipientUserId'] === null || typeof message['recipientUserId'] === 'string')
        && (message['conversationUserId'] === null || typeof message['conversationUserId'] === 'string')
        && typeof message['displayName'] === 'string'
        && typeof message['text'] === 'string'
        && typeof message['createdAt'] === 'string'
        && (message['editedAt'] === null || typeof message['editedAt'] === 'string')
        && typeof message['deleted'] === 'boolean'
        && typeof message['cleared'] === 'boolean'
        && (message['replyTo'] === null || typeof message['replyTo'] === 'string')
        && Array.isArray(message['reactions'])
        && typeof message['pinned'] === 'boolean'
        && typeof message['mine'] === 'boolean'
        && typeof message['canReact'] === 'boolean'
        && typeof message['canReply'] === 'boolean'
        && typeof message['canEdit'] === 'boolean'
        && typeof message['canDelete'] === 'boolean'
        && typeof message['canPin'] === 'boolean'
        && typeof message['canBan'] === 'boolean'
        && typeof message['canMessagePrivately'] === 'boolean'
        && validAttachment;
};

const isChatRecipient = (value: unknown): value is ChatRecipient => {
    if (!value || typeof value !== 'object') return false;
    const recipient = value as Record<string, unknown>;
    return typeof recipient['userId'] === 'string'
        && typeof recipient['callSign'] === 'string'
        && typeof recipient['displayName'] === 'string'
        && ['netcontrol', 'netlogger', 'netrelay', 'netuser'].includes(String(recipient['role']))
        && ['online', 'offline'].includes(String(recipient['presence']))
        && typeof recipient['presenceLabel'] === 'string'
        && typeof recipient['ignored'] === 'boolean';
};

export class ChatWidget extends HTMLElement {
    private readonly npid = getNpid().toString();
    private readonly publicMessages = new Map<string, LocalChatMessage>();
    private readonly directConversations = new Map<string, Map<string, LocalChatMessage>>();
    private readonly loadedDirectConversationIds = new Set<string>();
    private readonly recipients = new Map<string, ChatRecipient>();
    private readonly unreadCounts = new Map<string, number>();
    private readonly scrollPositions = new Map<string, number>();
    private readonly expandedPinnedMessageIds = new Set<string>();
    private selectedRecipientId: string | null = null;
    private inboxInitialized = false;
    private readonly eventStream = new SingleChatStream<EventSource>();
    private connectionAbort: AbortController | null = null;
    private connectionRetryTimer: number | null = null;
    private connectionRetryAttempt = 0;
    private statusTimer: number | null = null;
    private readonly composerOperation = new ExclusiveChatOperation<'send' | 'upload'>();
    private reloadingHistory = false;
    private historyReloadQueued = false;
    private editingMessageId: string | null = null;
    private editDraft = '';
    private savingEdit = false;
    private replyingToId: string | null = null;
    private viewerRole: ChatHistoryResponse['viewerRole'] = 'netuser';
    private suspended = false;
    private emojiCategory = CHAT_EMOJI_CATEGORIES[0]?.id ?? '';
    private lightboxTrigger: HTMLElement | null = null;
    private lightboxUrl = '';
    private lightboxMimeType = '';
    private previousBodyOverflow = '';
    private lightboxScrollTop = 0;
    private lightboxConversationKey = '';
    private messageScrollHeight = 0;
    private keepBottomOnImageLoad = true;
    private maxMessageChars = 2000;
    private maxUploadBytes = 5 * 1024 * 1024;
    private imageMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

    private get messages(): Map<string, LocalChatMessage> {
        if (!this.selectedRecipientId) return this.publicMessages;
        let messages = this.directConversations.get(this.selectedRecipientId);
        if (!messages) {
            messages = new Map<string, LocalChatMessage>();
            this.directConversations.set(this.selectedRecipientId, messages);
        }
        return messages;
    }

    private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        const picker = this.querySelector<HTMLElement>('.chat-emoji-picker');
        const toggle = this.querySelector<HTMLButtonElement>('.chat-emoji-button');
        if (picker && !picker.hidden && !picker.contains(target) && !toggle?.contains(target)) {
            this.toggleEmojiPicker(false);
        }
        this.querySelectorAll<HTMLElement>('.chat-quick-reactions:not([hidden])').forEach(menu => {
            if (!menu.contains(target) && !menu.parentElement?.contains(target)) menu.hidden = true;
        });
        const recipientMenu = this.querySelector<HTMLElement>('.chat-recipient-menu');
        const recipientToggle = this.querySelector<HTMLButtonElement>('.chat-recipient-toggle');
        if (recipientMenu && !recipientMenu.hidden && !recipientMenu.contains(target) && !recipientToggle?.contains(target)) {
            this.toggleRecipientMenu(false);
        }
    };

    private readonly handleDocumentKeyDown = (event: KeyboardEvent): void => {
        const lightbox = this.querySelector<HTMLElement>('.chat-lightbox');
        if (lightbox && !lightbox.hidden) {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.closeLightbox();
            } else if (event.key === 'Tab') {
                const controls = Array.from(lightbox.querySelectorAll<HTMLElement>('button:not([disabled])'));
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (first && last && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
                    event.preventDefault();
                    (event.shiftKey ? last : first).focus();
                }
            }
            return;
        }
        if (event.key !== 'Escape') return;
        const picker = this.querySelector<HTMLElement>('.chat-emoji-picker');
        if (picker && !picker.hidden) {
            event.preventDefault();
            this.toggleEmojiPicker(false);
            this.querySelector<HTMLButtonElement>('.chat-emoji-button')?.focus();
            return;
        }
        const recipientMenu = this.querySelector<HTMLElement>('.chat-recipient-menu');
        if (recipientMenu && !recipientMenu.hidden) {
            event.preventDefault();
            this.toggleRecipientMenu(false);
            this.querySelector<HTMLButtonElement>('.chat-recipient-toggle')?.focus();
        }
    };

    private readonly handleWindowResize = (): void => {
        const picker = this.querySelector<HTMLElement>('.chat-emoji-picker');
        if (picker && !picker.hidden) this.positionEmojiPicker();
    };

    private readonly handleMessageScroll = (): void => {
        this.keepBottomOnImageLoad = this.isNearBottom();
        if (this.keepBottomOnImageLoad) this.showNewMessages(false);
    };

    private readonly handleMessageImageLoad = (event: Event): void => {
        const container = this.querySelector<HTMLElement>('.chat-messages');
        const image = event.target;
        if (!container || !(image instanceof HTMLImageElement) || !container.contains(image)) return;
        const previousHeight = this.messageScrollHeight;
        const nextHeight = container.scrollHeight;
        if (this.keepBottomOnImageLoad) {
            container.scrollTop = nextHeight;
            this.showNewMessages(false);
        } else if (previousHeight > 0 && image.getBoundingClientRect().top < container.getBoundingClientRect().top) {
            container.scrollTop += Math.max(0, nextHeight - previousHeight);
        }
        this.messageScrollHeight = container.scrollHeight;
    };

    connectedCallback(): void {
        this.style.display = 'block';
        this.style.height = '100%';
        this.style.minHeight = '0';
        this.innerHTML = `
            <div class="chat-widget h-100 d-flex flex-column" style="min-height:0">
                <div class="chat-header-row">
                    <div class="chat-status small text-muted" role="status" aria-live="polite">Connecting…</div>
                    <button class="chat-clear-button" type="button" title="Delete all public chat messages" aria-label="Delete all public chat messages" hidden>Delete All Messages</button>
                </div>
                <div class="chat-conversation-bar">
                    <div class="chat-recipient-selector">
                        <button class="chat-recipient-toggle" type="button" aria-haspopup="menu" aria-expanded="false">To: Everyone ▾</button>
                        <div class="chat-recipient-menu" role="menu" aria-label="Choose chat recipient" hidden></div>
                    </div>
                    <span class="chat-private-unread" role="status" aria-live="polite" hidden></span>
                    <button class="chat-ignore-button" type="button" hidden>Ignore private messages</button>
                </div>
                <div class="chat-pinned-strip" aria-label="Pinned public messages" hidden></div>
                <div class="chat-messages flex-grow-1 overflow-auto" style="min-height:0" aria-live="polite"></div>
                <button class="btn btn-sm btn-outline-info chat-new-messages align-self-center mt-1" type="button" hidden>New messages ↓</button>
                <div class="chat-composer-wrap position-relative mt-2">
                    <div class="chat-reply-composer" hidden>
                        <span class="chat-reply-composer-text"></span>
                        <button class="chat-reply-cancel" type="button" aria-label="Cancel reply" title="Cancel reply">×</button>
                    </div>
                    <div class="chat-emoji-picker" role="dialog" aria-label="Emoji picker" hidden>
                        <label class="visually-hidden" for="local-chat-emoji-search">Search emoji</label>
                        <input id="local-chat-emoji-search" class="form-control form-control-sm chat-emoji-search" type="search" placeholder="Search emoji" autocomplete="off">
                        <div class="chat-emoji-tabs" role="group" aria-label="Emoji categories"></div>
                        <div class="chat-emoji-grid" role="group" aria-label="Available emoji"></div>
                        <div class="chat-emoji-empty text-muted" role="status" hidden>No emoji found</div>
                    </div>
                    <form class="chat-form">
                        <label class="visually-hidden" for="local-chat-message">Chat message</label>
                        <textarea id="local-chat-message" class="form-control chat-text-input" rows="1" autocomplete="off" placeholder="Message the net…" required></textarea>
                        <button class="chat-icon-control chat-emoji-button" type="button" title="Add emoji" aria-label="Add emoji" aria-expanded="false">😊</button>
                        <button class="chat-icon-control chat-image-button" type="button" title="Share image" aria-label="Share image">🖼️</button>
                        <input id="local-chat-image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
                        <button class="btn btn-primary chat-send-btn" type="submit">Send</button>
                    </form>
                </div>
                <div class="chat-lightbox" role="dialog" aria-modal="true" aria-labelledby="chat-lightbox-title" hidden>
                    <div class="chat-lightbox-card">
                        <div class="chat-lightbox-header">
                            <strong id="chat-lightbox-title">Chat image</strong>
                            <div class="chat-lightbox-controls">
                                <button class="chat-lightbox-download" type="button" aria-label="Download original chat image" title="Download image">
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 20h14"></path></svg>
                                </button>
                                <button class="chat-lightbox-close" type="button" aria-label="Close image viewer">×</button>
                            </div>
                        </div>
                        <img class="chat-lightbox-image" alt="">
                        <div class="chat-lightbox-status" role="status" aria-live="polite"></div>
                    </div>
                </div>
            </div>`;
        this.querySelector<HTMLFormElement>('.chat-form')?.addEventListener('submit', event => void this.send(event));
        this.querySelector<HTMLTextAreaElement>('#local-chat-message')?.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                if (!event.repeat) this.querySelector<HTMLFormElement>('.chat-form')?.requestSubmit();
            }
        });
        this.querySelector<HTMLButtonElement>('.chat-emoji-button')?.addEventListener('click', () => this.toggleEmojiPicker());
        this.querySelector<HTMLButtonElement>('.chat-image-button')?.addEventListener('click', () => {
            this.querySelector<HTMLInputElement>('#local-chat-image')?.click();
        });
        this.querySelector<HTMLInputElement>('#local-chat-image')?.addEventListener('change', event => void this.uploadImage(event));
        this.querySelector<HTMLButtonElement>('.chat-lightbox-close')?.addEventListener('click', () => this.closeLightbox());
        this.querySelector<HTMLButtonElement>('.chat-lightbox-download')?.addEventListener('click', () => void this.downloadLightboxImage());
        this.querySelector<HTMLButtonElement>('.chat-new-messages')?.addEventListener('click', () => this.scrollToLatest());
        this.querySelector<HTMLButtonElement>('.chat-reply-cancel')?.addEventListener('click', () => this.setReply(null));
        this.querySelector<HTMLButtonElement>('.chat-clear-button')?.addEventListener('click', () => void this.clearChat());
        const recipientToggle = this.querySelector<HTMLButtonElement>('.chat-recipient-toggle');
        const recipientMenu = this.querySelector<HTMLElement>('.chat-recipient-menu');
        recipientToggle?.addEventListener('click', () => this.toggleRecipientMenu());
        recipientToggle?.addEventListener('keydown', event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            this.toggleRecipientMenu(true);
            const choices = recipientMenu?.querySelectorAll<HTMLButtonElement>('.chat-recipient-choice');
            (event.key === 'ArrowUp' ? choices?.[choices.length - 1] : choices?.[0])?.focus();
        });
        recipientMenu?.addEventListener('keydown', event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            const choices = Array.from(recipientMenu.querySelectorAll<HTMLButtonElement>('.chat-recipient-choice'));
            if (!choices.length) return;
            event.preventDefault();
            const current = Math.max(0, choices.indexOf(document.activeElement as HTMLButtonElement));
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
                : event.key === 'ArrowDown' ? (current + 1) % choices.length
                    : (current - 1 + choices.length) % choices.length;
            choices[next]?.focus();
        });
        this.querySelector<HTMLButtonElement>('.chat-ignore-button')?.addEventListener('click', () => void this.toggleIgnore());
        const messageContainer = this.querySelector<HTMLElement>('.chat-messages');
        messageContainer?.addEventListener('scroll', this.handleMessageScroll, { passive: true });
        messageContainer?.addEventListener('load', this.handleMessageImageLoad, true);
        this.populateEmojiPicker();
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown);
        document.removeEventListener('keydown', this.handleDocumentKeyDown);
        document.addEventListener('pointerdown', this.handleDocumentPointerDown);
        document.addEventListener('keydown', this.handleDocumentKeyDown);
        window.removeEventListener('resize', this.handleWindowResize);
        window.addEventListener('resize', this.handleWindowResize);
        this.clearConnectionRetry();
        this.eventStream.close();
        this.connectionAbort?.abort();
        this.connectionAbort = new AbortController();
        this.connectionRetryAttempt = 0;
        this.setStatus('Connecting…');
        void this.connect(this.connectionAbort.signal);
    }

    disconnectedCallback(): void {
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown);
        document.removeEventListener('keydown', this.handleDocumentKeyDown);
        window.removeEventListener('resize', this.handleWindowResize);
        this.closeLightbox(false);
        this.clearConnectionRetry();
        this.connectionAbort?.abort();
        this.connectionAbort = null;
        this.eventStream.close();
        this.reloadingHistory = false;
        this.historyReloadQueued = false;
        if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
        this.statusTimer = null;
    }

    private populateEmojiPicker(): void {
        const tabs = this.querySelector<HTMLElement>('.chat-emoji-tabs');
        const search = this.querySelector<HTMLInputElement>('.chat-emoji-search');
        if (!tabs || !search) return;
        CHAT_EMOJI_CATEGORIES.forEach(category => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'chat-emoji-tab';
            button.textContent = category.icon;
            button.title = category.label;
            button.setAttribute('aria-label', category.label);
            button.addEventListener('click', () => {
                this.emojiCategory = category.id;
                search.value = '';
                this.renderEmojiChoices();
            });
            tabs.append(button);
        });
        search.addEventListener('input', () => this.renderEmojiChoices());
        this.renderEmojiChoices();
    }

    private renderEmojiChoices(): void {
        const grid = this.querySelector<HTMLElement>('.chat-emoji-grid');
        const search = this.querySelector<HTMLInputElement>('.chat-emoji-search');
        const empty = this.querySelector<HTMLElement>('.chat-emoji-empty');
        if (!grid || !search || !empty) return;
        const matches = filterChatEmoji(this.emojiCategory, search.value);
        grid.replaceChildren();
        matches.forEach(entry => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'chat-emoji-choice';
            button.textContent = entry.emoji;
            button.title = entry.name;
            button.setAttribute('aria-label', `Insert ${entry.name}`);
            button.addEventListener('click', () => this.insertEmoji(entry.emoji));
            grid.append(button);
        });
        empty.hidden = matches.length > 0;
        this.querySelectorAll<HTMLButtonElement>('.chat-emoji-tab').forEach((button, index) => {
            const active = CHAT_EMOJI_CATEGORIES[index]?.id === this.emojiCategory && !search.value.trim();
            button.setAttribute('aria-pressed', String(active));
            button.classList.toggle('active', active);
        });
    }

    private toggleRecipientMenu(force?: boolean): void {
        const menu = this.querySelector<HTMLElement>('.chat-recipient-menu');
        const toggle = this.querySelector<HTMLButtonElement>('.chat-recipient-toggle');
        if (!menu || !toggle) return;
        const open = force ?? menu.hidden;
        menu.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        if (open) menu.querySelector<HTMLButtonElement>('[aria-current="true"], button')?.focus();
    }

    private recipientLabel(recipient: ChatRecipient): string {
        return recipient.displayName && recipient.displayName !== recipient.callSign
            ? `${recipient.callSign} — ${recipient.displayName}` : recipient.callSign;
    }

    private renderRecipientControls(): void {
        const menu = this.querySelector<HTMLElement>('.chat-recipient-menu');
        const toggle = this.querySelector<HTMLButtonElement>('.chat-recipient-toggle');
        const ignore = this.querySelector<HTMLButtonElement>('.chat-ignore-button');
        const unreadStatus = this.querySelector<HTMLElement>('.chat-private-unread');
        if (!menu || !toggle || !ignore || !unreadStatus) return;
        menu.replaceChildren();
        const addChoice = (label: string, recipientId: string | null, recipient?: ChatRecipient): void => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'chat-recipient-choice';
            button.classList.toggle('is-ignored', Boolean(recipient?.ignored));
            button.setAttribute('role', 'menuitem');
            button.setAttribute('aria-current', String(this.selectedRecipientId === recipientId));
            const dot = document.createElement('span');
            dot.className = `chat-presence-dot ${recipient?.presence === 'online' ? 'is-online' : 'is-offline'}`;
            dot.setAttribute('aria-hidden', 'true');
            const copy = document.createElement('span');
            copy.className = 'chat-recipient-copy';
            const text = document.createElement('span');
            text.className = 'chat-recipient-name';
            text.textContent = label;
            copy.append(text);
            if (recipient) {
                const presence = document.createElement('span');
                presence.className = 'chat-recipient-presence';
                presence.textContent = recipient.ignored
                    ? 'Ignored' : recipient.presence === 'online' ? 'Available' : 'Unavailable';
                copy.append(presence);
            }
            if (recipient) button.append(dot);
            button.append(copy);
            const unread = recipientId ? this.unreadCounts.get(recipientId) || 0 : 0;
            if (unread > 0) {
                const badge = document.createElement('span');
                badge.className = 'chat-recipient-unread';
                badge.textContent = String(unread);
                badge.setAttribute('aria-label', `${unread} unread private message${unread === 1 ? '' : 's'}`);
                button.append(badge);
            }
            const availability = recipient?.presenceLabel || 'Public net chat';
            button.setAttribute('aria-label', `${label}, ${availability}${recipient?.ignored ? ', private messages ignored' : ''}${unread ? `, ${unread} unread` : ''}`);
            button.addEventListener('click', () => void this.switchConversation(recipientId));
            menu.append(button);
        };
        addChoice('Everyone', null);
        this.recipients.forEach(recipient => addChoice(this.recipientLabel(recipient), recipient.userId, recipient));

        const selected = this.selectedRecipientId ? this.recipients.get(this.selectedRecipientId) : null;
        toggle.textContent = selected
            ? `To: ${this.recipientLabel(selected)} · Private ▾` : 'To: Everyone · Public ▾';
        toggle.setAttribute('aria-label', selected
            ? `Chat recipient: ${this.recipientLabel(selected)}, ${selected.presenceLabel}`
            : 'Chat recipient: Everyone');
        ignore.hidden = !selected;
        ignore.classList.toggle('is-active', Boolean(selected?.ignored));
        ignore.setAttribute('aria-pressed', String(Boolean(selected?.ignored)));
        if (selected) {
            ignore.textContent = selected.ignored ? 'Unignore sender' : 'Ignore private messages';
            ignore.title = selected.ignored
                ? `Receive private messages from ${selected.callSign}` : `Ignore private messages from ${selected.callSign}`;
        } else {
            ignore.removeAttribute('title');
        }
        const totalUnread = [...this.unreadCounts.values()].reduce((total, count) => total + count, 0);
        unreadStatus.hidden = totalUnread === 0;
        unreadStatus.textContent = totalUnread ? `${totalUnread} private unread` : '';
        const clear = this.querySelector<HTMLButtonElement>('.chat-clear-button');
        if (clear) clear.hidden = this.viewerRole !== 'netcontrol' || Boolean(selected);
        const input = this.querySelector<HTMLTextAreaElement>('#local-chat-message');
        if (input) {
            input.placeholder = selected ? `Message ${selected.callSign} privately…` : 'Message the net…';
            input.setAttribute('aria-label', selected
                ? `Private message to ${this.recipientLabel(selected)}` : 'Message everyone on the net');
        }
    }

    private conversationKey(recipientId = this.selectedRecipientId): string {
        return recipientId || 'public';
    }

    private async switchConversation(recipientId: string | null, focusComposer = false): Promise<void> {
        if (recipientId && !this.recipients.has(recipientId)) return;
        const container = this.querySelector<HTMLElement>('.chat-messages');
        if (container) this.scrollPositions.set(this.conversationKey(), container.scrollTop);
        this.selectedRecipientId = recipientId;
        clearPrivateUnread(this.unreadCounts, recipientId || '');
        this.setReply(null);
        this.cancelEditing(false);
        this.toggleRecipientMenu(false);
        this.renderRecipientControls();
        this.render();
        if (container) {
            container.scrollTop = this.scrollPositions.get(this.conversationKey()) ?? container.scrollHeight;
            this.syncScrollTracking(container);
        }
        if (recipientId && !this.loadedDirectConversationIds.has(recipientId)) await this.loadDirectHistory(recipientId);
        if (focusComposer) this.querySelector<HTMLTextAreaElement>('#local-chat-message')?.focus();
    }

    private async loadDirectHistory(recipientId: string): Promise<void> {
        const knownIds = new Set(this.directConversations.get(recipientId)?.keys() || []);
        try {
            const options: RequestInit = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
            const signal = this.connectionAbort?.signal;
            if (signal) options.signal = signal;
            const response = await fetch(
                `/api/chat/${encodeURIComponent(this.npid)}/direct/${encodeURIComponent(recipientId)}/messages`, options
            );
            const data = (await response.json()) as { messages?: unknown; ignored?: boolean; error?: string };
            if (!response.ok || !Array.isArray(data.messages) || !data.messages.every(isLocalChatMessage)) {
                throw new Error(chatRequestErrorMessage(response.status, data.error, 'Private chat history unavailable'));
            }
            let conversation = this.directConversations.get(recipientId);
            if (!conversation) {
                conversation = new Map<string, LocalChatMessage>();
                this.directConversations.set(recipientId, conversation);
            }
            reconcileChatSnapshot(conversation, data.messages, knownIds);
            this.loadedDirectConversationIds.add(recipientId);
            const recipient = this.recipients.get(recipientId);
            if (recipient && typeof data.ignored === 'boolean') recipient.ignored = data.ignored;
            if (this.selectedRecipientId === recipientId) {
                this.renderRecipientControls();
                this.render({ preserveScroll: true });
            }
        } catch (err) {
            if (!this.connectionAbort?.signal.aborted) {
                this.setStatus(err instanceof Error ? err.message : 'Private chat history unavailable', true);
            }
        }
    }

    private async toggleIgnore(): Promise<void> {
        const recipientId = this.selectedRecipientId;
        const recipient = recipientId ? this.recipients.get(recipientId) : null;
        if (!recipientId || !recipient) return;
        const ignored = !recipient.ignored;
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/direct/${encodeURIComponent(recipientId)}/ignore`, {
                method: 'PUT', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ ignored })
            });
            const data = (await response.json()) as { ignored?: boolean; error?: string };
            if (!response.ok || typeof data.ignored !== 'boolean') {
                throw new Error(chatRequestErrorMessage(response.status, data.error, 'Ignore preference could not be updated'));
            }
            recipient.ignored = data.ignored;
            this.unreadCounts.delete(recipientId);
            if (data.ignored) {
                this.suppressIgnoredConversation(recipientId);
            } else {
                await this.loadDirectHistory(recipientId);
            }
            this.renderRecipientControls();
            this.render({ preserveScroll: true });
            this.setStatus(data.ignored ? `Private messages from ${recipient.callSign} ignored`
                : `Private messages from ${recipient.callSign} restored`, false, 3000);
        } catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Ignore preference could not be updated', true);
        }
    }

    private toggleEmojiPicker(force?: boolean): void {
        const picker = this.querySelector<HTMLElement>('.chat-emoji-picker');
        const button = this.querySelector<HTMLButtonElement>('.chat-emoji-button');
        if (!picker || !button) return;
        const open = force ?? picker.hidden;
        picker.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
        if (open) {
            this.positionEmojiPicker();
            this.querySelector<HTMLInputElement>('.chat-emoji-search')?.focus();
        }
    }

    private positionEmojiPicker(): void {
        const picker = this.querySelector<HTMLElement>('.chat-emoji-picker');
        const button = this.querySelector<HTMLButtonElement>('.chat-emoji-button');
        if (!picker || !button || picker.hidden) return;
        const margin = 8;
        const buttonRect = button.getBoundingClientRect();
        const width = Math.min(352, window.innerWidth - margin * 2);
        picker.style.width = `${width}px`;
        const pickerHeight = picker.offsetHeight;
        const left = Math.min(Math.max(margin, buttonRect.right - width), window.innerWidth - width - margin);
        const above = buttonRect.top - pickerHeight - margin;
        const below = buttonRect.bottom + margin;
        const top = above >= margin ? above : Math.min(below, window.innerHeight - pickerHeight - margin);
        picker.style.left = `${Math.max(margin, left)}px`;
        picker.style.top = `${Math.max(margin, top)}px`;
    }

    private insertEmoji(emoji: string): void {
        const input = this.querySelector<HTMLTextAreaElement>('#local-chat-message');
        if (!input) return;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        const inserted = insertChatEmoji(input.value, start, end, emoji);
        input.value = inserted.value;
        input.setSelectionRange(inserted.caret, inserted.caret);
        this.toggleEmojiPicker(false);
        input.focus();
    }

    private clearConnectionRetry(): void {
        if (this.connectionRetryTimer !== null) window.clearTimeout(this.connectionRetryTimer);
        this.connectionRetryTimer = null;
    }

    private scheduleConnectionRetry(signal: AbortSignal): void {
        if (signal.aborted || this.connectionRetryTimer !== null) return;
        const delay = Math.min(1000 * (2 ** this.connectionRetryAttempt), 15000);
        this.connectionRetryAttempt += 1;
        this.connectionRetryTimer = window.setTimeout(() => {
            this.connectionRetryTimer = null;
            if (signal.aborted) return;
            this.setStatus('Connecting…');
            void this.connect(signal);
        }, delay);
    }

    private async connect(signal: AbortSignal): Promise<void> {
        const knownPublicIds = new Set(this.publicMessages.keys());
        try {
            const data = await this.fetchHistory(signal);
            if (signal.aborted) return;
            this.clearConnectionRetry();
            this.connectionRetryAttempt = 0;
            this.applyLimits(data);
            reconcileChatSnapshot(
                this.publicMessages, data.messages.filter(message => message.scope === 'public'), knownPublicIds
            );
            this.reconcileDirectMessages(data.directMessages, false);
            this.updateRecipients(data.recipients);
            this.inboxInitialized = true;
            this.render({ forceBottom: true });
            this.openEvents(data.ssePath);
        } catch (err) {
            if (signal.aborted) return;
            logger.error('Local chat connection failed', err);
            this.setStatus('Chat unavailable. Retrying…', true, 0);
            this.scheduleConnectionRetry(signal);
        }
    }

    private async fetchHistory(signal: AbortSignal): Promise<ChatHistoryResponse> {
        const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages`, {
            credentials: 'same-origin', headers: { Accept: 'application/json' }, signal
        });
        const data = (await response.json()) as ChatHistoryResponse;
        if (!response.ok) throw new Error(chatRequestErrorMessage(response.status, data.error, 'Chat history unavailable'));
        if (!Array.isArray(data.messages) || !data.messages.every(isLocalChatMessage)
            || !Array.isArray(data.directMessages) || !data.directMessages.every(isLocalChatMessage)
            || !Array.isArray(data.recipients) || !data.recipients.every(isChatRecipient)) {
            throw new Error('Chat history response is invalid');
        }
        return data;
    }

    private applyLimits(data: ChatHistoryResponse): void {
        this.viewerRole = data.viewerRole;
        this.maxMessageChars = data.limits.maxMessageChars;
        this.maxUploadBytes = data.limits.maxUploadBytes;
        this.imageMimeTypes = data.limits.imageMimeTypes;
        const input = this.querySelector<HTMLTextAreaElement>('#local-chat-message');
        if (input) input.maxLength = this.maxMessageChars;
        const clear = this.querySelector<HTMLButtonElement>('.chat-clear-button');
        if (clear) clear.hidden = this.viewerRole !== 'netcontrol' || this.selectedRecipientId !== null;
    }

    private updateRecipients(recipients: ChatRecipient[]): void {
        const selected = this.selectedRecipientId;
        this.recipients.clear();
        recipients.forEach(recipient => {
            this.recipients.set(recipient.userId, recipient);
            if (recipient.ignored) this.suppressIgnoredConversation(recipient.userId);
        });
        const selectedWasRemoved = Boolean(selected && !this.recipients.has(selected));
        if (selectedWasRemoved) {
            this.selectedRecipientId = null;
            this.setReply(null);
            this.cancelEditing(false);
        }
        this.renderRecipientControls();
        if (selectedWasRemoved) this.render({ forceBottom: true });
    }

    private suppressIgnoredConversation(recipientId: string): void {
        this.unreadCounts.delete(recipientId);
        const conversation = this.directConversations.get(recipientId);
        conversation?.forEach((message, id) => { if (!message.mine) conversation.delete(id); });
    }

    private reconcileDirectMessages(messages: LocalChatMessage[], countUnread: boolean): void {
        messages.forEach(message => {
            if (message.scope !== 'direct' || !message.conversationUserId) return;
            const ignored = Boolean(this.recipients.get(message.conversationUserId)?.ignored);
            if (!message.mine && ignored) return;
            let conversation = this.directConversations.get(message.conversationUserId);
            if (!conversation) {
                conversation = new Map<string, LocalChatMessage>();
                this.directConversations.set(message.conversationUserId, conversation);
            }
            const isNew = !conversation.has(message.id);
            reconcileChatMessages(conversation, [message]);
            recordPrivateUnread(this.unreadCounts, message.conversationUserId, shouldRecordPrivateUnread({
                countUnread, isNew, mine: message.mine, ignored,
                selected: this.selectedRecipientId === message.conversationUserId
            }));
        });
        this.renderRecipientControls();
    }

    private openEvents(path: string): void {
        let receivedReady = false;
        const source = this.eventStream.replace(() => new EventSource(path, { withCredentials: true }));
        source.addEventListener('ready', () => {
            if (!this.eventStream.owns(source)) return;
            this.setStatus('Live');
            if (receivedReady) this.requestHistoryReload();
            receivedReady = true;
        });
        source.addEventListener('message', event => {
            if (!this.eventStream.owns(source)) return;
            try {
                const rawData: unknown = event.data;
                if (typeof rawData !== 'string') throw new Error('Chat event data is not text');
                const message: unknown = JSON.parse(rawData);
                if (!isLocalChatMessage(message)) throw new Error('Chat event has an invalid message');
                const wasNearBottom = this.isNearBottom();
                let isNew = false;
                if (message.scope === 'public') {
                    isNew = !message.cleared && reconcileChatMessages(this.publicMessages, [message]) === 1;
                    if (message.cleared) this.publicMessages.delete(message.id);
                    if (!this.selectedRecipientId) this.render({ preserveScroll: true });
                } else {
                    const conversationId = message.conversationUserId;
                    const conversation = conversationId ? this.directConversations.get(conversationId) : null;
                    isNew = Boolean(conversationId && !conversation?.has(message.id));
                    this.reconcileDirectMessages([message], this.inboxInitialized);
                    if (conversationId === this.selectedRecipientId) this.render({ preserveScroll: true });
                }
                if (isNew && !wasNearBottom && (message.scope === 'public' ? !this.selectedRecipientId
                    : message.conversationUserId === this.selectedRecipientId)) this.showNewMessages(true);
            } catch (err) { logger.error('Invalid local chat event', err); }
        });
        source.addEventListener('recipients', event => {
            if (!this.eventStream.owns(source)) return;
            try {
                const recipients: unknown = JSON.parse(String(event.data));
                if (!Array.isArray(recipients) || !recipients.every(isChatRecipient)) throw new Error('Invalid recipient list');
                this.updateRecipients(recipients);
            } catch (err) { logger.error('Invalid local chat recipient event', err); }
        });
        source.addEventListener('preferences', event => {
            if (!this.eventStream.owns(source)) return;
            try {
                const data = JSON.parse(String(event.data)) as { ignoredUserIds?: unknown };
                if (!Array.isArray(data.ignoredUserIds)) return;
                const ignored = new Set(data.ignoredUserIds.filter((id): id is string => typeof id === 'string'));
                this.recipients.forEach(recipient => {
                    recipient.ignored = ignored.has(recipient.userId);
                    if (recipient.ignored) this.suppressIgnoredConversation(recipient.userId);
                });
                this.renderRecipientControls();
                this.render({ preserveScroll: true });
            } catch (err) { logger.error('Invalid local chat preference event', err); }
        });
        source.addEventListener('access', event => {
            if (!this.eventStream.owns(source)) return;
            try {
                const data = JSON.parse(String(event.data)) as { suspended?: boolean; reason?: string };
                if (!data.suspended) return;
                this.suspended = true;
                this.eventStream.close();
                this.setComposerDisabled(true);
                this.setStatus(data.reason ? `Chat suspended: ${data.reason}` : 'Chat access has been suspended for this net', true);
            } catch (err) { logger.error('Invalid local chat access event', err); }
        });
        source.onerror = () => {
            if (this.eventStream.owns(source) && !this.suspended) this.setStatus('Reconnecting…');
        };
    }

    private requestHistoryReload(): void {
        if (this.reloadingHistory) {
            this.historyReloadQueued = true;
            return;
        }
        void this.reloadHistory();
    }

    private async reloadHistory(): Promise<void> {
        if (this.reloadingHistory) {
            this.historyReloadQueued = true;
            return;
        }
        const signal = this.connectionAbort?.signal;
        if (!signal) return;
        const knownPublicIds = new Set(this.publicMessages.keys());
        this.reloadingHistory = true;
        this.historyReloadQueued = false;
        try {
            const data = await this.fetchHistory(signal);
            if (signal.aborted) return;
            this.applyLimits(data);
            reconcileChatSnapshot(
                this.publicMessages, data.messages.filter(message => message.scope === 'public'), knownPublicIds
            );
            this.reconcileDirectMessages(data.directMessages, this.inboxInitialized);
            this.updateRecipients(data.recipients);
            this.inboxInitialized = true;
            this.render({ preserveScroll: true });
        } catch (err) {
            if (signal.aborted) return;
            logger.error('Local chat reconnect history failed', err);
            this.setStatus('Live updates restored; history refresh failed', true, 0);
        } finally {
            this.reloadingHistory = false;
            if (this.historyReloadQueued && !signal.aborted) {
                this.historyReloadQueued = false;
                queueMicrotask(() => this.requestHistoryReload());
            }
        }
    }

    private async send(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        const input = this.querySelector<HTMLTextAreaElement>('#local-chat-message');
        const text = input?.value.trim() || '';
        if (!input || !text) return;
        const recipientId = this.selectedRecipientId;
        const replyToId = this.replyingToId;
        const signal = this.connectionAbort?.signal;
        if (signal?.aborted) return;
        if (!this.composerOperation.begin('send')) return;
        this.setComposerDisabled(true);
        this.setStatus('Sending…');
        try {
            const path = recipientId
                ? `/api/chat/${encodeURIComponent(this.npid)}/direct/${encodeURIComponent(recipientId)}/messages`
                : `/api/chat/${encodeURIComponent(this.npid)}/messages`;
            const options: RequestInit = {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, replyTo: replyToId })
            };
            if (signal) options.signal = signal;
            const response = await fetch(path, options);
            const data = (await response.json()) as { message?: LocalChatMessage; error?: string };
            if (!response.ok || !data.message) {
                throw new Error(chatRequestErrorMessage(response.status, data.error, 'Message could not be sent'));
            }
            if (data.message.scope === 'direct') this.reconcileDirectMessages([data.message], false);
            else reconcileChatMessages(this.publicMessages, [data.message]);
            input.value = '';
            if (this.selectedRecipientId === recipientId) {
                this.setReply(null);
                this.render({ forceBottom: true });
            }
            this.setStatus('Live');
        } catch (err) {
            if (!signal?.aborted) this.setStatus(err instanceof Error ? err.message : 'Message could not be sent', true);
        } finally {
            this.composerOperation.end('send');
            if (this.isConnected) {
                this.setComposerDisabled(this.suspended || this.composerOperation.isActive());
                input.focus();
            }
        }
    }

    private setComposerDisabled(disabled: boolean): void {
        const input = this.querySelector<HTMLTextAreaElement>('#local-chat-message');
        const send = this.querySelector<HTMLButtonElement>('.chat-send-btn');
        const image = this.querySelector<HTMLButtonElement>('.chat-image-button');
        const emoji = this.querySelector<HTMLButtonElement>('.chat-emoji-button');
        if (input) input.disabled = disabled;
        if (send) send.disabled = disabled;
        if (image) image.disabled = disabled;
        if (emoji) emoji.disabled = disabled;
    }

    private async uploadImage(event: Event): Promise<void> {
        const fileInput = event.currentTarget as HTMLInputElement;
        const file = fileInput.files?.[0];
        if (!file) return;
        const recipientId = this.selectedRecipientId;
        const replyToId = this.replyingToId;
        const signal = this.connectionAbort?.signal;
        if (signal?.aborted) return;
        const button = this.querySelector<HTMLElement>('.chat-image-button');
        if (file.size > this.maxUploadBytes) {
            this.setStatus(`Image exceeds ${Math.floor(this.maxUploadBytes / 1024 / 1024)} MB`, true);
            fileInput.value = '';
            return;
        }
        if (!this.imageMimeTypes.includes(file.type)) {
            this.setStatus('Choose a PNG, JPEG, GIF, or WebP image', true);
            fileInput.value = '';
            return;
        }
        if (!this.composerOperation.begin('upload')) return;
        this.setComposerDisabled(true);
        if (button) button.setAttribute('aria-disabled', 'true');
        fileInput.disabled = true;
        this.setStatus('Uploading image…');
        try {
            const path = recipientId
                ? `/api/chat/${encodeURIComponent(this.npid)}/direct/${encodeURIComponent(recipientId)}/images`
                : `/api/chat/${encodeURIComponent(this.npid)}/images`;
            const options: RequestInit = {
                method: 'POST', credentials: 'same-origin',
                headers: {
                    'Content-Type': file.type,
                    Accept: 'application/json',
                    ...(replyToId ? { 'X-Chat-Reply-To': replyToId } : {})
                }, body: file
            };
            if (signal) options.signal = signal;
            const response = await fetch(path, options);
            const data = (await response.json()) as { message?: LocalChatMessage; error?: string };
            if (!response.ok || !data.message) {
                throw new Error(chatRequestErrorMessage(response.status, data.error, 'Image could not be uploaded'));
            }
            if (data.message.scope === 'direct') this.reconcileDirectMessages([data.message], false);
            else reconcileChatMessages(this.publicMessages, [data.message]);
            if (this.selectedRecipientId === recipientId) {
                this.setReply(null);
                this.render({ forceBottom: true });
            }
            this.setStatus('Image shared', false, 2500);
        } catch (err) {
            if (!signal?.aborted) this.setStatus(err instanceof Error ? err.message : 'Image could not be uploaded', true);
        } finally {
            this.composerOperation.end('upload');
            fileInput.value = '';
            fileInput.disabled = false;
            if (button) button.removeAttribute('aria-disabled');
            if (this.isConnected) {
                this.setComposerDisabled(this.suspended || this.composerOperation.isActive());
                this.querySelector<HTMLTextAreaElement>('#local-chat-message')?.focus();
            }
        }
    }

    private startEditing(message: LocalChatMessage): void {
        if (!message.canEdit || message.deleted) return;
        this.editingMessageId = message.id;
        this.editDraft = message.text;
        this.render({ preserveScroll: true });
        const editor = this.querySelector<HTMLTextAreaElement>('.chat-edit-input');
        editor?.focus();
        editor?.setSelectionRange(editor.value.length, editor.value.length);
    }

    private cancelEditing(render = true): void {
        this.editingMessageId = null;
        this.editDraft = '';
        if (render) this.render({ preserveScroll: true });
    }

    private async saveEdit(message: LocalChatMessage): Promise<void> {
        if (this.savingEdit) return;
        const text = this.editDraft.trim();
        if ((!text && !message.attachment) || text.length > this.maxMessageChars) {
            this.setStatus(text.length > this.maxMessageChars
                ? `Message exceeds ${this.maxMessageChars} characters` : 'Message text is required', true);
            return;
        }
        this.savingEdit = true;
        this.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('.chat-edit-controls button, .chat-edit-input')
            .forEach(control => { control.disabled = true; });
        this.setStatus('Saving edit…');
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages/${encodeURIComponent(message.id)}`, {
                method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const data = (await response.json()) as { message?: LocalChatMessage; error?: string };
            if (!response.ok || !data.message) {
                throw new Error(chatRequestErrorMessage(response.status, data.error, 'Message could not be edited'));
            }
            this.editingMessageId = null;
            this.editDraft = '';
            this.reconcileMutationMessage(data.message);
            this.setStatus('Message updated', false, 2500);
        } catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Message could not be edited', true);
            const editor = this.querySelector<HTMLTextAreaElement>('.chat-edit-input');
            if (editor) editor.disabled = false;
            this.querySelectorAll<HTMLButtonElement>('.chat-edit-controls button').forEach(button => { button.disabled = false; });
            editor?.focus();
        } finally {
            this.savingEdit = false;
        }
    }

    private async deleteMessage(messageId: string): Promise<void> {
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages/${encodeURIComponent(messageId)}`, {
                method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json' }
            });
            const data = (await response.json()) as { message?: LocalChatMessage; error?: string };
            if (!response.ok || !data.message) {
                throw new Error(chatRequestErrorMessage(response.status, data.error, 'Message could not be deleted'));
            }
            if (this.editingMessageId === messageId) this.editingMessageId = null;
            this.reconcileMutationMessage(data.message);
        } catch (err) { this.setStatus(err instanceof Error ? err.message : 'Delete failed', true); }
    }

    private setReply(message: LocalChatMessage | null): void {
        this.replyingToId = message?.id ?? null;
        const banner = this.querySelector<HTMLElement>('.chat-reply-composer');
        const text = this.querySelector<HTMLElement>('.chat-reply-composer-text');
        if (banner) banner.hidden = !message;
        if (text) text.textContent = message ? `Replying to ${message.callSign}: ${this.messagePreview(message)}` : '';
        if (message) this.querySelector<HTMLTextAreaElement>('#local-chat-message')?.focus();
    }

    private messagePreview(message: LocalChatMessage): string {
        if (message.deleted) return '[message deleted]';
        return (message.text || (message.attachment ? '[Image]' : '[message unavailable]')).slice(0, 80);
    }

    private async updateMessage(path: string, method: 'PUT' | 'POST', body?: object): Promise<void> {
        try {
            const options: RequestInit = {
                method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
            };
            if (body) options.body = JSON.stringify(body);
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/${path}`, options);
            const data = (await response.json()) as { message?: LocalChatMessage; error?: string };
            if (!response.ok) throw new Error(chatRequestErrorMessage(response.status, data.error, 'Chat action failed'));
            if (data.message) this.reconcileMutationMessage(data.message);
        } catch (err) { this.setStatus(err instanceof Error ? err.message : 'Chat action failed', true); }
    }

    private reconcileMutationMessage(message: LocalChatMessage): void {
        if (message.scope === 'direct') this.reconcileDirectMessages([message], false);
        else reconcileChatMessages(this.publicMessages, [message]);
        const visible = message.scope === 'public'
            ? this.selectedRecipientId === null
            : message.conversationUserId === this.selectedRecipientId;
        if (visible) this.render({ preserveScroll: true });
    }

    private async toggleReaction(message: LocalChatMessage, emoji: string): Promise<void> {
        if (!message.canReact) return;
        await this.updateMessage(`messages/${encodeURIComponent(message.id)}/reaction`, 'PUT', { emoji });
    }

    private async togglePin(message: LocalChatMessage): Promise<void> {
        if (!message.canPin) return;
        await this.updateMessage(`messages/${encodeURIComponent(message.id)}/pin`, 'PUT', { pinned: !message.pinned });
    }

    private async banAuthor(message: LocalChatMessage): Promise<void> {
        if (!message.canBan || !window.confirm(`Ban ${message.callSign} from chat for this net?`)) return;
        await this.updateMessage(`messages/${encodeURIComponent(message.id)}/ban`, 'POST');
        this.setStatus(`${message.callSign} was banned from chat`, false, 3000);
    }

    private async clearChat(): Promise<void> {
        if (this.viewerRole !== 'netcontrol' || this.selectedRecipientId !== null
            || !window.confirm('Clear all public chat messages for this net? This cannot be undone.')) return;
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages`, {
                method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json' }
            });
            const data = (await response.json()) as { error?: string };
            if (!response.ok) {
                throw new Error(chatRequestErrorMessage(response.status, data.error, 'Public chat could not be cleared'));
            }
            this.publicMessages.clear();
            this.setReply(null);
            this.render({ forceBottom: true });
            this.setStatus('Public chat cleared', false, 3000);
        } catch (err) { this.setStatus(err instanceof Error ? err.message : 'Public chat could not be cleared', true); }
    }

    private render(options: { forceBottom?: boolean; preserveScroll?: boolean } = {}): void {
        const container = this.querySelector<HTMLElement>('.chat-messages');
        if (!container) return;
        this.renderPinnedMessages();
        const snapshot = this.captureScrollSnapshot(container);
        const existingRows = new Map<string, HTMLElement>();
        container.querySelectorAll<HTMLElement>(':scope > [data-message-id]').forEach(row => {
            const id = row.dataset['messageId'];
            if (id) existingRows.set(id, row);
        });
        const rows = document.createDocumentFragment();
        sortChatMessages(this.messages.values()).forEach(message => {
            const renderKey = this.messageRenderKey(message);
            const existing = existingRows.get(message.id);
            const row = existing?.dataset['renderKey'] === renderKey ? existing : this.renderMessage(message, renderKey);
            rows.append(row);
        });
        container.replaceChildren(rows);
        if (shouldScrollChatToLatest(Boolean(options.forceBottom), snapshot.nearBottom)) {
            container.scrollTop = container.scrollHeight;
            this.showNewMessages(false);
        } else if (options.preserveScroll) {
            this.restoreScrollSnapshot(container, snapshot);
        }
        this.syncScrollTracking(container);
    }

    private captureScrollSnapshot(container: HTMLElement): ChatScrollSnapshot {
        const containerTop = container.getBoundingClientRect().top;
        const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'));
        const anchor = rows.find(row => row.getBoundingClientRect().bottom >= containerTop) || null;
        return {
            scrollTop: container.scrollTop,
            nearBottom: this.isNearBottom(),
            anchorId: anchor?.dataset['messageId'] || null,
            anchorOffset: anchor ? anchor.getBoundingClientRect().top - containerTop : 0
        };
    }

    private restoreScrollSnapshot(container: HTMLElement, snapshot: ChatScrollSnapshot): void {
        const anchor = snapshot.anchorId
            ? container.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(snapshot.anchorId)}"]`)
            : null;
        if (!anchor) {
            container.scrollTop = snapshot.scrollTop;
            return;
        }
        const currentOffset = anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
        container.scrollTop = preserveScrollTop(snapshot.scrollTop, snapshot.anchorOffset, currentOffset);
    }

    private syncScrollTracking(container: HTMLElement): void {
        this.messageScrollHeight = container.scrollHeight;
        this.keepBottomOnImageLoad = this.isNearBottom();
    }

    private messageRenderKey(message: LocalChatMessage): string {
        const replyTarget = message.replyTo ? this.messages.get(message.replyTo) : null;
        return JSON.stringify([
            message,
            this.editingMessageId === message.id ? this.editDraft : null,
            replyTarget ? [replyTarget.text, replyTarget.deleted, replyTarget.attachment?.kind || null] : null
        ]);
    }

    private renderPinnedMessages(): void {
        const strip = this.querySelector<HTMLElement>('.chat-pinned-strip');
        if (!strip) return;
        const pinnedMessages = this.selectedRecipientId ? [] : sortChatMessages(this.publicMessages.values())
            .filter(message => message.pinned && !message.deleted && !message.cleared);
        const activeIds = new Set(pinnedMessages.map(message => message.id));
        this.expandedPinnedMessageIds.forEach(id => {
            if (!activeIds.has(id)) this.expandedPinnedMessageIds.delete(id);
        });
        strip.replaceChildren();
        strip.hidden = pinnedMessages.length === 0;
        pinnedMessages.forEach(message => {
            const expanded = this.expandedPinnedMessageIds.has(message.id);
            const item = document.createElement('div');
            item.className = `chat-pinned-item${expanded ? ' is-expanded' : ''}`;
            item.dataset['pinnedMessageId'] = message.id;

            const pin = document.createElement('span');
            pin.className = 'chat-pinned-strip-icon';
            pin.textContent = '📌';
            pin.setAttribute('aria-hidden', 'true');

            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'chat-pinned-open';
            open.setAttribute('aria-expanded', String(expanded));
            open.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Show full'} pinned message from ${message.callSign}`);
            const author = document.createElement('strong');
            author.textContent = message.displayName && message.displayName !== message.callSign
                ? `${message.displayName} (${message.callSign})` : message.callSign;
            const preview = document.createElement('span');
            preview.className = 'chat-pinned-preview';
            preview.textContent = message.text || (message.attachment ? '[Image]' : '[message unavailable]');
            const expandLabel = document.createElement('span');
            expandLabel.className = 'chat-pinned-expand-label';
            expandLabel.textContent = expanded ? 'Collapse ▴' : 'Show full ▾';
            open.append(author, preview, expandLabel);
            if (message.attachment && this.safeAttachmentUrl(message)) {
                const image = document.createElement('img');
                image.className = 'chat-pinned-image';
                image.src = message.attachment.url;
                image.alt = `Pinned image shared by ${message.callSign}`;
                image.loading = 'lazy';
                open.append(image);
            }
            open.addEventListener('click', () => {
                if (expanded) this.expandedPinnedMessageIds.delete(message.id);
                else this.expandedPinnedMessageIds.add(message.id);
                this.renderPinnedMessages();
            });
            item.append(pin, open);

            if (message.canPin) {
                const unpin = document.createElement('button');
                unpin.type = 'button';
                unpin.className = 'chat-pinned-unpin';
                unpin.textContent = '×';
                unpin.title = 'Unpin message';
                unpin.setAttribute('aria-label', `Unpin message from ${message.callSign}`);
                unpin.addEventListener('click', () => void this.togglePin(message));
                item.append(unpin);
            }
            strip.append(item);
        });
    }

    private renderMessage(message: LocalChatMessage, renderKey = this.messageRenderKey(message)): HTMLElement {
        const row = document.createElement('div');
        row.className = `chat-message border-bottom py-1${message.pinned ? ' chat-message-pinned' : ''}`;
        row.dataset['messageId'] = message.id;
        row.dataset['renderKey'] = renderKey;
        const heading = document.createElement('div');
        const author = document.createElement('strong');
        author.className = 'chat-message-author';
        author.textContent = message.displayName && message.displayName !== message.callSign
            ? `${message.displayName} (${message.callSign})` : message.callSign;
        const time = document.createElement('small');
        time.className = 'chat-message-timestamp text-muted ms-2';
        time.textContent = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        heading.append(author, time);
        if (message.pinned && !message.deleted) {
            const pinned = document.createElement('span');
            pinned.className = 'chat-pinned-indicator';
            pinned.textContent = '📌';
            pinned.title = 'Pinned message';
            pinned.setAttribute('aria-label', 'Pinned message');
            heading.append(pinned);
        }
        if (message.editedAt && !message.deleted) {
            const edited = document.createElement('small');
            edited.className = 'chat-edited text-muted ms-1';
            edited.textContent = '(edited)';
            edited.title = `Edited ${new Date(message.editedAt).toLocaleString()}`;
            heading.append(edited);
        }
        row.append(heading);
        if (message.replyTo) this.appendReplyReference(row, message.replyTo);
        if (this.editingMessageId === message.id && !message.deleted) this.appendEditor(row, message);
        else {
            const body = document.createElement('div');
            body.className = `chat-message-content chat-text${message.deleted ? ' text-muted fst-italic' : ''}`;
            body.textContent = message.deleted ? '[message deleted]' : message.text;
            row.append(body);
            if (!message.deleted && message.attachment && this.safeAttachmentUrl(message)) {
                const imageButton = document.createElement('button');
                imageButton.type = 'button';
                imageButton.className = 'chat-image-link d-block mt-1';
                imageButton.setAttribute('aria-label', `Open image shared by ${message.callSign}`);
                const image = document.createElement('img');
                image.src = message.attachment.url;
                image.alt = `Image shared by ${message.callSign}`;
                image.loading = 'lazy';
                image.className = 'chat-image rounded';
                imageButton.append(image);
                imageButton.addEventListener('click', () => {
                    this.openLightbox(message.attachment?.url ?? '', image.alt, message.attachment?.mimeType ?? '', imageButton);
                });
                row.append(imageButton);
            }
            this.appendReactions(row, message);
            this.appendMessageActions(row, message);
        }
        return row;
    }

    private appendEditor(row: HTMLElement, message: LocalChatMessage): void {
        const editor = document.createElement('textarea');
        editor.className = 'form-control form-control-sm chat-edit-input mt-1';
        editor.rows = 2;
        editor.maxLength = this.maxMessageChars;
        editor.value = this.editDraft;
        editor.setAttribute('aria-label', `Edit message from ${message.callSign}`);
        editor.addEventListener('input', () => { this.editDraft = editor.value; });
        editor.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.cancelEditing();
            } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                if (!event.repeat) void this.saveEdit(message);
            }
        });
        const controls = document.createElement('div');
        controls.className = 'chat-edit-controls d-flex gap-2 mt-1';
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'btn btn-sm btn-primary';
        save.textContent = 'Save';
        save.addEventListener('click', () => void this.saveEdit(message));
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-sm btn-link';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => this.cancelEditing());
        controls.append(save, cancel);
        row.append(editor, controls);
    }

    private appendReplyReference(row: HTMLElement, replyTo: string): void {
        const reference = document.createElement('div');
        reference.className = 'chat-reply-reference';
        const target = this.messages.get(replyTo);
        reference.textContent = target
            ? `↩ ${target.callSign}: ${this.messagePreview(target)}`
            : '↩ Original message unavailable';
        row.append(reference);
    }

    private appendReactions(row: HTMLElement, message: LocalChatMessage): void {
        if (!message.reactions.length) return;
        const reactions = document.createElement('div');
        reactions.className = 'chat-reaction-chips';
        message.reactions.forEach(reaction => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `chat-reaction-chip${reaction.reactedByMe ? ' is-mine' : ''}`;
            chip.textContent = `${reaction.emoji} ${reaction.count}`;
            chip.disabled = !message.canReact;
            chip.setAttribute('aria-pressed', String(reaction.reactedByMe));
            chip.setAttribute('aria-label', reaction.reactedByMe
                ? `You reacted ${reaction.emoji}; ${reaction.count} total. Activate to remove reaction`
                : `React ${reaction.emoji}; ${reaction.count} total`);
            chip.addEventListener('click', () => void this.toggleReaction(message, reaction.emoji));
            reactions.append(chip);
        });
        row.append(reactions);
    }

    private appendMessageActions(row: HTMLElement, message: LocalChatMessage): void {
        if (!message.canReact && !message.canReply && !message.canEdit && !message.canDelete
            && !message.canPin && !message.canBan && !message.canMessagePrivately) return;
        const controls = document.createElement('div');
        controls.className = 'chat-message-actions';
        const addAction = (icon: string, label: string, className: string, action: () => void): HTMLButtonElement => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `chat-message-action ${className}`;
            const iconElement = document.createElement('span');
            iconElement.className = 'chat-message-action-icon';
            iconElement.setAttribute('aria-hidden', 'true');
            iconElement.textContent = icon;
            button.append(iconElement);
            button.title = label;
            button.setAttribute('aria-label', `${label} message from ${message.callSign}`);
            button.addEventListener('click', action);
            controls.append(button);
            return button;
        };
        if (message.canReact) {
            const reactionButton = addAction('😀', 'React to', 'chat-action-react', () => {
                const menu = controls.querySelector<HTMLElement>('.chat-quick-reactions');
                if (menu) {
                    menu.hidden = !menu.hidden;
                    reactionButton.setAttribute('aria-expanded', String(!menu.hidden));
                }
            });
            reactionButton.setAttribute('aria-haspopup', 'true');
            reactionButton.setAttribute('aria-expanded', 'false');
            const menu = document.createElement('div');
            menu.className = 'chat-quick-reactions';
            menu.hidden = true;
            ['👍', '❤️', '😂', '😮'].forEach(emoji => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = emoji;
                const reactedByMe = Boolean(message.reactions.find(reaction => reaction.emoji === emoji)?.reactedByMe);
                button.setAttribute('aria-pressed', String(reactedByMe));
                button.setAttribute('aria-label', reactedByMe ? `Remove ${emoji} reaction` : `React ${emoji}`);
                button.addEventListener('click', () => {
                    menu.hidden = true;
                    reactionButton.setAttribute('aria-expanded', 'false');
                    void this.toggleReaction(message, emoji);
                });
                menu.append(button);
            });
            controls.append(menu);
        }
        if (message.canReply) addAction('↩', 'Reply to', 'chat-action-reply', () => this.setReply(message));
        if (message.canMessagePrivately) {
            addAction('✉', 'Message privately', 'chat-action-private', () => {
                void this.switchConversation(message.senderUserId, true);
            });
        }
        if (message.canEdit) {
            addAction('✎', 'Edit', 'chat-action-edit', () => this.startEditing(message));
        }
        if (message.canDelete) {
            addAction('🗑', 'Delete', 'chat-action-delete', () => void this.deleteMessage(message.id));
        }
        if (message.canPin) addAction('📌', message.pinned ? 'Unpin' : 'Pin', 'chat-action-pin', () => void this.togglePin(message));
        if (message.canBan) addAction('⛔', 'Ban author of', 'chat-action-ban', () => void this.banAuthor(message));
        row.append(controls);
    }

    private safeAttachmentUrl(message: LocalChatMessage): boolean {
        if (!message.attachment) return false;
        try {
            const url = new URL(message.attachment.url, window.location.origin);
            const expected = `/api/chat/${encodeURIComponent(this.npid)}/messages/${encodeURIComponent(message.id)}/image`;
            return url.origin === window.location.origin && url.pathname === expected && !url.search && !url.hash;
        } catch { return false; }
    }

    private openLightbox(url: string, alt: string, mimeType: string, trigger: HTMLElement): void {
        const lightbox = this.querySelector<HTMLElement>('.chat-lightbox');
        const image = this.querySelector<HTMLImageElement>('.chat-lightbox-image');
        const status = this.querySelector<HTMLElement>('.chat-lightbox-status');
        if (!lightbox || !image || !url) return;
        this.lightboxTrigger = trigger;
        this.lightboxUrl = url;
        this.lightboxMimeType = mimeType;
        this.lightboxConversationKey = this.conversationKey();
        this.lightboxScrollTop = this.querySelector<HTMLElement>('.chat-messages')?.scrollTop ?? 0;
        this.previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        image.src = url;
        image.alt = alt;
        if (status) status.textContent = '';
        lightbox.hidden = false;
        this.querySelector<HTMLButtonElement>('.chat-lightbox-close')?.focus();
    }

    private closeLightbox(returnFocus = true): void {
        const lightbox = this.querySelector<HTMLElement>('.chat-lightbox');
        if (!lightbox || lightbox.hidden) return;
        lightbox.hidden = true;
        const image = this.querySelector<HTMLImageElement>('.chat-lightbox-image');
        image?.removeAttribute('src');
        document.body.style.overflow = this.previousBodyOverflow;
        const container = this.querySelector<HTMLElement>('.chat-messages');
        if (container && this.lightboxConversationKey === this.conversationKey()) {
            container.scrollTop = this.lightboxScrollTop;
            this.syncScrollTracking(container);
        }
        if (returnFocus) this.lightboxTrigger?.focus();
        this.lightboxTrigger = null;
        this.lightboxUrl = '';
        this.lightboxMimeType = '';
        this.lightboxConversationKey = '';
    }

    private async downloadLightboxImage(): Promise<void> {
        if (!this.lightboxUrl) return;
        const button = this.querySelector<HTMLButtonElement>('.chat-lightbox-download');
        const status = this.querySelector<HTMLElement>('.chat-lightbox-status');
        if (button) button.disabled = true;
        if (status) status.textContent = 'Preparing download…';
        try {
            const response = await fetch(this.lightboxUrl, { credentials: 'same-origin' });
            if (!response.ok) throw new Error('Image download failed');
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            const extension = ({
                'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp'
            } as Record<string, string>)[this.lightboxMimeType] ?? 'img';
            anchor.href = objectUrl;
            anchor.download = `chat-image.${extension}`;
            anchor.hidden = true;
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
            if (status) status.textContent = 'Download started';
        } catch (err) {
            if (status) status.textContent = err instanceof Error ? err.message : 'Image download failed';
        } finally {
            if (button) button.disabled = false;
        }
    }

    private isNearBottom(): boolean {
        const container = this.querySelector<HTMLElement>('.chat-messages');
        return !container || container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    }

    private scrollToLatest(): void {
        const container = this.querySelector<HTMLElement>('.chat-messages');
        if (container) container.scrollTop = container.scrollHeight;
        this.showNewMessages(false);
    }

    private showNewMessages(show: boolean): void {
        const button = this.querySelector<HTMLButtonElement>('.chat-new-messages');
        if (button) button.hidden = !show;
    }

    private setStatus(text: string, error = false, hideAfterMs = error ? 8000 : 0): void {
        const status = this.querySelector<HTMLElement>('.chat-status');
        if (!status) return;
        if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
        this.statusTimer = null;
        status.textContent = text;
        status.hidden = !text;
        status.classList.toggle('text-danger', error);
        if (hideAfterMs > 0) {
            this.statusTimer = window.setTimeout(() => {
                const live = this.eventStream.active && !this.suspended;
                status.textContent = live ? 'Live' : '';
                status.hidden = !live;
                status.classList.remove('text-danger');
                this.statusTimer = null;
            }, hideAfterMs);
        }
    }

    static init(_store: LiveNetReactiveStore, _level: number): void {
        void _store;
        void _level;
        if (!customElements.get('hl-chat')) customElements.define('hl-chat', ChatWidget);
        const container = document.getElementById('local-chat-container');
        if (container && serverInfo.chat) {
            const widget = document.createElement('hl-chat');
            widget.className = container.className;
            container.replaceWith(widget);
        }
    }
}

export { ChatWidget as ChatClient };
