import { boundaryLimits, resizeSharedBoundary, sharedBoundaries, type PaneMinimums, type SharedBoundary } from './loggerSplitters.js';
import type { LoggerGridLayout } from './loggerGrid.js';

type Options = {
    read: () => LoggerGridLayout;
    visible: (layout: LoggerGridLayout) => string[];
    minimums: () => PaneMinimums;
    labels: Record<string, string>;
    allowed?: (boundary: SharedBoundary) => boolean;
    apply: (layout: LoggerGridLayout) => void;
    save: () => void;
};

/** A boundary owns both panes and retains its DOM node during pointer capture. */
export class LoggerSplitterControls {
    private drag: { pointerId: number; handle: HTMLElement; layout: LoggerGridLayout; boundary: SharedBoundary; start: number; step: number } | null = null;
    private handles = new Map<string, HTMLElement>();
    private observer: ResizeObserver;
    constructor(private dashboard: HTMLElement, private options: Options) {
        this.observer = new ResizeObserver(() => this.render());
        this.observer.observe(dashboard);
    }

    render(): void {
        const layout = this.options.read();
        const boundaries = sharedBoundaries(layout, this.options.visible(layout));
        const retained = new Set<string>();
        const box = this.dashboard.getBoundingClientRect();
        for (const boundary of boundaries) {
            const limits = boundaryLimits(layout, boundary, this.options.minimums());
            if (limits.min >= limits.max || this.options.allowed?.(boundary) === false) continue;
            retained.add(boundary.id);
            let handle = this.handles.get(boundary.id);
            if (!handle) {
                handle = document.createElement('div');
                handle.className = 'nch-shared-splitter';
                handle.dataset['splitter'] = boundary.id;
                handle.tabIndex = 0;
                handle.setAttribute('role', 'separator');
                handle.addEventListener('pointerdown', event => this.start(event, boundary.id));
                handle.addEventListener('pointermove', event => this.move(event));
                handle.addEventListener('pointerup', event => this.finish(event, false));
                handle.addEventListener('pointercancel', event => this.finish(event, true));
                handle.addEventListener('lostpointercapture', event => this.finish(event, true));
                handle.addEventListener('keydown', event => this.key(event, boundary.id));
                this.handles.set(boundary.id, handle);
                this.dashboard.append(handle);
            }
            handle.dataset['axis'] = boundary.axis;
            handle.setAttribute('aria-orientation', boundary.axis === 'x' ? 'vertical' : 'horizontal');
            handle.setAttribute('aria-label', `${boundary.before.map(id => this.options.labels[id]).join(', ')} / ${boundary.after.map(id => this.options.labels[id]).join(', ')}`);
            handle.setAttribute('aria-valuemin', String(limits.min));
            handle.setAttribute('aria-valuemax', String(limits.max));
            handle.setAttribute('aria-valuenow', String(boundary.position));
            const elements = [...boundary.before, ...boundary.after].map(id => this.dashboard.querySelector<HTMLElement>(`[data-module="${id}"]`));
            if (elements.some(element => !element)) continue;
            const rectangles = elements.map(element => element!.getBoundingClientRect());
            const before = rectangles.slice(0, boundary.before.length);
            const after = rectangles.slice(boundary.before.length);
            if (boundary.axis === 'x') {
                const x = (Math.max(...before.map(rect => rect.right)) + Math.min(...after.map(rect => rect.left))) / 2;
                const top = Math.min(...rectangles.map(rect => rect.top));
                Object.assign(handle.style, { left: `${x - box.left + this.dashboard.scrollLeft}px`, top: `${top - box.top + this.dashboard.scrollTop + 24}px`, width: '44px', height: `${Math.max(0, Math.max(...rectangles.map(rect => rect.bottom)) - top - 48)}px` });
            } else {
                const y = (Math.max(...before.map(rect => rect.bottom)) + Math.min(...after.map(rect => rect.top))) / 2;
                const left = Math.min(...rectangles.map(rect => rect.left));
                Object.assign(handle.style, { left: `${left - box.left + this.dashboard.scrollLeft + 32}px`, top: `${y - box.top + this.dashboard.scrollTop}px`, width: `${Math.max(0, Math.max(...rectangles.map(rect => rect.right)) - left - 64)}px`, height: '44px' });
            }
        }
        for (const [id, handle] of this.handles) {
            if (!retained.has(id)) {
                if (this.drag?.handle === handle) this.cancel();
                handle.remove();
                this.handles.delete(id);
            }
        }
        // Docked panes have no competing edge/corner handles. Undocked panes
        // retain the existing desktop resize interaction.
        const docked = new Set(boundaries.flatMap(boundary => [...boundary.before, ...boundary.after]));
        this.dashboard.querySelectorAll<HTMLElement>('[data-module]').forEach(element => {
            element.classList.toggle('nch-module-docked', docked.has(element.dataset['module']!));
        });
    }

    private start(event: PointerEvent, id: string): void {
        if (event.button !== 0 || this.drag) return;
        const layout = this.options.read();
        const boundary = sharedBoundaries(layout, this.options.visible(layout)).find(item => item.id === id);
        if (!boundary) return;
        const handle = event.currentTarget as HTMLElement;
        const pane = this.dashboard.querySelector<HTMLElement>(`[data-module="${boundary.before[0]}"]`)!;
        const rect = pane.getBoundingClientRect();
        const item = layout.items[boundary.before[0]!]!;
        const gap = parseFloat(getComputedStyle(this.dashboard).gap) || 0;
        const step = boundary.axis === 'x' ? (rect.width + gap) / item.w : (rect.height + gap) / item.h;
        event.preventDefault();
        event.stopPropagation();
        handle.focus({ preventScroll: true });
        this.drag = { pointerId: event.pointerId, handle, layout, boundary, start: boundary.axis === 'x' ? event.clientX : event.clientY, step };
        handle.setPointerCapture(event.pointerId);
        document.body.classList.add('nch-splitting');
    }

    private move(event: PointerEvent): void {
        const drag = this.drag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const coordinate = drag.boundary.axis === 'x' ? event.clientX : event.clientY;
        const next = resizeSharedBoundary(drag.layout, drag.boundary, drag.boundary.position + (coordinate - drag.start) / drag.step, this.options.minimums(), this.options.visible(drag.layout));
        if (next) this.options.apply(next);
    }

    private finish(event: PointerEvent, cancelled: boolean): void {
        if (this.drag?.pointerId !== event.pointerId) return;
        if (!cancelled) this.move(event);
        const drag = this.drag;
        this.drag = null;
        document.body.classList.remove('nch-splitting');
        if (drag.handle.hasPointerCapture(event.pointerId)) drag.handle.releasePointerCapture(event.pointerId);
        if (cancelled) this.options.apply(drag.layout);
        else this.options.save();
    }

    cancel(): void {
        if (!this.drag) return;
        this.finish({ pointerId: this.drag.pointerId } as PointerEvent, true);
    }

    private key(event: KeyboardEvent, id: string): void {
        const layout = this.options.read();
        const boundary = sharedBoundaries(layout, this.options.visible(layout)).find(item => item.id === id);
        if (!boundary) return;
        const keys = boundary.axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const next = resizeSharedBoundary(layout, boundary, boundary.position + (event.key === keys[0] ? -1 : 1), this.options.minimums(), this.options.visible(layout));
        if (next) { this.options.apply(next); this.options.save(); }
    }

    destroy(): void {
        this.cancel();
        this.observer.disconnect();
        for (const handle of this.handles.values()) handle.remove();
        this.handles.clear();
    }
}
