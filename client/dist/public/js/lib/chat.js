import { createLogger } from '#@client/lib/logger.js';
import { serverInfo } from '#@client/lib/serverInfo.js';
import { getNpid } from '#@client/lib/clientUtils.js';
import { clearPrivateUnread, reconcileChatMessages, recordPrivateUnread, shouldScrollChatToLatest, sortChatMessages } from '#@client/lib/chatState.js';
import { CHAT_EMOJI_CATEGORIES, filterChatEmoji, insertChatEmoji } from '#@client/lib/chatEmoji.js';
const logger = createLogger('lib/chat.ts');
const isLocalChatMessage = (value) => {
    if (!value || typeof value !== 'object')
        return false;
    const message = value;
    const attachment = message['attachment'];
    const validAttachment = attachment === null || (typeof attachment === 'object' && attachment !== null
        && attachment['kind'] === 'image'
        && typeof attachment['mimeType'] === 'string'
        && typeof attachment['size'] === 'number'
        && typeof attachment['url'] === 'string');
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
const isChatRecipient = (value) => {
    if (!value || typeof value !== 'object')
        return false;
    const recipient = value;
    return typeof recipient['userId'] === 'string'
        && typeof recipient['callSign'] === 'string'
        && typeof recipient['displayName'] === 'string'
        && ['netcontrol', 'netlogger', 'netrelay', 'netuser'].includes(String(recipient['role']))
        && ['online', 'offline'].includes(String(recipient['presence']))
        && typeof recipient['presenceLabel'] === 'string'
        && typeof recipient['ignored'] === 'boolean';
};
export class ChatWidget extends HTMLElement {
    npid = getNpid().toString();
    publicMessages = new Map();
    directConversations = new Map();
    recipients = new Map();
    unreadCounts = new Map();
    scrollPositions = new Map();
    selectedRecipientId = null;
    inboxInitialized = false;
    eventSource = null;
    connectionAbort = null;
    statusTimer = null;
    sending = false;
    uploading = false;
    reloadingHistory = false;
    editingMessageId = null;
    editDraft = '';
    savingEdit = false;
    replyingToId = null;
    viewerRole = 'netuser';
    suspended = false;
    emojiCategory = CHAT_EMOJI_CATEGORIES[0]?.id ?? '';
    lightboxTrigger = null;
    lightboxUrl = '';
    lightboxMimeType = '';
    previousBodyOverflow = '';
    maxMessageChars = 2000;
    maxUploadBytes = 5 * 1024 * 1024;
    imageMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    get messages() {
        if (!this.selectedRecipientId)
            return this.publicMessages;
        let messages = this.directConversations.get(this.selectedRecipientId);
        if (!messages) {
            messages = new Map();
            this.directConversations.set(this.selectedRecipientId, messages);
        }
        return messages;
    }
    handleDocumentPointerDown = (event) => {
        const target = event.target;
        if (!(target instanceof Node))
            return;
        const picker = this.querySelector('.chat-emoji-picker');
        const toggle = this.querySelector('.chat-emoji-button');
        if (picker && !picker.hidden && !picker.contains(target) && !toggle?.contains(target)) {
            this.toggleEmojiPicker(false);
        }
        this.querySelectorAll('.chat-quick-reactions:not([hidden])').forEach(menu => {
            if (!menu.contains(target) && !menu.parentElement?.contains(target))
                menu.hidden = true;
        });
        const recipientMenu = this.querySelector('.chat-recipient-menu');
        const recipientToggle = this.querySelector('.chat-recipient-toggle');
        if (recipientMenu && !recipientMenu.hidden && !recipientMenu.contains(target) && !recipientToggle?.contains(target)) {
            this.toggleRecipientMenu(false);
        }
    };
    handleDocumentKeyDown = (event) => {
        const lightbox = this.querySelector('.chat-lightbox');
        if (lightbox && !lightbox.hidden) {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.closeLightbox();
            }
            else if (event.key === 'Tab') {
                const controls = Array.from(lightbox.querySelectorAll('button:not([disabled])'));
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (first && last && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
                    event.preventDefault();
                    (event.shiftKey ? last : first).focus();
                }
            }
            return;
        }
        if (event.key !== 'Escape')
            return;
        const picker = this.querySelector('.chat-emoji-picker');
        if (picker && !picker.hidden) {
            event.preventDefault();
            this.toggleEmojiPicker(false);
            this.querySelector('.chat-emoji-button')?.focus();
            return;
        }
        const recipientMenu = this.querySelector('.chat-recipient-menu');
        if (recipientMenu && !recipientMenu.hidden) {
            event.preventDefault();
            this.toggleRecipientMenu(false);
            this.querySelector('.chat-recipient-toggle')?.focus();
        }
    };
    handleWindowResize = () => {
        const picker = this.querySelector('.chat-emoji-picker');
        if (picker && !picker.hidden)
            this.positionEmojiPicker();
    };
    connectedCallback() {
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
        this.querySelector('.chat-form')?.addEventListener('submit', event => void this.send(event));
        this.querySelector('#local-chat-message')?.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                if (!event.repeat)
                    this.querySelector('.chat-form')?.requestSubmit();
            }
        });
        this.querySelector('.chat-emoji-button')?.addEventListener('click', () => this.toggleEmojiPicker());
        this.querySelector('.chat-image-button')?.addEventListener('click', () => {
            this.querySelector('#local-chat-image')?.click();
        });
        this.querySelector('#local-chat-image')?.addEventListener('change', event => void this.uploadImage(event));
        this.querySelector('.chat-lightbox-close')?.addEventListener('click', () => this.closeLightbox());
        this.querySelector('.chat-lightbox-download')?.addEventListener('click', () => void this.downloadLightboxImage());
        this.querySelector('.chat-new-messages')?.addEventListener('click', () => this.scrollToLatest());
        this.querySelector('.chat-reply-cancel')?.addEventListener('click', () => this.setReply(null));
        this.querySelector('.chat-clear-button')?.addEventListener('click', () => void this.clearChat());
        this.querySelector('.chat-recipient-toggle')?.addEventListener('click', () => this.toggleRecipientMenu());
        this.querySelector('.chat-ignore-button')?.addEventListener('click', () => void this.toggleIgnore());
        this.querySelector('.chat-messages')?.addEventListener('scroll', () => {
            if (this.isNearBottom())
                this.showNewMessages(false);
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
    disconnectedCallback() {
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown);
        document.removeEventListener('keydown', this.handleDocumentKeyDown);
        window.removeEventListener('resize', this.handleWindowResize);
        this.closeLightbox(false);
        this.connectionAbort?.abort();
        this.connectionAbort = null;
        this.eventSource?.close();
        this.eventSource = null;
        if (this.statusTimer !== null)
            window.clearTimeout(this.statusTimer);
        this.statusTimer = null;
    }
    populateEmojiPicker() {
        const tabs = this.querySelector('.chat-emoji-tabs');
        const search = this.querySelector('.chat-emoji-search');
        if (!tabs || !search)
            return;
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
    renderEmojiChoices() {
        const grid = this.querySelector('.chat-emoji-grid');
        const search = this.querySelector('.chat-emoji-search');
        const empty = this.querySelector('.chat-emoji-empty');
        if (!grid || !search || !empty)
            return;
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
        this.querySelectorAll('.chat-emoji-tab').forEach((button, index) => {
            const active = CHAT_EMOJI_CATEGORIES[index]?.id === this.emojiCategory && !search.value.trim();
            button.setAttribute('aria-pressed', String(active));
            button.classList.toggle('active', active);
        });
    }
    toggleRecipientMenu(force) {
        const menu = this.querySelector('.chat-recipient-menu');
        const toggle = this.querySelector('.chat-recipient-toggle');
        if (!menu || !toggle)
            return;
        const open = force ?? menu.hidden;
        menu.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        if (open)
            menu.querySelector('[aria-current="true"], button')?.focus();
    }
    recipientLabel(recipient) {
        return recipient.displayName && recipient.displayName !== recipient.callSign
            ? `${recipient.callSign} — ${recipient.displayName}` : recipient.callSign;
    }
    renderRecipientControls() {
        const menu = this.querySelector('.chat-recipient-menu');
        const toggle = this.querySelector('.chat-recipient-toggle');
        const ignore = this.querySelector('.chat-ignore-button');
        const unreadStatus = this.querySelector('.chat-private-unread');
        if (!menu || !toggle || !ignore || !unreadStatus)
            return;
        menu.replaceChildren();
        const addChoice = (label, recipientId, recipient) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'chat-recipient-choice';
            button.setAttribute('role', 'menuitem');
            button.setAttribute('aria-current', String(this.selectedRecipientId === recipientId));
            const dot = document.createElement('span');
            dot.className = `chat-presence-dot ${recipient?.presence === 'online' ? 'is-online' : 'is-offline'}`;
            dot.setAttribute('aria-hidden', 'true');
            const text = document.createElement('span');
            text.textContent = `${label}${recipient?.ignored ? ' · Ignored' : ''}`;
            if (recipient)
                button.append(dot);
            button.append(text);
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
        toggle.textContent = selected ? `To: ${this.recipientLabel(selected)} ▾` : 'To: Everyone ▾';
        toggle.setAttribute('aria-label', selected
            ? `Chat recipient: ${this.recipientLabel(selected)}, ${selected.presenceLabel}`
            : 'Chat recipient: Everyone');
        ignore.hidden = !selected;
        if (selected)
            ignore.textContent = selected.ignored ? 'Unignore' : 'Ignore private messages';
        const totalUnread = [...this.unreadCounts.values()].reduce((total, count) => total + count, 0);
        unreadStatus.hidden = totalUnread === 0;
        unreadStatus.textContent = totalUnread ? `${totalUnread} private unread` : '';
        const clear = this.querySelector('.chat-clear-button');
        if (clear)
            clear.hidden = this.viewerRole !== 'netcontrol' || Boolean(selected);
        const input = this.querySelector('#local-chat-message');
        if (input) {
            input.placeholder = selected ? `Message ${selected.callSign} privately…` : 'Message the net…';
            input.setAttribute('aria-label', selected
                ? `Private message to ${this.recipientLabel(selected)}` : 'Message everyone on the net');
        }
    }
    conversationKey(recipientId = this.selectedRecipientId) {
        return recipientId || 'public';
    }
    async switchConversation(recipientId, focusComposer = false) {
        if (recipientId && !this.recipients.has(recipientId))
            return;
        const container = this.querySelector('.chat-messages');
        if (container)
            this.scrollPositions.set(this.conversationKey(), container.scrollTop);
        this.selectedRecipientId = recipientId;
        clearPrivateUnread(this.unreadCounts, recipientId || '');
        this.setReply(null);
        this.cancelEditing(false);
        this.toggleRecipientMenu(false);
        this.renderRecipientControls();
        this.render();
        if (container)
            container.scrollTop = this.scrollPositions.get(this.conversationKey()) ?? container.scrollHeight;
        if (recipientId)
            await this.loadDirectHistory(recipientId);
        if (focusComposer)
            this.querySelector('#local-chat-message')?.focus();
    }
    async loadDirectHistory(recipientId) {
        try {
            const options = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
            const signal = this.connectionAbort?.signal;
            if (signal)
                options.signal = signal;
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/direct/${encodeURIComponent(recipientId)}/messages`, options);
            const data = (await response.json());
            if (!response.ok || !Array.isArray(data.messages) || !data.messages.every(isLocalChatMessage)) {
                throw new Error(data.error || 'Private chat history unavailable');
            }
            let conversation = this.directConversations.get(recipientId);
            if (!conversation) {
                conversation = new Map();
                this.directConversations.set(recipientId, conversation);
            }
            reconcileChatMessages(conversation, data.messages);
            const recipient = this.recipients.get(recipientId);
            if (recipient && typeof data.ignored === 'boolean')
                recipient.ignored = data.ignored;
            if (this.selectedRecipientId === recipientId) {
                this.renderRecipientControls();
                this.render({ preserveScroll: true });
            }
        }
        catch (err) {
            if (!this.connectionAbort?.signal.aborted) {
                this.setStatus(err instanceof Error ? err.message : 'Private chat history unavailable', true);
            }
        }
    }
    async toggleIgnore() {
        const recipientId = this.selectedRecipientId;
        const recipient = recipientId ? this.recipients.get(recipientId) : null;
        if (!recipientId || !recipient)
            return;
        const ignored = !recipient.ignored;
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/direct/${encodeURIComponent(recipientId)}/ignore`, {
                method: 'PUT', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ ignored })
            });
            const data = (await response.json());
            if (!response.ok || typeof data.ignored !== 'boolean')
                throw new Error(data.error || 'Ignore preference could not be updated');
            recipient.ignored = data.ignored;
            this.unreadCounts.delete(recipientId);
            if (data.ignored) {
                const conversation = this.directConversations.get(recipientId);
                conversation?.forEach((message, id) => { if (!message.mine)
                    conversation.delete(id); });
            }
            else {
                await this.loadDirectHistory(recipientId);
            }
            this.renderRecipientControls();
            this.render({ preserveScroll: true });
            this.setStatus(data.ignored ? `Private messages from ${recipient.callSign} ignored`
                : `Private messages from ${recipient.callSign} restored`, false, 3000);
        }
        catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Ignore preference could not be updated', true);
        }
    }
    toggleEmojiPicker(force) {
        const picker = this.querySelector('.chat-emoji-picker');
        const button = this.querySelector('.chat-emoji-button');
        if (!picker || !button)
            return;
        const open = force ?? picker.hidden;
        picker.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
        if (open) {
            this.positionEmojiPicker();
            this.querySelector('.chat-emoji-search')?.focus();
        }
    }
    positionEmojiPicker() {
        const picker = this.querySelector('.chat-emoji-picker');
        const button = this.querySelector('.chat-emoji-button');
        if (!picker || !button || picker.hidden)
            return;
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
    insertEmoji(emoji) {
        const input = this.querySelector('#local-chat-message');
        if (!input)
            return;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        const inserted = insertChatEmoji(input.value, start, end, emoji);
        input.value = inserted.value;
        input.setSelectionRange(inserted.caret, inserted.caret);
        this.toggleEmojiPicker(false);
        input.focus();
    }
    async connect(signal) {
        try {
            const data = await this.fetchHistory(signal);
            if (signal.aborted)
                return;
            this.applyLimits(data);
            reconcileChatMessages(this.publicMessages, data.messages.filter(message => message.scope === 'public'));
            this.reconcileDirectMessages(data.directMessages, false);
            this.updateRecipients(data.recipients);
            this.inboxInitialized = true;
            this.render({ forceBottom: true });
            this.openEvents(data.ssePath);
        }
        catch (err) {
            if (signal.aborted)
                return;
            this.setStatus(err instanceof Error ? err.message : 'Chat unavailable', true);
        }
    }
    async fetchHistory(signal) {
        const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages`, {
            credentials: 'same-origin', headers: { Accept: 'application/json' }, signal
        });
        const data = (await response.json());
        if (!response.ok)
            throw new Error(data.error || 'Chat history unavailable');
        if (!Array.isArray(data.messages) || !data.messages.every(isLocalChatMessage)
            || !Array.isArray(data.directMessages) || !data.directMessages.every(isLocalChatMessage)
            || !Array.isArray(data.recipients) || !data.recipients.every(isChatRecipient)) {
            throw new Error('Chat history response is invalid');
        }
        return data;
    }
    applyLimits(data) {
        this.viewerRole = data.viewerRole;
        this.maxMessageChars = data.limits.maxMessageChars;
        this.maxUploadBytes = data.limits.maxUploadBytes;
        this.imageMimeTypes = data.limits.imageMimeTypes;
        const input = this.querySelector('#local-chat-message');
        if (input)
            input.maxLength = this.maxMessageChars;
        const clear = this.querySelector('.chat-clear-button');
        if (clear)
            clear.hidden = this.viewerRole !== 'netcontrol' || this.selectedRecipientId !== null;
    }
    updateRecipients(recipients) {
        const selected = this.selectedRecipientId;
        this.recipients.clear();
        recipients.forEach(recipient => this.recipients.set(recipient.userId, recipient));
        const selectedWasRemoved = Boolean(selected && !this.recipients.has(selected));
        if (selectedWasRemoved) {
            this.selectedRecipientId = null;
            this.setReply(null);
            this.cancelEditing(false);
        }
        this.renderRecipientControls();
        if (selectedWasRemoved)
            this.render({ forceBottom: true });
    }
    reconcileDirectMessages(messages, countUnread) {
        messages.forEach(message => {
            if (message.scope !== 'direct' || !message.conversationUserId)
                return;
            if (!message.mine && this.recipients.get(message.conversationUserId)?.ignored)
                return;
            let conversation = this.directConversations.get(message.conversationUserId);
            if (!conversation) {
                conversation = new Map();
                this.directConversations.set(message.conversationUserId, conversation);
            }
            const isNew = !conversation.has(message.id);
            reconcileChatMessages(conversation, [message]);
            recordPrivateUnread(this.unreadCounts, message.conversationUserId, countUnread && isNew && !message.mine && this.selectedRecipientId !== message.conversationUserId);
        });
        this.renderRecipientControls();
    }
    openEvents(path) {
        this.eventSource?.close();
        const source = new EventSource(path, { withCredentials: true });
        this.eventSource = source;
        source.addEventListener('ready', () => {
            if (this.eventSource !== source)
                return;
            this.setStatus('Live', false, 2000);
            void this.reloadHistory();
        });
        source.addEventListener('message', event => {
            if (this.eventSource !== source)
                return;
            try {
                const rawData = event.data;
                if (typeof rawData !== 'string')
                    throw new Error('Chat event data is not text');
                const message = JSON.parse(rawData);
                if (!isLocalChatMessage(message))
                    throw new Error('Chat event has an invalid message');
                const wasNearBottom = this.isNearBottom();
                let isNew = false;
                if (message.scope === 'public') {
                    isNew = !message.cleared && reconcileChatMessages(this.publicMessages, [message]) === 1;
                    if (message.cleared)
                        this.publicMessages.delete(message.id);
                    if (!this.selectedRecipientId)
                        this.render({ preserveScroll: true });
                }
                else {
                    const conversationId = message.conversationUserId;
                    const conversation = conversationId ? this.directConversations.get(conversationId) : null;
                    isNew = Boolean(conversationId && !conversation?.has(message.id));
                    this.reconcileDirectMessages([message], this.inboxInitialized);
                    if (conversationId === this.selectedRecipientId)
                        this.render({ preserveScroll: true });
                }
                if (isNew && !wasNearBottom && (message.scope === 'public' ? !this.selectedRecipientId
                    : message.conversationUserId === this.selectedRecipientId))
                    this.showNewMessages(true);
            }
            catch (err) {
                logger.error('Invalid local chat event', err);
            }
        });
        source.addEventListener('recipients', event => {
            if (this.eventSource !== source)
                return;
            try {
                const recipients = JSON.parse(String(event.data));
                if (!Array.isArray(recipients) || !recipients.every(isChatRecipient))
                    throw new Error('Invalid recipient list');
                this.updateRecipients(recipients);
            }
            catch (err) {
                logger.error('Invalid local chat recipient event', err);
            }
        });
        source.addEventListener('preferences', event => {
            if (this.eventSource !== source)
                return;
            try {
                const data = JSON.parse(String(event.data));
                if (!Array.isArray(data.ignoredUserIds))
                    return;
                const ignored = new Set(data.ignoredUserIds.filter((id) => typeof id === 'string'));
                this.recipients.forEach(recipient => { recipient.ignored = ignored.has(recipient.userId); });
                this.renderRecipientControls();
            }
            catch (err) {
                logger.error('Invalid local chat preference event', err);
            }
        });
        source.addEventListener('access', event => {
            if (this.eventSource !== source)
                return;
            try {
                const data = JSON.parse(String(event.data));
                if (!data.suspended)
                    return;
                this.suspended = true;
                source.close();
                this.setComposerDisabled(true);
                this.setStatus(data.reason ? `Chat suspended: ${data.reason}` : 'Chat access has been suspended for this net', true);
            }
            catch (err) {
                logger.error('Invalid local chat access event', err);
            }
        });
        source.onerror = () => {
            if (this.eventSource === source && !this.suspended)
                this.setStatus('Reconnecting…');
        };
    }
    async reloadHistory() {
        if (this.reloadingHistory)
            return;
        const signal = this.connectionAbort?.signal;
        if (!signal)
            return;
        this.reloadingHistory = true;
        try {
            const data = await this.fetchHistory(signal);
            if (signal.aborted)
                return;
            this.applyLimits(data);
            reconcileChatMessages(this.publicMessages, data.messages.filter(message => message.scope === 'public'));
            this.reconcileDirectMessages(data.directMessages, this.inboxInitialized);
            this.updateRecipients(data.recipients);
            this.inboxInitialized = true;
            this.render({ preserveScroll: true });
        }
        catch (err) {
            if (signal.aborted)
                return;
            logger.error('Local chat reconnect history failed', err);
            this.setStatus('Live updates restored; history refresh failed', true);
        }
        finally {
            this.reloadingHistory = false;
        }
    }
    async send(event) {
        event.preventDefault();
        if (this.sending)
            return;
        const input = this.querySelector('#local-chat-message');
        const text = input?.value.trim() || '';
        if (!input || !text)
            return;
        const recipientId = this.selectedRecipientId;
        this.sending = true;
        this.setComposerDisabled(true);
        this.setStatus('Sending…');
        try {
            const path = recipientId
                ? `/api/chat/${encodeURIComponent(this.npid)}/direct/${encodeURIComponent(recipientId)}/messages`
                : `/api/chat/${encodeURIComponent(this.npid)}/messages`;
            const response = await fetch(path, {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, replyTo: this.replyingToId })
            });
            const data = (await response.json());
            if (!response.ok || !data.message)
                throw new Error(data.error || 'Message could not be sent');
            if (data.message.scope === 'direct')
                this.reconcileDirectMessages([data.message], false);
            else
                reconcileChatMessages(this.publicMessages, [data.message]);
            input.value = '';
            if (this.selectedRecipientId === recipientId) {
                this.setReply(null);
                this.render({ forceBottom: true });
            }
            this.setStatus('Live', false, 1500);
        }
        catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Message could not be sent', true);
        }
        finally {
            this.sending = false;
            this.setComposerDisabled(this.suspended);
            input.focus();
        }
    }
    setComposerDisabled(disabled) {
        const input = this.querySelector('#local-chat-message');
        const send = this.querySelector('.chat-send-btn');
        const image = this.querySelector('.chat-image-button');
        const emoji = this.querySelector('.chat-emoji-button');
        if (input)
            input.disabled = disabled;
        if (send)
            send.disabled = disabled;
        if (image)
            image.disabled = disabled;
        if (emoji)
            emoji.disabled = disabled;
    }
    async uploadImage(event) {
        const fileInput = event.currentTarget;
        const file = fileInput.files?.[0];
        if (!file || this.uploading)
            return;
        const recipientId = this.selectedRecipientId;
        const button = this.querySelector('.chat-image-button');
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
        if (button)
            button.setAttribute('aria-disabled', 'true');
        fileInput.disabled = true;
        this.setStatus('Uploading image…');
        try {
            const path = recipientId
                ? `/api/chat/${encodeURIComponent(this.npid)}/direct/${encodeURIComponent(recipientId)}/images`
                : `/api/chat/${encodeURIComponent(this.npid)}/images`;
            const response = await fetch(path, {
                method: 'POST', credentials: 'same-origin',
                headers: {
                    'Content-Type': file.type,
                    Accept: 'application/json',
                    ...(this.replyingToId ? { 'X-Chat-Reply-To': this.replyingToId } : {})
                }, body: file
            });
            const data = (await response.json());
            if (!response.ok || !data.message)
                throw new Error(data.error || 'Image could not be uploaded');
            if (data.message.scope === 'direct')
                this.reconcileDirectMessages([data.message], false);
            else
                reconcileChatMessages(this.publicMessages, [data.message]);
            if (this.selectedRecipientId === recipientId) {
                this.setReply(null);
                this.render({ forceBottom: true });
            }
            this.setStatus('Image shared', false, 2500);
        }
        catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Image could not be uploaded', true);
        }
        finally {
            this.uploading = false;
            fileInput.value = '';
            fileInput.disabled = false;
            if (button)
                button.removeAttribute('aria-disabled');
        }
    }
    startEditing(message) {
        if (!message.canEdit || message.deleted)
            return;
        this.editingMessageId = message.id;
        this.editDraft = message.text;
        this.render({ preserveScroll: true });
        const editor = this.querySelector('.chat-edit-input');
        editor?.focus();
        editor?.setSelectionRange(editor.value.length, editor.value.length);
    }
    cancelEditing(render = true) {
        this.editingMessageId = null;
        this.editDraft = '';
        if (render)
            this.render({ preserveScroll: true });
    }
    async saveEdit(message) {
        if (this.savingEdit)
            return;
        const text = this.editDraft.trim();
        if ((!text && !message.attachment) || text.length > this.maxMessageChars) {
            this.setStatus(text.length > this.maxMessageChars
                ? `Message exceeds ${this.maxMessageChars} characters` : 'Message text is required', true);
            return;
        }
        this.savingEdit = true;
        this.querySelectorAll('.chat-edit-controls button, .chat-edit-input')
            .forEach(control => { control.disabled = true; });
        this.setStatus('Saving edit…');
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages/${encodeURIComponent(message.id)}`, {
                method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const data = (await response.json());
            if (!response.ok || !data.message)
                throw new Error(data.error || 'Message could not be edited');
            reconcileChatMessages(this.messages, [data.message]);
            this.editingMessageId = null;
            this.editDraft = '';
            this.render({ preserveScroll: true });
            this.setStatus('Message updated', false, 2500);
        }
        catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Message could not be edited', true);
            const editor = this.querySelector('.chat-edit-input');
            if (editor)
                editor.disabled = false;
            this.querySelectorAll('.chat-edit-controls button').forEach(button => { button.disabled = false; });
            editor?.focus();
        }
        finally {
            this.savingEdit = false;
        }
    }
    async deleteMessage(messageId) {
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages/${encodeURIComponent(messageId)}`, {
                method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json' }
            });
            const data = (await response.json());
            if (!response.ok || !data.message)
                throw new Error(data.error || 'Message could not be deleted');
            reconcileChatMessages(this.messages, [data.message]);
            if (this.editingMessageId === messageId)
                this.editingMessageId = null;
            this.render({ preserveScroll: true });
        }
        catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Delete failed', true);
        }
    }
    setReply(message) {
        this.replyingToId = message?.id ?? null;
        const banner = this.querySelector('.chat-reply-composer');
        const text = this.querySelector('.chat-reply-composer-text');
        if (banner)
            banner.hidden = !message;
        if (text)
            text.textContent = message ? `Replying to ${message.callSign}: ${this.messagePreview(message)}` : '';
        if (message)
            this.querySelector('#local-chat-message')?.focus();
    }
    messagePreview(message) {
        if (message.deleted)
            return '[message deleted]';
        return (message.text || (message.attachment ? '[Image]' : '[message unavailable]')).slice(0, 80);
    }
    async updateMessage(path, method, body) {
        try {
            const options = {
                method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
            };
            if (body)
                options.body = JSON.stringify(body);
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/${path}`, options);
            const data = (await response.json());
            if (!response.ok)
                throw new Error(data.error || 'Chat action failed');
            if (data.message) {
                reconcileChatMessages(this.messages, [data.message]);
                this.render({ preserveScroll: true });
            }
        }
        catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Chat action failed', true);
        }
    }
    async toggleReaction(message, emoji) {
        if (!message.canReact)
            return;
        await this.updateMessage(`messages/${encodeURIComponent(message.id)}/reaction`, 'PUT', { emoji });
    }
    async togglePin(message) {
        if (!message.canPin)
            return;
        await this.updateMessage(`messages/${encodeURIComponent(message.id)}/pin`, 'PUT', { pinned: !message.pinned });
    }
    async banAuthor(message) {
        if (!message.canBan || !window.confirm(`Ban ${message.callSign} from chat for this net?`))
            return;
        await this.updateMessage(`messages/${encodeURIComponent(message.id)}/ban`, 'POST');
        this.setStatus(`${message.callSign} was banned from chat`, false, 3000);
    }
    async clearChat() {
        if (this.viewerRole !== 'netcontrol' || this.selectedRecipientId !== null
            || !window.confirm('Clear all public chat messages for this net? This cannot be undone.'))
            return;
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages`, {
                method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json' }
            });
            const data = (await response.json());
            if (!response.ok)
                throw new Error(data.error || 'Public chat could not be cleared');
            this.publicMessages.clear();
            this.setReply(null);
            this.render({ forceBottom: true });
            this.setStatus('Public chat cleared', false, 3000);
        }
        catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Public chat could not be cleared', true);
        }
    }
    render(options = {}) {
        const container = this.querySelector('.chat-messages');
        if (!container)
            return;
        const nearBottom = this.isNearBottom();
        const previousScrollTop = container.scrollTop;
        container.replaceChildren();
        sortChatMessages(this.messages.values())
            .forEach(message => container.append(this.renderMessage(message)));
        if (shouldScrollChatToLatest(Boolean(options.forceBottom), nearBottom)) {
            container.scrollTop = container.scrollHeight;
            this.showNewMessages(false);
        }
        else if (options.preserveScroll) {
            container.scrollTop = previousScrollTop;
        }
    }
    renderMessage(message) {
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
        if (message.replyTo)
            this.appendReplyReference(row, message.replyTo);
        if (this.editingMessageId === message.id && !message.deleted)
            this.appendEditor(row, message);
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
    appendEditor(row, message) {
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
            }
            else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                if (!event.repeat)
                    void this.saveEdit(message);
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
    appendReplyReference(row, replyTo) {
        const reference = document.createElement('div');
        reference.className = 'chat-reply-reference';
        const target = this.messages.get(replyTo);
        reference.textContent = target
            ? `↩ ${target.callSign}: ${this.messagePreview(target)}`
            : '↩ Original message unavailable';
        row.append(reference);
    }
    appendReactions(row, message) {
        if (!message.reactions.length)
            return;
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
    appendMessageActions(row, message) {
        if (!message.canReact && !message.canReply && !message.canEdit && !message.canDelete
            && !message.canPin && !message.canBan && !message.canMessagePrivately)
            return;
        const controls = document.createElement('div');
        controls.className = 'chat-message-actions';
        const addAction = (icon, label, className, action) => {
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
                const menu = controls.querySelector('.chat-quick-reactions');
                if (menu)
                    menu.hidden = !menu.hidden;
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
        if (message.canReply)
            addAction('↩', 'Reply to', 'chat-action-reply', () => this.setReply(message));
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
        if (message.canPin)
            addAction('📌', message.pinned ? 'Unpin' : 'Pin', 'chat-action-pin', () => void this.togglePin(message));
        if (message.canBan)
            addAction('⛔', 'Ban author of', 'chat-action-ban', () => void this.banAuthor(message));
        row.append(controls);
    }
    safeAttachmentUrl(message) {
        if (!message.attachment)
            return false;
        try {
            const url = new URL(message.attachment.url, window.location.origin);
            const expected = `/api/chat/${encodeURIComponent(this.npid)}/messages/${encodeURIComponent(message.id)}/image`;
            return url.origin === window.location.origin && url.pathname === expected && !url.search && !url.hash;
        }
        catch {
            return false;
        }
    }
    openLightbox(url, alt, mimeType, trigger) {
        const lightbox = this.querySelector('.chat-lightbox');
        const image = this.querySelector('.chat-lightbox-image');
        const status = this.querySelector('.chat-lightbox-status');
        if (!lightbox || !image || !url)
            return;
        this.lightboxTrigger = trigger;
        this.lightboxUrl = url;
        this.lightboxMimeType = mimeType;
        this.previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        image.src = url;
        image.alt = alt;
        if (status)
            status.textContent = '';
        lightbox.hidden = false;
        this.querySelector('.chat-lightbox-close')?.focus();
    }
    closeLightbox(returnFocus = true) {
        const lightbox = this.querySelector('.chat-lightbox');
        if (!lightbox || lightbox.hidden)
            return;
        lightbox.hidden = true;
        const image = this.querySelector('.chat-lightbox-image');
        image?.removeAttribute('src');
        document.body.style.overflow = this.previousBodyOverflow;
        if (returnFocus)
            this.lightboxTrigger?.focus();
        this.lightboxTrigger = null;
        this.lightboxUrl = '';
        this.lightboxMimeType = '';
    }
    async downloadLightboxImage() {
        if (!this.lightboxUrl)
            return;
        const button = this.querySelector('.chat-lightbox-download');
        const status = this.querySelector('.chat-lightbox-status');
        if (button)
            button.disabled = true;
        if (status)
            status.textContent = 'Preparing download…';
        try {
            const response = await fetch(this.lightboxUrl, { credentials: 'same-origin' });
            if (!response.ok)
                throw new Error('Image download failed');
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            const extension = {
                'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp'
            }[this.lightboxMimeType] ?? 'img';
            anchor.href = objectUrl;
            anchor.download = `chat-image.${extension}`;
            anchor.hidden = true;
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
            if (status)
                status.textContent = 'Download started';
        }
        catch (err) {
            if (status)
                status.textContent = err instanceof Error ? err.message : 'Image download failed';
        }
        finally {
            if (button)
                button.disabled = false;
        }
    }
    isNearBottom() {
        const container = this.querySelector('.chat-messages');
        return !container || container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    }
    scrollToLatest() {
        const container = this.querySelector('.chat-messages');
        if (container)
            container.scrollTop = container.scrollHeight;
        this.showNewMessages(false);
    }
    showNewMessages(show) {
        const button = this.querySelector('.chat-new-messages');
        if (button)
            button.hidden = !show;
    }
    setStatus(text, error = false, hideAfterMs = error ? 8000 : 0) {
        const status = this.querySelector('.chat-status');
        if (!status)
            return;
        if (this.statusTimer !== null)
            window.clearTimeout(this.statusTimer);
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
    static init(_store, _level) {
        void _store;
        void _level;
        if (!customElements.get('hl-chat'))
            customElements.define('hl-chat', ChatWidget);
        const container = document.getElementById('local-chat-container');
        if (container && serverInfo.chat) {
            const widget = document.createElement('hl-chat');
            widget.className = container.className;
            container.replaceWith(widget);
        }
    }
}
export { ChatWidget as ChatClient };
//# sourceMappingURL=chat.js.map