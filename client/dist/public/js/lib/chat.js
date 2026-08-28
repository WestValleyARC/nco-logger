import { createLogger } from '#@client/lib/logger.js';
import { serverInfo } from '#@client/lib/serverInfo.js';
import { getNpid } from '#@client/lib/clientUtils.js';
const logger = createLogger('lib/chat.ts');
export class ChatWidget extends HTMLElement {
    npid = getNpid().toString();
    messages = new Map();
    eventSource = null;
    maxMessageChars = 2000;
    connectedCallback() {
        this.style.display = 'block';
        this.style.height = '100%';
        this.style.minHeight = '0';
        this.innerHTML = `
            <div class="chat-widget h-100 d-flex flex-column" style="min-height:0">
                <div class="chat-status small text-muted mb-1" role="status">Connecting…</div>
                <div class="chat-messages flex-grow-1 overflow-auto" style="min-height:0" aria-live="polite"></div>
                <form class="chat-form d-flex gap-2 mt-2">
                    <label class="visually-hidden" for="local-chat-message">Chat message</label>
                    <input id="local-chat-message" class="form-control" type="text" autocomplete="off" placeholder="Message the net" required>
                    <button class="btn btn-primary" type="submit">Send</button>
                </form>
            </div>`;
        this.querySelector('.chat-form')?.addEventListener('submit', event => void this.send(event));
        void this.connect();
    }
    disconnectedCallback() {
        this.eventSource?.close();
        this.eventSource = null;
    }
    async connect() {
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages`, {
                credentials: 'same-origin', headers: { Accept: 'application/json' }
            });
            const data = (await response.json());
            if (!response.ok)
                throw new Error(data.error || 'Chat history unavailable');
            this.maxMessageChars = data.limits.maxMessageChars;
            const input = this.querySelector('#local-chat-message');
            if (input)
                input.maxLength = this.maxMessageChars;
            data.messages.forEach(message => this.messages.set(message.id, message));
            this.render();
            this.openEvents(data.ssePath);
        }
        catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Chat unavailable', true);
        }
    }
    openEvents(path) {
        this.eventSource?.close();
        this.eventSource = new EventSource(path, { withCredentials: true });
        this.eventSource.addEventListener('ready', () => {
            this.setStatus('Live');
            void this.reloadHistory();
        });
        this.eventSource.addEventListener('message', event => {
            try {
                const message = JSON.parse(event.data);
                this.messages.set(message.id, message);
                this.render();
            }
            catch (err) {
                logger.error('Invalid local chat event', err);
            }
        });
        this.eventSource.onerror = () => this.setStatus('Reconnecting…');
    }
    async reloadHistory() {
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages`, {
                credentials: 'same-origin', headers: { Accept: 'application/json' }
            });
            if (!response.ok)
                return;
            const data = (await response.json());
            data.messages.forEach(message => this.messages.set(message.id, message));
            this.render();
        }
        catch (err) {
            logger.error('Local chat reconnect history failed', err);
        }
    }
    async send(event) {
        event.preventDefault();
        const input = this.querySelector('#local-chat-message');
        const text = input?.value.trim() || '';
        if (!input || !text)
            return;
        input.disabled = true;
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(this.npid)}/messages`, {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const data = (await response.json());
            if (!response.ok || !data.message)
                throw new Error(data.error || 'Message could not be sent');
            this.messages.set(data.message.id, data.message);
            input.value = '';
            this.render();
        }
        catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Message could not be sent', true);
        }
        finally {
            input.disabled = false;
            input.focus();
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
            this.messages.set(data.message.id, data.message);
            this.render();
        }
        catch (err) {
            this.setStatus(err instanceof Error ? err.message : 'Delete failed', true);
        }
    }
    render() {
        const container = this.querySelector('.chat-messages');
        if (!container)
            return;
        const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
        container.replaceChildren();
        [...this.messages.values()]
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
            .forEach(message => {
            const row = document.createElement('div');
            row.className = 'chat-message border-bottom py-1';
            const heading = document.createElement('div');
            const author = document.createElement('strong');
            author.textContent = message.displayName && message.displayName !== message.callSign
                ? `${message.displayName} (${message.callSign})` : message.callSign;
            const time = document.createElement('small');
            time.className = 'text-muted ms-2';
            time.textContent = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            heading.append(author, time);
            const body = document.createElement('div');
            body.className = message.deleted ? 'text-muted fst-italic' : '';
            body.textContent = message.deleted ? '[message deleted]' : message.text;
            row.append(heading, body);
            if (message.canDelete) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn btn-sm btn-link text-danger p-0';
                button.textContent = 'Delete';
                button.addEventListener('click', () => void this.deleteMessage(message.id));
                row.append(button);
            }
            container.append(row);
        });
        if (nearBottom)
            container.scrollTop = container.scrollHeight;
    }
    setStatus(text, error = false) {
        const status = this.querySelector('.chat-status');
        if (status) {
            status.textContent = text;
            status.classList.toggle('text-danger', error);
        }
    }
    static init(_store, _level) {
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