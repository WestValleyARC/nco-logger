import { StoreSubscriber, ReactiveStore, NewDataReturnType, LiveNetReactiveStore, FavoritesReactiveStore, PropertiesOfInterest, StateGroupKey, ReadonlyStateGroup } from '#@client/lib/stores.js';
import { EndPointResponse, Station, NPID } from '#@client/types/commonTypes.js';
import { SimpleInteractions, SimpleInteractionMethodNames, DefaultStateTypes } from '#@client/types/clientTypes.js';
import { InteractionClient, AdminClient, getIconSvg } from '#@client/lib/clientUtils.js';
export declare class NetworkStatus extends HTMLElement {
    private updateOnlineStatus;
    connectedCallback(): void;
    disconnectedCallback(): void;
    static init(): void;
}
export declare class StatsTable extends HTMLElement {
    constructor();
    private getTemplate;
    static init(): void;
}
declare enum EncapsulationMode {
    Open = "open",
    Closed = "closed"
}
interface DynamicElementConstructorWithInit<T extends ReactiveStore<EndPointResponse>> {
    new (): HamLiveElement<T>;
    init: (store: T) => void;
}
export declare abstract class HamLiveElement<T extends ReactiveStore<EndPointResponse>> extends HTMLElement implements StoreSubscriber {
    protected encapsulate: Readonly<EncapsulationMode>;
    private _store;
    static readonly storeMap: Map<string, ReactiveStore<EndPointResponse>>;
    private _shadowRoot;
    readonly uuid: string;
    protected readonly defaultElementId: string;
    protected defaultElement: HTMLElement | null;
    static sharedStylesPromise: Promise<CSSStyleSheet>;
    constructor(encapsulate?: Readonly<EncapsulationMode>);
    protected set root(node: HTMLElement | ShadowRoot | null);
    protected get root(): HTMLElement | ShadowRoot;
    private setupWidgetRoot;
    private subscribeToStore;
    private unsubscribeFromStore;
    protected set store(store: T | null);
    protected get store(): T | null;
    protected abstract getTemplate(): string;
    protected abstract didMyDataSegmentChange(): boolean;
    protected abstract render(onConnected: boolean): void;
    protected abstract onConnected(): void;
    protected abstract onDisconnected(): void;
    newData(): NewDataReturnType;
    set online(online: boolean);
    get online(): boolean;
    protected removeAllDefaultElementChildren(): void;
    protected appendToDefaultElement(child: HTMLElement | DocumentFragment): void;
    protected replaceAllDefaultElementChildrenWith(child: HTMLElement | DocumentFragment): void;
    protected static initElement<T extends ReactiveStore<EndPointResponse>>(tagName: string, elementClass: DynamicElementConstructorWithInit<T>, store: T): Promise<void>;
    private assignDefaultElement;
    protected applyTemplate(): void;
    connectedCallback(): Promise<void>;
    disconnectedCallback(): void;
}
interface ButtonBarInsert extends HTMLElement {
    toolTipText: string;
}
declare abstract class BaseInsert<T extends ReactiveStore<EndPointResponse>> extends HamLiveElement<T> implements ButtonBarInsert {
    abstract toolTipText: string;
    protected abstract iconColor: string;
    protected abstract getIcon(): ReturnType<typeof getIconSvg>;
    protected abstract toggleState: () => void;
    protected getTemplate(): string;
    protected renderIcon(): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
}
export declare class FavoriteInsert extends BaseInsert<FavoritesReactiveStore> implements ButtonBarInsert {
    toolTipText: string;
    protected iconColor: string;
    private state;
    private _npid;
    private fc;
    protected getIcon(): ReturnType<typeof getIconSvg>;
    protected toggleState: () => void;
    set npid(npid: NPID);
    get npid(): Readonly<NPID> | null;
    private get storeDiffers();
    protected didMyDataSegmentChange(): boolean;
    protected render(): void;
    static init(store: FavoritesReactiveStore): Promise<void>;
}
export declare class AutoScrollInsert extends HTMLElement implements ButtonBarInsert {
    toolTipText: string;
    private iconColor;
    private _shadowRoot;
    constructor();
    private handleIconClick;
    private getTemplate;
    private getIcon;
    private renderIcon;
    connectedCallback(): void;
    disconnectedCallback(): void;
    static init(): void;
}
export declare class FavoritesList extends HamLiveElement<FavoritesReactiveStore> {
    protected getTemplate(): string;
    protected didMyDataSegmentChange(): boolean;
    protected render(onConnected: boolean): void;
    private createFavoriteCard;
    private createEmptyState;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: FavoritesReactiveStore): Promise<void>;
}
type StationIcon = (typeof LiveNetElement.ICONS)[keyof typeof LiveNetElement.ICONS];
export declare abstract class LiveNetElement extends HamLiveElement<LiveNetReactiveStore> implements SimpleInteractions<Promise<DefaultStateTypes>> {
    protected ia: InteractionClient;
    static ICONS: {
        readonly netcontrol: "bi-mic-fill";
        readonly netlogger: "bi-journal-check";
        readonly netuser: "bi-person-check";
        readonly netrelay: "bi-intersect";
        readonly online: "bi-eye-fill";
        readonly default: "";
    };
    protected readonly roleToIcon: {
        readonly netcontrol: "bi-mic-fill";
        readonly netlogger: "bi-journal-check";
        readonly netuser: "bi-person-check";
        readonly netrelay: "bi-intersect";
    };
    protected getStationIcon(station: Station): StationIcon;
    protected stationIsVisible(station: Station): boolean;
    private simpleInteractionWrapper;
    highlight(callSign: string, state?: DefaultStateTypes): Promise<boolean>;
    hand(callSign: string, state?: DefaultStateTypes): Promise<boolean>;
    checkState(callSign: string, state?: DefaultStateTypes): Promise<boolean | null>;
    sigReport(callSign: string, report: string): Promise<void>;
}
export declare abstract class StateGroupReport extends LiveNetElement {
    private isSettingGroup;
    protected abstract getReport(stateGroup: ReadonlyStateGroup): string;
    static get observedAttributes(): string[];
    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void;
    private handleGroupAttributeChange;
    private logInvalidGroupValue;
    set group(value: string);
    get group(): StateGroupKey | null;
    protected getTemplate(): string;
    protected didMyDataSegmentChange(): boolean;
    protected render(onConnected: boolean): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
}
export declare class StateList extends StateGroupReport {
    protected getReport(stateGroup: ReadonlyStateGroup): string;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare class StateCount extends StateGroupReport {
    protected getReport(stateGroup: ReadonlyStateGroup): string;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare class NetNotes extends LiveNetElement {
    private tooltip;
    private bsCollapse;
    private priorNotes;
    private priorTitle;
    constructor();
    protected getTemplate(): string;
    protected didMyDataSegmentChange(): boolean;
    protected render(): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: LiveNetReactiveStore): Promise<void>;
    protected hasDataChanged(key: 'notes' | 'title', priorValue: string, overwritePrior?: boolean): boolean;
    private updateTitle;
    private updateNotes;
}
export declare class NetDetails extends LiveNetElement {
    private priorNetDetails;
    protected getTemplate(): string;
    protected get netInfoHasChanged(): boolean;
    protected didMyDataSegmentChange(): boolean;
    protected render(): void;
    private buildFrequencyAndTimeString;
    private calculateApproximateStartTime;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare class NetStartProgress extends LiveNetElement {
    private defaultIntervalMs;
    private _width;
    private _state;
    private readonly mainLooper;
    constructor();
    private set width(value);
    private get width();
    private set state(value);
    private get state();
    private gracePeriodPercentComplete;
    protected getTemplate(): string;
    private renderBarWidth;
    private renderBarStyle;
    protected didMyDataSegmentChange(): boolean;
    protected render(): void;
    private startMainLooper;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare abstract class NetControlMember extends LiveNetElement {
    protected readonly cmd: AdminClient;
    protected didMyStatusChange(): boolean;
    protected get iAmCheckedInAdmin(): boolean;
}
export declare class NetControlUsage extends NetControlMember {
    protected getTemplate(): string;
    private collapse;
    private toggleExpandCollapse;
    private handleCommandHelpClick;
    protected didMyDataSegmentChange(): boolean;
    protected formatUsage(text: string): string;
    protected render(): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare class NetControlForm extends NetControlMember {
    protected getTemplate(): string;
    protected didMyDataSegmentChange(): boolean;
    protected render(onConnected: boolean): void;
    applyFocus(): void;
    protected respond(response: string, type?: 'error' | 'success'): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare class NetControlPanel extends NetControlMember {
    protected getTemplate(): string;
    open(): void;
    close(): void;
    private get isOpen();
    toggle(): void;
    protected didMyDataSegmentChange(): boolean;
    protected render(onConnected: boolean): void;
    applyFocus(): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare class NetControlButton extends NetControlMember {
    protected netControlPanelElement: NetControlPanel | null;
    private label;
    constructor();
    protected getTemplate(): string;
    protected didMyDataSegmentChange(): boolean;
    protected render(onConnected: boolean): void;
    private handleClick;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare class RoleStats extends LiveNetElement {
    protected getTemplate(): string;
    protected didMyDataSegmentChange(): boolean;
    protected render(): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
type CellContentStyling = {
    icon: StationIcon;
    color: `var(--hl-${Exclude<ReturnType<StationTableMember['getStationColor']>, ''> | 'danger'})`;
    fontStyle: 'italic' | 'normal';
    fontWeight: 'bold' | 'normal';
    textDecoration: 'line-through' | 'none';
    opacity: number;
    visible: boolean;
};
export declare abstract class StationTableMember extends LiveNetElement {
    callSign: string | null;
    static readonly styleCache: Map<"netcontrol-online-null" | "netcontrol-online-false" | "netcontrol-online-true" | "netcontrol-offline-null" | "netcontrol-offline-false" | "netcontrol-offline-true" | "netlogger-online-null" | "netlogger-online-false" | "netlogger-online-true" | "netlogger-offline-null" | "netlogger-offline-false" | "netlogger-offline-true" | "netrelay-online-null" | "netrelay-online-false" | "netrelay-online-true" | "netrelay-offline-null" | "netrelay-offline-false" | "netrelay-offline-true" | "netuser-online-null" | "netuser-online-false" | "netuser-online-true" | "netuser-offline-null" | "netuser-offline-false" | "netuser-offline-true", CellContentStyling>;
    protected set defaultElementCursorisPointer(pointer: boolean);
    private handleClickType;
    protected highlightClick: (e: Event) => void;
    protected handClick: (e: Event) => void;
    protected checkStateClick: (e: Event) => void;
    protected handleClick: (type: SimpleInteractionMethodNames, e: Event) => void;
    protected get iAmStation(): boolean;
    protected get iHaveMorePrivs(): boolean;
    protected getStationColor(station: Station): 'primary' | 'secondary' | 'light' | 'success' | 'tertiary' | 'quaternary' | 'danger';
    stationIsBold(station: Station): boolean;
    getStationOpacity(station: Station): number;
    stationIsItalicized(station: Station): boolean;
    stationIsLinethrough(station: Station): boolean;
    protected getStyling(station: Station): CellContentStyling;
    protected applyStyling(element: HTMLElement, styling: Omit<CellContentStyling, 'icon'>): void;
    protected haveThisStationPropertiesChanged(properties: PropertiesOfInterest[]): boolean;
    protected get station(): Readonly<Station> | null;
    protected get stationPrior(): Readonly<Station> | null;
}
export declare class AvatarCell extends StationTableMember {
    private defaultPhoto;
    private get photoUrl();
    private get isOnline();
    protected getTemplate(): string;
    protected didMyDataSegmentChange(): boolean;
    protected render(): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare class CallSignCell extends StationTableMember {
    protected getTemplate: () => string;
    protected didMyDataSegmentChange(): boolean;
    protected render(): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare class NameCell extends StationTableMember {
    private tooltip;
    protected getTemplate(): string;
    protected didMyDataSegmentChange(): boolean;
    private refreshTooltip;
    protected render(onConnected: boolean): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
    private cleanupTooltip;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare class SigReportCell extends StationTableMember {
    private lastSigReportType;
    private restrictedSigReports;
    protected getTemplate(): string;
    private getInputStyles;
    private haveNetSigReportAttribsChanged;
    private updateVisibility;
    private updateInputPlaceholderValue;
    private indicateInputValueChange;
    private updateInputValue;
    private updateInputState;
    private updateInputBorderStyle;
    private handleInputFocus;
    private handleInputBlur;
    private handleSubmit;
    private getInputElement;
    protected didMyDataSegmentChange(): boolean;
    protected render(): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare class StationRow extends StationTableMember {
    private readonly cellTypes;
    protected getTemplate(): string;
    private createCell;
    protected didMyDataSegmentChange(): boolean;
    protected render(onConnected: boolean): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare class StationTable extends LiveNetElement {
    protected getTemplate(): string;
    private createStationRow;
    protected didMyDataSegmentChange(): boolean;
    protected onConnected(): void;
    protected onDisconnected(): void;
    protected render(onConnected: boolean): void;
    private createDocumentFragmentWithStations;
    private get lastNonCheckedOutAttendee();
    private scrollToLastNonCheckedOutAttendee;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare class ButtonBar extends LiveNetElement {
    private tooltipInstances;
    constructor();
    protected wrapWithButton(element: ButtonBarInsert): HTMLButtonElement;
    protected getTemplate(): string;
    protected didMyDataSegmentChange(): boolean;
    protected render(onConnected: boolean): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export declare class HandInsert extends LiveNetElement implements ButtonBarInsert {
    toolTipText: string;
    protected getTemplate(): string;
    protected didMyDataSegmentChange(): boolean;
    protected getIcon(): string;
    private toggleState;
    private isCallSignDefined;
    private updateHandState;
    protected render(): void;
    protected onConnected(): void;
    protected onDisconnected(): void;
    static init(store: LiveNetReactiveStore): Promise<void>;
}
export {};
//# sourceMappingURL=widgets.d.ts.map