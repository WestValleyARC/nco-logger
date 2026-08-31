/* hamlive-oss — MIT License. See LICENSE. */

import { LiveNetReactiveStore } from '#@client/lib/stores.js';
import { createLogger } from '#@client/lib/logger.js';
import { serverInfo } from '#@client/lib/serverInfo.js';
import { getNpid } from '#@client/lib/clientUtils.js';
import { reconcileChatMessages, shouldScrollChatToLatest, sortChatMessages } from '#@client/lib/chatState.js';
import { CHAT_EMOJI_CATEGORIES, filterChatEmoji, insertChatEmoji } from '#@client/lib/chatEmoji.js';

const logger = createLogger('lib/chat.ts');

interface LocalChatMessage {
    id: string;
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
}

interface ChatHistoryResponse {
    messages: LocalChatMessage[];
    limits: { maxMessageChars: number; maxUploadBytes: number; imageMimeTypes: string[] };
    ssePath: string;
    viewerRole: 'netcontrol' | 'netlogger' | 'netrelay' | 'netuser';
    error?: string;
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
        && validAttachment;
};

export class ChatWidget extends HTMLElement {
    private readonly npid = getNpid().toString();
    private messages = new Map<string, LocalChatMessage>();
    private eventSource: EventSource | null = null;
    private connectionAbort: AbortController | null = null;
    private statusTimer: number | null = null;
    private sending = false;
    private uploading = false;
    private reloadingHistory = false;
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
    private maxMessageChars = 2000;
    private maxUploadBytes = 5 * 1024 * 1024;
    private imageMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

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
        }
    };

    private readonly handleWindowResize = (): void => {
        const picker = this.querySelector<HTMLElement>('.chat-emoji-picker');
        if (picker && !picker.hidden) this.positionEmojiPicker();
    };

    connectedCallback(): void {
        this.style.display = 'block';
        this.style.height = '100%';
        this.style.minHeight = '0';
        this.innerHTML = `
            <div class="chat-widget h-100 d-flex flex-column" style="min-height:0">
                <div class="chat-header-row">
                    <div class="chat-status small text-muted" role="status" aria-live="polite">Connecting…</div>
                    <button class="chat-clear-button" type="button" title="Clear public chat" aria-label="Clear public chat" hidden>🧹</button>
                </div>
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
                        <textarea id="local-chat-message" class="form-control chat-text-input" rows="1" autocomplete="off" placeholder="Message the net" required></textarea>
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
        this.querySelector<HTMLElement>('.chat-messages')?.addEventListener('scroll', () => {
            if (this.isNearBottom()) this.showNewMessages(false);
        }, { passive: true });
        this.populateEmojiPicker();
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown);
        document.removeEventListener('keydown', this.handleDocumentKeyDown);
        document.addEventListener('pointerdown', this.handleDocumentPointerDown);
        document.addEventListener('keydown', this.handleDocumentKeyDown);
        window.removeEventListener('resize', this.handleWindowResize);
        window.addEventListener('resize', this.handleWindowResize);
        this.connectionAbort?.abort();
        this.connectionAbort = new AbortController();
        void this.connect(this.connectionAbort.signal);
    }

    disconnectedCallback(): void {
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown);
        document.removeEventListener('keydown', this.handleDocumentKeyDown);
        window.removeEventListener('resize', this.handleWindowResize);
        this.closeLightbox(false);
        this.connectionAbort?.abort();
        this.connectionAbort = null;
        this.eventSource?.close();
        this.eventSource = null;
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

    private async connect(signal: AbortSignal): Promise<void> {
        try {
            const data = await this.fetchHistory(signal);
            if (signal.aborted) return;
            this.applyLimits(data);
            reconcileChatMessages(this.messages, data.messages);
            this.render({ forceBottom: true });
            this.openEvents(data.ssePath);
        } catch (err) {
            if (signal.aborted) return;
            this.setStatus(err instanceof Error ? err.message : 'Chat unavailable', true);
        }
    }

    private async fetchHistory(signal: AbortSignal): Promise<ChatHistoryResponse> {
        const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages`, {
            credentials: 'same-origin', headers: { Accept: 'application/json' }, signal
        });
        const data = (await response.json()) as ChatHistoryResponse;
        if (!response.ok) throw new Error(data.error || 'Chat history unavailable');
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
        if (clear) clear.hidden = this.viewerRole !== 'netcontrol';
    }

    private openEvents(path: string): void {
        this.eventSource?.close();
        const source = new EventSource(path, { withCredentials: true });
        this.eventSource = source;
        source.addEventListener('ready', () => {
            if (this.eventSource !== source) return;
            this.setStatus('Live', false, 2000);
            void this.reloadHistory();
        });
        source.addEventListener('message', event => {
            if (this.eventSource !== source) return;
            try {
                const rawData: unknown = event.data;
                if (typeof rawData !== 'string') throw new Error('Chat event data is not text');
                const message: unknown = JSON.parse(rawData);
                if (!isLocalChatMessage(message)) throw new Error('Chat event has an invalid message');
                const wasNearBottom = this.isNearBottom();
                const isNew = !message.cleared && reconcileChatMessages(this.messages, [message]) === 1;
                if (message.cleared) this.messages.delete(message.id);
                this.render({ preserveScroll: true });
                if (isNew && !wasNearBottom) this.showNewMessages(true);
            } catch (err) { logger.error('Invalid local chat event', err); }
        });
        source.addEventListener('access', event => {
            if (this.eventSource !== source) return;
            try {
                const data = JSON.parse(String(event.data)) as { suspended?: boolean; reason?: string };
                if (!data.suspended) return;
                this.suspended = true;
                source.close();
                this.setComposerDisabled(true);
                this.setStatus(data.reason ? `Chat suspended: ${data.reason}` : 'Chat access has been suspended for this net', true);
            } catch (err) { logger.error('Invalid local chat access event', err); }
        });
        source.onerror = () => {
            if (this.eventSource === source && !this.suspended) this.setStatus('Reconnecting…');
        };
    }

    private async reloadHistory(): Promise<void> {
        if (this.reloadingHistory) return;
        const signal = this.connectionAbort?.signal;
        if (!signal) return;
        this.reloadingHistory = true;
        try {
            const data = await this.fetchHistory(signal);
            if (signal.aborted) return;
            this.applyLimits(data);
            reconcileChatMessages(this.messages, data.messages);
            this.render({ preserveScroll: true });
        } catch (err) {
            if (signal.aborted) return;
            logger.error('Local chat reconnect history failed', err);
            this.setStatus('Live updates restored; history refresh failed', true);
        } finally {
            this.reloadingHistory = false;
        }
    }

    private async send(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (this.sending) return;
        const input = this.querySelector<HTMLTextAreaElement>('#local-chat-message');
        const text = input?.value.trim() || '';
        if (!input || !text) return;
        this.sending = true;
        this.setComposerDisabled(true);
        this.setStatus('Sending…');
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages`, {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, replyTo: this.replyingToId })
            });
            const data = (await response.json()) as { message?: LocalChatMessage; error?: string };
            if (!response.ok || !data.message) throw new Error(data.error || 'Message could not be sent');
            reconcileChatMessages(this.messages, [data.message]);
            input.value = '';
            this.setReply(null);
            this.render({ forceBottom: true });
            this.setStatus('Live', false, 1500);
        } catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Message could not be sent', true);
        } finally {
            this.sending = false;
            this.setComposerDisabled(this.suspended);
            input.focus();
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
        if (!file || this.uploading) return;
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
        this.uploading = true;
        if (button) button.setAttribute('aria-disabled', 'true');
        fileInput.disabled = true;
        this.setStatus('Uploading image…');
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/images`, {
                method: 'POST', credentials: 'same-origin',
                headers: {
                    'Content-Type': file.type,
                    Accept: 'application/json',
                    ...(this.replyingToId ? { 'X-Chat-Reply-To': this.replyingToId } : {})
                }, body: file
            });
            const data = (await response.json()) as { message?: LocalChatMessage; error?: string };
            if (!response.ok || !data.message) throw new Error(data.error || 'Image could not be uploaded');
            reconcileChatMessages(this.messages, [data.message]);
            this.setReply(null);
            this.render({ forceBottom: true });
            this.setStatus('Image shared', false, 2500);
        } catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Image could not be uploaded', true);
        } finally {
            this.uploading = false;
            fileInput.value = '';
            fileInput.disabled = false;
            if (button) button.removeAttribute('aria-disabled');
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

    private cancelEditing(): void {
        this.editingMessageId = null;
        this.editDraft = '';
        this.render({ preserveScroll: true });
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
            if (!response.ok || !data.message) throw new Error(data.error || 'Message could not be edited');
            reconcileChatMessages(this.messages, [data.message]);
            this.editingMessageId = null;
            this.editDraft = '';
            this.render({ preserveScroll: true });
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
            if (!response.ok || !data.message) throw new Error(data.error || 'Message could not be deleted');
            reconcileChatMessages(this.messages, [data.message]);
            if (this.editingMessageId === messageId) this.editingMessageId = null;
            this.render({ preserveScroll: true });
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
            if (!response.ok) throw new Error(data.error || 'Chat action failed');
            if (data.message) {
                reconcileChatMessages(this.messages, [data.message]);
                this.render({ preserveScroll: true });
            }
        } catch (err) { this.setStatus(err instanceof Error ? err.message : 'Chat action failed', true); }
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
        if (this.viewerRole !== 'netcontrol'
            || !window.confirm('Clear all public chat messages for this net? This cannot be undone.')) return;
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages`, {
                method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json' }
            });
            const data = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(data.error || 'Public chat could not be cleared');
            this.messages.clear();
            this.setReply(null);
            this.render({ forceBottom: true });
            this.setStatus('Public chat cleared', false, 3000);
        } catch (err) { this.setStatus(err instanceof Error ? err.message : 'Public chat could not be cleared', true); }
    }

    private render(options: { forceBottom?: boolean; preserveScroll?: boolean } = {}): void {
        const container = this.querySelector<HTMLElement>('.chat-messages');
        if (!container) return;
        const nearBottom = this.isNearBottom();
        const previousScrollTop = container.scrollTop;
        container.replaceChildren();
        sortChatMessages(this.messages.values())
            .forEach(message => container.append(this.renderMessage(message)));
        if (shouldScrollChatToLatest(Boolean(options.forceBottom), nearBottom)) {
            container.scrollTop = container.scrollHeight;
            this.showNewMessages(false);
        } else if (options.preserveScroll) {
            container.scrollTop = previousScrollTop;
        }
    }

    private renderMessage(message: LocalChatMessage): HTMLElement {
        const row = document.createElement('div');
        row.className = `chat-message border-bottom py-1${message.pinned ? ' chat-message-pinned' : ''}`;
        row.dataset['messageId'] = message.id;
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
            chip.setAttribute('aria-label', `${reaction.emoji} reaction, ${reaction.count}`);
            chip.addEventListener('click', () => void this.toggleReaction(message, reaction.emoji));
            reactions.append(chip);
        });
        row.append(reactions);
    }

    private appendMessageActions(row: HTMLElement, message: LocalChatMessage): void {
        if (!message.canReact && !message.canReply && !message.canEdit && !message.canDelete
            && !message.canPin && !message.canBan) return;
        const controls = document.createElement('div');
        controls.className = 'chat-message-actions';
        const addAction = (icon: string, label: string, className: string, action: () => void): HTMLButtonElement => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `chat-message-action ${className}`;
            button.textContent = icon;
            button.title = label;
            button.setAttribute('aria-label', `${label} message from ${message.callSign}`);
            button.addEventListener('click', action);
            controls.append(button);
            return button;
        };
        if (message.canReact) {
            const reactionButton = addAction('😀', 'React to', 'chat-action-react', () => {
                const menu = controls.querySelector<HTMLElement>('.chat-quick-reactions');
                if (menu) menu.hidden = !menu.hidden;
            });
            reactionButton.setAttribute('aria-haspopup', 'true');
            const menu = document.createElement('div');
            menu.className = 'chat-quick-reactions';
            menu.hidden = true;
            ['👍', '❤️', '😂', '😮'].forEach(emoji => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = emoji;
                button.setAttribute('aria-label', `React ${emoji}`);
                button.addEventListener('click', () => void this.toggleReaction(message, emoji));
                menu.append(button);
            });
            controls.append(menu);
        }
        if (message.canReply) addAction('↩', 'Reply to', 'chat-action-reply', () => this.setReply(message));
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
        if (returnFocus) this.lightboxTrigger?.focus();
        this.lightboxTrigger = null;
        this.lightboxUrl = '';
        this.lightboxMimeType = '';
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
                status.hidden = true;
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
