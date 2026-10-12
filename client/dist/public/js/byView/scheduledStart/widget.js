import { HamLiveElement } from '#@client/lib/widgets.js';
export class ScheduledOpeningWidget extends HamLiveElement {
    busy = false;
    static async init(store) {
        await this.initElement('scheduled-opening', ScheduledOpeningWidget, store);
    }
    getTemplate() {
        return `<style>
            :host { display:block; max-width:46rem; }
            button { display:block; width:100%; padding:1rem; margin:1rem 0; text-align:left;
                border:1px solid #6eb8c0; border-radius:.6rem; background:#20313b; color:#fff; font:inherit; cursor:pointer; }
            button:focus-visible { outline:3px solid #dc8335; outline-offset:3px; }
            button:disabled { opacity:.6; cursor:wait; }
            strong, small { display:block; } small { margin-top:.4rem; }
        </style><section id="${this.defaultElementId}" aria-label="Room opening options">
            <p data-schedule>Loading scheduled start…</p>
            <p>The scheduled start stays the same. Choose when participants can enter the logger and chat.</p>
            <button type="button" data-mode="early" disabled><strong>Open room now for early check-ins</strong>
                <small>Show the room in Live Nets immediately and allow check-ins and chat.</small></button>
            <button type="button" data-mode="scheduled" disabled><strong>Wait until scheduled start</strong>
                <small>Prepare privately now. The public room opens automatically at the scheduled time, even if you leave.</small></button>
            <p role="status" aria-live="polite" data-status></p>
        </section>`;
    }
    didMyDataSegmentChange() {
        return true;
    }
    render() {
        const data = this.store?.mainCache;
        if (!data)
            return;
        const schedule = this.root.querySelector('[data-schedule]');
        if (schedule)
            schedule.textContent = `Scheduled start: ${new Date(data.startAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}`;
        const available = ['scheduled', 'preparing', 'live'].includes(data.status);
        this.root.querySelectorAll('button').forEach(button => {
            button.disabled = this.busy || !available;
        });
        if (!available)
            this.showStatus('This occurrence has ended or is no longer available. Return to My Nets.');
    }
    onConnected() {
        this.root.querySelectorAll('button').forEach(button => {
            button.addEventListener('click', () => {
                void this.choose(button.dataset['mode']);
            });
        });
    }
    onDisconnected() { }
    showStatus(message) {
        const status = this.root.querySelector('[data-status]');
        if (status)
            status.textContent = message;
    }
    async choose(mode) {
        if (this.busy || !this.store)
            return;
        this.busy = true;
        this.render();
        this.showStatus('Opening your net…');
        try {
            const url = await this.store.open(mode);
            this.busy = false;
            this.render();
            window.location.assign(url);
        }
        catch (error) {
            this.showStatus(error instanceof Error ? error.message : 'Unable to open the net. Try again.');
            this.busy = false;
            this.render();
        }
    }
}
//# sourceMappingURL=widget.js.map