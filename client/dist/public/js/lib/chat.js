import { createLogger } from '#@client/lib/logger.js';
import { serverInfo } from '#@client/lib/serverInfo.js';
import { getNpid } from '#@client/lib/clientUtils.js';
import { reconcileChatMessages, sortChatMessages } from '#@client/lib/chatState.js';
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
        && typeof message['displayName'] === 'string'
        && typeof message['text'] === 'string'
        && typeof message['createdAt'] === 'string'
        && (message['editedAt'] === null || typeof message['editedAt'] === 'string')
        && typeof message['deleted'] === 'boolean'
        && typeof message['mine'] === 'boolean'
        && typeof message['canEdit'] === 'boolean'
        && typeof message['canDelete'] === 'boolean'
        && validAttachment;
};
export class ChatWidget extends HTMLElement {
    npid = getNpid().toString();
    messages = new Map();
    eventSource = null;
    connectionAbort = null;
    statusTimer = null;
    sending = false;
    uploading = false;
    reloadingHistory = false;
    editingMessageId = null;
    editDraft = '';
    savingEdit = false;
    emojiCategory = CHAT_EMOJI_CATEGORIES[0]?.id ?? '';
    lightboxTrigger = null;
    lightboxUrl = '';
    lightboxMimeType = '';
    previousBodyOverflow = '';
    maxMessageChars = 2000;
    maxUploadBytes = 5 * 1024 * 1024;
    imageMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    handleDocumentPointerDown = (event) => {
        const target = event.target;
        if (!(target instanceof Node))
            return;
        const picker = this.querySelector('.chat-emoji-picker');
        const toggle = this.querySelector('.chat-emoji-button');
        if (picker && !picker.hidden && !picker.contains(target) && !toggle?.contains(target)) {
            this.toggleEmojiPicker(false);
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
                <div class="chat-status small text-muted mb-1" role="status" aria-live="polite">Connecting…</div>
                <div class="chat-messages flex-grow-1 overflow-auto" style="min-height:0" aria-live="polite"></div>
                <button class="btn btn-sm btn-outline-info chat-new-messages align-self-center mt-1" type="button" hidden>New messages ↓</button>
                <div class="chat-composer-wrap position-relative mt-2">
                    <div class="chat-emoji-picker" role="dialog" aria-label="Emoji picker" hidden>
                        <label class="visually-hidden" for="local-chat-emoji-search">Search emoji</label>
                        <input id="local-chat-emoji-search" class="form-control form-control-sm chat-emoji-search" type="search" placeholder="Search emoji" autocomplete="off">
                        <div class="chat-emoji-tabs" role="group" aria-label="Emoji categories"></div>
                        <div class="chat-emoji-grid" role="group" aria-label="Available emoji"></div>
                        <div class="chat-emoji-empty text-muted" role="status" hidden>No emoji found</div>
                    </div>
                    <form class="chat-form d-flex gap-2 align-items-end">
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
                                <button class="chat-lightbox-download" type="button" aria-label="Download original chat image">Download</button>
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
            reconcileChatMessages(this.messages, data.messages);
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
        return data;
    }
    applyLimits(data) {
        this.maxMessageChars = data.limits.maxMessageChars;
        this.maxUploadBytes = data.limits.maxUploadBytes;
        this.imageMimeTypes = data.limits.imageMimeTypes;
        const input = this.querySelector('#local-chat-message');
        if (input)
            input.maxLength = this.maxMessageChars;
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
                const isNew = reconcileChatMessages(this.messages, [message]) === 1;
                const wasNearBottom = this.isNearBottom();
                this.render({ preserveScroll: true });
                if (isNew && !wasNearBottom)
                    this.showNewMessages(true);
            }
            catch (err) {
                logger.error('Invalid local chat event', err);
            }
        });
        source.onerror = () => {
            if (this.eventSource === source)
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
            reconcileChatMessages(this.messages, data.messages);
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
        this.sending = true;
        this.setComposerDisabled(true);
        this.setStatus('Sending…');
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages`, {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const data = (await response.json());
            if (!response.ok || !data.message)
                throw new Error(data.error || 'Message could not be sent');
            reconcileChatMessages(this.messages, [data.message]);
            input.value = '';
            this.render({ forceBottom: true });
            this.setStatus('Live', false, 1500);
        }
        catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Message could not be sent', true);
        }
        finally {
            this.sending = false;
            this.setComposerDisabled(false);
            input.focus();
        }
    }
    setComposerDisabled(disabled) {
        const input = this.querySelector('#local-chat-message');
        const send = this.querySelector('.chat-send-btn');
        if (input)
            input.disabled = disabled;
        if (send)
            send.disabled = disabled;
    }
    async uploadImage(event) {
        const fileInput = event.currentTarget;
        const file = fileInput.files?.[0];
        if (!file || this.uploading)
            return;
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
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/images`, {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': file.type, Accept: 'application/json' }, body: file
            });
            const data = (await response.json());
            if (!response.ok || !data.message)
                throw new Error(data.error || 'Image could not be uploaded');
            reconcileChatMessages(this.messages, [data.message]);
            this.render({ forceBottom: true });
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
    cancelEditing() {
        this.editingMessageId = null;
        this.editDraft = '';
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
    render(options = {}) {
        const container = this.querySelector('.chat-messages');
        if (!container)
            return;
        const nearBottom = this.isNearBottom();
        const previousScrollTop = container.scrollTop;
        container.replaceChildren();
        sortChatMessages(this.messages.values())
            .forEach(message => container.append(this.renderMessage(message)));
        if (options.forceBottom || nearBottom) {
            container.scrollTop = container.scrollHeight;
            this.showNewMessages(false);
        }
        else if (options.preserveScroll) {
            container.scrollTop = previousScrollTop;
        }
    }
    renderMessage(message) {
        const row = document.createElement('div');
        row.className = 'chat-message border-bottom py-1';
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
        if (message.editedAt && !message.deleted) {
            const edited = document.createElement('small');
            edited.className = 'chat-edited text-muted ms-1';
            edited.textContent = '(edited)';
            edited.title = `Edited ${new Date(message.editedAt).toLocaleString()}`;
            heading.append(edited);
        }
        row.append(heading);
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
            this.appendMessageControls(row, message);
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
    appendMessageControls(row, message) {
        if (!message.canEdit && !message.canDelete)
            return;
        const controls = document.createElement('div');
        controls.className = 'chat-message-controls d-flex gap-2';
        if (message.canEdit) {
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'btn btn-sm btn-link p-0';
            edit.textContent = 'Edit';
            edit.setAttribute('aria-label', `Edit message from ${message.callSign}`);
            edit.addEventListener('click', () => this.startEditing(message));
            controls.append(edit);
        }
        if (message.canDelete) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn btn-sm btn-link text-danger p-0';
            remove.textContent = 'Delete';
            remove.setAttribute('aria-label', `Delete message from ${message.callSign}`);
            remove.addEventListener('click', () => void this.deleteMessage(message.id));
            controls.append(remove);
        }
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