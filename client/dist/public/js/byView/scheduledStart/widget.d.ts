import { HamLiveElement } from '#@client/lib/widgets.js';
import { ScheduledOpeningStore } from './store.js';
export declare class ScheduledOpeningWidget extends HamLiveElement<ScheduledOpeningStore> {
    private busy;
    static init(store: ScheduledOpeningStore): Promise<void>;
    protected getTemplate(): string;
    protected didMyDataSegmentChange(): boolean;
    protected render(): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
    private showStatus;
    private choose;
}
//# sourceMappingURL=widget.d.ts.map