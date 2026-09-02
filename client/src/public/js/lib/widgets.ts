/* hamlive-oss — MIT License. See LICENSE. */

/* eslint-disable @typescript-eslint/require-await */
import {
    StoreSubscriber,
    ReactiveStore,
    NewDataReturnType,
    LiveNetReactiveStore,
    FavoritesReactiveStore,
    PropertiesOfInterest,
    isStateGroupKey,
    StateGroupKey,
    ReadonlyStateGroup
} from '#@client/lib/stores.js';
import {
    EndPointResponse,
    Station,
    NetInfo,
    FollowListNetInfo,
    NPID,
    RstReportBase,
    StrengthTone,
} from '#@client/types/commonTypes.js';
import {
    isEndPointResponseError,
    isNpid,
    isRstReportBase,
    isRstReportBaseWithTone,
} from '#@client/types/commonTypesupport.js';
import { SimpleInteractions, SimpleInteractionMethodNames, DefaultStateTypes } from '#@client/types/clientTypes.js';
import {
    generateUUID,
    InteractionClient,
    AdminClient,
    FavoriteClient,
    UserAgentPersistentPreferences,
    getIconSvg,
    Looper,
    schedule,
    SchedulingMethod,
    getNpid,
} from '#@client/lib/clientUtils.js';



import { createLogger } from '#@client/lib/logger.js';
import type * as bootstrap from 'bootstrap';
import { serverInfo } from '#@client/lib/serverInfo.js';

const logger = createLogger('lib/widgets.ts');
const prefs = new UserAgentPersistentPreferences();

//Static Widgets:
export class NetworkStatus extends HTMLElement {
    private updateOnlineStatus = (): void => {
        document.body.classList.toggle('offline', !navigator.onLine);
    };

    connectedCallback(): void {
        this.updateOnlineStatus();
        window.addEventListener('online', this.updateOnlineStatus);
        window.addEventListener('offline', this.updateOnlineStatus);
    }

    disconnectedCallback(): void {
        window.removeEventListener('online', this.updateOnlineStatus);
        window.removeEventListener('offline', this.updateOnlineStatus);
    }

    static init(): void {
        customElements.define('hl-network-status', NetworkStatus);
    }
}

export class StatsTable extends HTMLElement {
    constructor() {
        super();
        try {
            const shadowRoot = this.attachShadow({ mode: 'closed' });
            shadowRoot.innerHTML = this.getTemplate();
        } catch (error) {
            logger.error('Failed to attach shadow root:', error);
        }
    }

    private getTemplate(): string {
        return /*html*/ `
            <style>
            :host {
                --hl-primary-dark: #9e5f26; /* Darkened by 10% */
                --hl-secondary-dark: #4f868b; /* Darkened by 10% */
                --hl-tertiary-dark: #754f8f; /* Darkened by 10% */
                --hl-success-dark: #2b922b; /* Darkened by 10% */
            }
            .stats-container {
                border-radius: 8px;
                border: 1px solid rgba(163, 118, 195, 0.2);
                padding: 8px;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                border-radius: 25px/8px; /* Apply elliptical border-radius to the table */
                overflow: hidden; /* Ensure rounded corners are visible */
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); /* Add a subtle shadow */
            }
            .label-cell {
                border-radius: 25px/8px;
            }
            td {
                white-space: nowrap;
                max-height: 2rem;
                font-size: 1rem;
                padding: 0.5rem;
                vertical-align: middle; 
            }
            .bg-secondary {
                background: radial-gradient(circle at top left, rgba(79, 134, 139, 0.6), rgba(110, 184, 192, 0.4));
            }
            .bg-tertiary {
                background: radial-gradient(circle at top left, rgba(117, 79, 143, 0.6), rgba(163, 118, 195, 0.4));
            }
            .bg-success {
                background: radial-gradient(circle at top left, rgba(43, 146, 43, 0.6), rgba(60, 206, 60, 0.4));
            }
            .bg-primary {
                background: radial-gradient(circle at top left, rgba(158, 95, 38, 0.6), rgba(220, 131, 53, 0.4));
            }
            .text-secondary {
                color: var(--hl-secondary-dark);
            }
            .text-tertiary {
                color: var(--hl-tertiary-dark);
            }
            .text-success {
                color: var(--hl-success-dark);
            }
            .text-primary {
                color: var(--hl-primary-dark);
            }
            .icon {
                margin-right: 0.5rem;
                vertical-align: middle; /* Align icons vertically with text */
            }
            </style>
            <div class="stats-container">
                <table>
                <tr>
                    <td class="bg-secondary label-cell">                        
                    <span class="opaque">${getIconSvg('bi-mic-fill')} NCS<span>
                    </td>
                    <td class="text-secondary">
                    <em>
                        <slot name="ncs"></slot>
                    </em>
                    </td>
                </tr>
                <tr>
                    <td class="bg-tertiary label-cell">                    
                    ${getIconSvg('bi-journal-check')} Logger:
                    </td>
                    <td class="text-tertiary">
                    <em>
                        <slot name="loggers"></slot>
                    </em>
                    </td>
                </tr>
                <tr>
                    <td class="bg-success label-cell">
                    ${getIconSvg('bi-intersect')} Relays:
                    </td>
                    <td class="text-success">
                    <em>
                        <slot name="relays"></slot>
                    </em>
                    </td>
                </tr>
                <tr>
                    <td class="bg-primary label-cell">                        
                    ${getIconSvg('bi-person-check')} Count:
                    </td>
                    <td class="text-primary">
                    <em>
                        <slot name="count"></slot>
                    </em>
                    </td>
                </tr>
                </table>
            </div>
        `;
    }

    static init(): void {
        customElements.define('hl-stats-table', StatsTable);
    }
}

//Reactive Widgets:
enum EncapsulationMode {
    Open = 'open',
    Closed = 'closed'
}

interface DynamicElementConstructorWithInit<T extends ReactiveStore<EndPointResponse>> {
    new (): HamLiveElement<T>;
    init: (store: T) => void;
}

export abstract class HamLiveElement<T extends ReactiveStore<EndPointResponse>>
    extends HTMLElement
    implements StoreSubscriber
{
    private _store: T | null = null;
    static readonly storeMap: Map<string, ReactiveStore<EndPointResponse>> = new Map();
    private _shadowRoot: ShadowRoot | null = null;
    public readonly uuid: string = generateUUID();
    protected readonly defaultElementId: string = `default-${this.uuid}`;
    protected defaultElement: HTMLElement | null = null;

    static sharedStylesPromise: Promise<CSSStyleSheet> = (async () => {
        let sheet: CSSStyleSheet | null = null;

        try {
            sheet = new CSSStyleSheet();
        } catch (err) {
            window.alert('Your browser does not support CSSStyleSheet(). Please use a modern browser.');

            if (err instanceof Error) {
                logger.error(`Error creating new CSSStyleSheet: ${err.message}`);
            }
        }

        if (sheet) {
            try {
                const response = await fetch('/css/widgets.css');
                if (!response.ok) {
                    throw new Error(`Failed to fetch CSS: ${response.statusText}`);
                }
                const cssText = await response.text();
                await sheet.replace(cssText);
            } catch (error) {
                if (error instanceof Error) {
                    logger.error(`Error importing shared styles: ${error.message}`);
                } else if (typeof error === 'string') {
                    logger.error(`Error importing shared styles: ${error}`);
                }
            }
        }

        if (!sheet) {
            throw new Error('CSSStyleSheet could not be created.');
        }

        return sheet;
    })();

    constructor(protected encapsulate: Readonly<EncapsulationMode> = EncapsulationMode.Closed) {
        super();
    }

    protected set root(node: HTMLElement | ShadowRoot | null) {
        if (this.encapsulate === EncapsulationMode.Closed) {
            this._shadowRoot = node instanceof ShadowRoot ? node : null;
        } else {
            this._shadowRoot = null;
        }
    }

    protected get root(): HTMLElement | ShadowRoot {
        return this.encapsulate !== EncapsulationMode.Open ? this._shadowRoot! : this;
    }

    private async setupWidgetRoot(): Promise<void> {
        if (this.encapsulate === EncapsulationMode.Closed) {
            this.root = this.attachShadow({ mode: 'closed' });
            this.root.adoptedStyleSheets = [await HamLiveElement.sharedStylesPromise];
        } else {
            logger.warn(`${this.constructor.name} using light DOM`);
            this.root = this;
        }
    }

    private subscribeToStore(store: T): void {
        // logger.debug(`${this.constructor.name} subscribing to ${store.constructor.name}`);
        store.subscribe(this);
        this._store = store;
    }

    private unsubscribeFromStore(): void {
        if (this._store) {
            // logger.debug(`${this.constructor.name} unsubscribing from ${this._store.constructor.name}`);
            this._store.unsubscribe(this);
            this._store = null;
        } else {
            logger.warn('Store is already null, cannot unsubscribe');
        }
    }

    protected set store(store: T | null) {
        if (store) {
            this.subscribeToStore(store);
        } else {
            this.unsubscribeFromStore();
        }
    }

    protected get store(): T | null {
        return this._store;
    }

    //Widgets must implement:
    protected abstract getTemplate(): string;
    protected abstract didMyDataSegmentChange(): boolean;
    protected abstract render(onConnected: boolean): void;
    protected abstract onConnected(): void;
    protected abstract onDisconnected(): void;

    public async newData(): NewDataReturnType {
        if (this.store?.mainCache) {
            if (this.didMyDataSegmentChange()) {
                logger.info(`My segment of the store changed in ${this.constructor.name} widget`);
                return this.render(false);
            }
        } else {
            throw new Error('Store is not defined in widget, newData()');
        }
    }

    public set online(online: boolean) {
        if (this.defaultElement) {
            if (!online) {
                this.defaultElement.classList.add('offline');
                logger.debug(`${this.constructor.name} is offline`);
            } else {
                this.defaultElement.classList.remove('offline');
                logger.debug(`${this.constructor.name} is online`);
            }
        }
    }

    public get online(): boolean {
        return !this.classList.contains('offline');
    }

    protected removeAllDefaultElementChildren(): void {
        if (!this.defaultElement) {
            logger.warn('Default element is not defined in widget, removeAllDefaultElementChildren()');
            return;
        }

        while (this.defaultElement.firstChild) {
            this.defaultElement.removeChild(this.defaultElement.firstChild);
        }
    }

    protected appendToDefaultElement(child: HTMLElement | DocumentFragment): void {
        if (!this.defaultElement) {
            logger.warn('Default element is not defined in widget, appendToDefaultElement()');
            return;
        }

        this.defaultElement.appendChild(child);
    }

    protected replaceAllDefaultElementChildrenWith(child: HTMLElement | DocumentFragment): void {
        this.removeAllDefaultElementChildren();
        this.appendToDefaultElement(child);
    }

    protected static async initElement<T extends ReactiveStore<EndPointResponse>>(
        tagName: string,
        elementClass: DynamicElementConstructorWithInit<T>,
        store: T
    ): Promise<void> {
        const prefixedTagName = `hl-${tagName}` as const;

        HamLiveElement.storeMap.set(prefixedTagName.toLowerCase(), store);

        window.customElements.define(prefixedTagName, elementClass);
        await customElements.whenDefined(prefixedTagName);

        // logger.debug(`${elementClass.name} element initialized successfully`);
    }

    private assignDefaultElement(): void {
        this.defaultElement = this.defaultElement || this.root.querySelector(`#${this.defaultElementId}`);
    }

    protected applyTemplate(): void {
        const template = document.createElement('template');
        template.innerHTML = this.getTemplate();

        if (template.content.querySelector(this.tagName.toLowerCase())) {
            throw new Error(
                `Recursive template detected in ${this.tagName}. A custom element should not contain its own tag in its template.`
            );
        }

        // Clear any existing children of this.root
        this.root.innerHTML = '';

        this.root.append(template.content.cloneNode(true));
    }

    public async connectedCallback(): Promise<void> {
        // store setup:
        const store = HamLiveElement.storeMap.get(this.tagName.toLowerCase());
        if (!store) {
            throw new Error(`Store not assigned to ${this.tagName}`);
        }
        if (!(store instanceof ReactiveStore)) {
            throw new Error(`Store for ${this.tagName} is not an instance of ReactiveStore`);
        }

        // root setup:
        await this.setupWidgetRoot();
        this.applyTemplate(); // populate root with per-component template
        this.assignDefaultElement();

        // callback hook for subclasses:
        this.onConnected();

        //subscribe to store
        this.store = store as T;

        // render: We call render to handle cases where a widget is destroyed and recreated,
        // but no new data is necessarily available. This is less about the initial render
        // on the initial page load and more about the render that occurs when a widget is
        // reconnected to the DOM after being disconnected.
        this.render(true);
    }

    public disconnectedCallback(): void {
        logger.debug(`${this.constructor.name} disconnected from the DOM`);
        this.store = null;
        this.onDisconnected();
    }
}

interface ButtonBarInsert extends HTMLElement {
    toolTipText: string;
}

abstract class BaseInsert<T extends ReactiveStore<EndPointResponse>>
    extends HamLiveElement<T>
    implements ButtonBarInsert
{
    public abstract toolTipText: string;
    protected abstract iconColor: string;
    protected abstract getIcon(): ReturnType<typeof getIconSvg>;
    protected abstract toggleState: () => void;

    protected getTemplate(): string {
        return /*html*/ `
        <style>
            /* Add your component styles here */
            #${this.defaultElementId} svg {
                color: ${this.iconColor};
            }
        </style>
        <span id="${this.defaultElementId}">
            ${this.getIcon()}
        </span>
    `;
    }

    protected renderIcon(): void {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, renderIcon()`);
            return;
        }

        this.defaultElement.innerHTML = this.getIcon();
    }

    protected onConnected(): void {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, onConnected()`);
            return;
        }
        this.renderIcon();
        this.addEventListener('click', this.toggleState);
    }

    protected onDisconnected(): void {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, onDisconnected()`);
            return;
        }
        this.removeEventListener('click', this.toggleState);
    }
}

export class FavoriteInsert extends BaseInsert<FavoritesReactiveStore> implements ButtonBarInsert {
    public toolTipText = 'Click to Follow/Unfollow';
    protected iconColor = 'var(--hl-tertiary)';
    private state = false;
    private _npid: NPID | null = null;
    private fc = new FavoriteClient();

    protected getIcon(): ReturnType<typeof getIconSvg> {
        return getIconSvg(this.state ? 'bi-heart-fill' : 'bi-heart');
    }

    protected override renderIcon(): void {
        super.renderIcon();
        const label = this.state ? 'Remove from Favorites' : 'Add to Favorites';
        this.setAttribute('aria-label', label);
        this.title = label;
    }

    protected toggleState = (): void => {
        this.store?.delayServerDataIngest();
        this.state = !this.state;
        this.renderIcon();
        if (this.npid) this.fc.set(this.npid, this.state);
    };

    public set npid(npid: NPID) {
        if (!isNpid(npid)) {
            throw new Error('Invalid NPID in Favorite widget, set npid()');
        }
        this._npid = npid;
    }

    public get npid(): Readonly<NPID> | null {
        return this._npid;
    }

    private get storeDiffers(): boolean {
        if (!this.store?.ready) {
            logger.warn(`Store is not *yet ready in ${this.constructor.name}, storeDiffers()`);
            return false;
        }
        return this.npid ? this.store?.state(this.npid) !== this.state : false;
    }

    protected didMyDataSegmentChange(): boolean {
        return this.storeDiffers;
    }

    protected render(): void {
        if (this.store?.ready && this.storeDiffers) {
            this.state = !this.state;
        }
        this.renderIcon();
    }

    public static async init(store: FavoritesReactiveStore): Promise<void> {
        await this.initElement('fav-insert', FavoriteInsert, store);
    }
}

export class AutoScrollInsert extends HTMLElement implements ButtonBarInsert {
    public toolTipText = 'Toggle Autoscroll';
    private iconColor = 'var(--hl-secondary)';
    private _shadowRoot: ShadowRoot | null = null;

    constructor() {
        super();
        try {
            this._shadowRoot = this.attachShadow({ mode: 'closed' });
            this._shadowRoot.innerHTML = this.getTemplate();
        } catch (error) {
            logger.error('Failed to attach shadow root:', error);
        }
    }

    private handleIconClick = (): void => {
        prefs.autoScrollStationTable = !prefs.autoScrollStationTable;
        this.renderIcon();
    };

    private getTemplate(): string {
        return /*html*/ `
            <style>
                svg {
                    color: ${this.iconColor};
                }
            </style>
            ${this.getIcon()}
        `;
    }

    private getIcon(): ReturnType<typeof getIconSvg> {
        return prefs.autoScrollStationTable ? getIconSvg('bi-chevron-double-down') : getIconSvg('bi-chevron-contract');
    }

    private renderIcon(): void {
        if (!this._shadowRoot) {
            logger.warn(`Shadow root is not defined in ${this.constructor.name}, renderIcon()`);
            return;
        }
        this._shadowRoot.innerHTML = this.getTemplate();
    }

    connectedCallback(): void {
        this.addEventListener('click', this.handleIconClick);
    }

    disconnectedCallback(): void {
        this.removeEventListener('click', this.handleIconClick);
    }

    static init(): void {
        customElements.define('hl-autoscroll-insert', AutoScrollInsert);
    }
}


export class FavoritesList extends HamLiveElement<FavoritesReactiveStore> {
    protected getTemplate(): string {
        return /*html*/ `
        <style>
            :host {
                --favorite-text: var(--app-text, #f4f5f2);
                --favorite-muted: var(--app-muted, #9ba9b2);
                --favorite-subtle: var(--app-subtle-text, #bdc8cc);
                --favorite-faint: var(--app-faint, #84949b);
                --favorite-link: var(--app-status-accent, #00c8f0);
                --favorite-card-border: var(--app-card-border, rgba(155, 169, 178, 0.48));
                --favorite-divider: var(--app-divider, rgba(155, 169, 178, 0.32));
                --favorite-divider-soft: var(--app-divider-soft, rgba(155, 169, 178, 0.16));
                --favorite-card-bg: var(--app-panel-background, linear-gradient(150deg, rgba(11, 29, 41, 0.92), rgba(5, 15, 23, 0.98)));
                --favorite-card-shadow: var(--app-panel-shadow, 0 1.5rem 3rem rgba(0, 0, 0, 0.18));
                --favorite-status-bg: var(--app-status-bg, rgba(26, 39, 48, 0.34));
                --favorite-hover-border: var(--app-interactive-border, rgba(0, 200, 240, 0.58));
                --favorite-hover-outline: var(--app-interactive-outline, rgba(0, 200, 240, 0.16));
            }
            #${this.defaultElementId} {
                color: var(--favorite-text);
            }
            #${this.defaultElementId} .favorites-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
                gap: 1rem;
            }
            #${this.defaultElementId} .favorite-card {
                position: relative;
                display: flex;
                min-height: 7.25rem;
                flex-direction: column;
                padding: 0.9rem 1rem;
                border: 1px solid var(--favorite-card-border);
                border-radius: 0.75rem;
                background: var(--favorite-card-bg);
                box-shadow: var(--favorite-card-shadow);
                cursor: pointer;
                transition: border-color 140ms ease, outline-color 140ms ease, transform 140ms ease;
            }
            #${this.defaultElementId} .favorite-card:hover,
            #${this.defaultElementId} .favorite-card:focus-within {
                border-color: var(--favorite-hover-border);
                outline: 1px solid var(--favorite-hover-outline);
                transform: translateY(-1px);
            }
            #${this.defaultElementId} .favorite-card-heading {
                display: flex;
                gap: 0.8rem;
                align-items: center;
                justify-content: space-between;
                padding-bottom: 0.65rem;
                border-bottom: 1px solid var(--favorite-divider);
            }
            #${this.defaultElementId} .favorite-title {
                color: var(--favorite-text);
                font-size: 1.05rem;
                font-weight: 700;
                line-height: 1.25;
                text-decoration: none;
            }
            #${this.defaultElementId} .favorite-title::after {
                position: absolute;
                z-index: 1;
                inset: 0;
                border-radius: 0.75rem;
                content: '';
            }
            #${this.defaultElementId} .favorite-title:focus-visible {
                outline: none;
            }
            #${this.defaultElementId} .favorite-actions {
                position: relative;
                z-index: 2;
                display: inline-flex;
                gap: 0.55rem;
                align-items: center;
                flex: 0 0 auto;
            }
            #${this.defaultElementId} hl-fav-insert {
                --hl-tertiary: #ff8500;
                display: inline-grid;
                width: 1.9rem;
                height: 1.9rem;
                place-items: center;
                border-radius: 50%;
                cursor: pointer;
            }
            #${this.defaultElementId} hl-fav-insert:hover,
            #${this.defaultElementId} hl-fav-insert:focus-visible {
                background: rgba(255, 133, 0, 0.1);
                outline: 1px solid rgba(255, 133, 0, 0.55);
            }
            #${this.defaultElementId} .favorite-status {
                padding: 0.28rem 0.48rem;
                color: var(--favorite-faint);
                border: 1px solid rgba(155, 169, 178, 0.18);
                border-radius: 0.35rem;
                background: var(--favorite-status-bg);
                font-size: 0.7rem;
                font-weight: 700;
                white-space: nowrap;
            }
            #${this.defaultElementId} .favorite-status.is-live {
                color: #eaffef;
                border-color: rgba(67, 209, 122, 0.5);
                background: rgba(32, 128, 66, 0.72);
            }
            #${this.defaultElementId} .favorite-status.is-preparing {
                color: var(--favorite-link);
                border-color: rgba(0, 200, 240, 0.35);
                background: rgba(0, 200, 240, 0.1);
            }
            #${this.defaultElementId} .favorite-details {
                display: grid;
                gap: 0.25rem;
                padding-top: 0.65rem;
            }
            #${this.defaultElementId} .favorite-connection {
                margin: 0;
                color: var(--favorite-text);
                font-size: 0.95rem;
            }
            #${this.defaultElementId} .favorite-mode-details {
                margin: 0;
                color: var(--favorite-muted);
                font-size: 0.83rem;
            }
            #${this.defaultElementId} .favorite-followers {
                margin: 0.3rem 0 0;
                color: var(--favorite-subtle);
                font-size: 0.78rem;
            }
            #${this.defaultElementId} .favorite-schedule {
                display: grid;
                gap: 0.18rem;
                margin-top: 0.35rem;
                padding-top: 0.45rem;
                border-top: 1px solid var(--favorite-divider-soft);
                color: var(--favorite-subtle);
                font-size: 0.8rem;
            }
            #${this.defaultElementId} .favorite-schedule strong {
                color: var(--favorite-link);
                font-size: 0.67rem;
                letter-spacing: 0.07em;
                text-transform: uppercase;
            }
            #${this.defaultElementId} .favorite-schedule small {
                color: var(--favorite-faint);
                font-size: 0.7rem;
            }
            #${this.defaultElementId} .favorites-empty {
                display: grid;
                min-height: 18rem;
                place-content: center;
                justify-items: center;
                padding: 2rem;
                border: 1px solid var(--favorite-card-border);
                border-radius: 0.75rem;
                background: var(--favorite-card-bg);
                box-shadow: var(--favorite-card-shadow);
                text-align: center;
            }
            #${this.defaultElementId} .favorites-empty h2 {
                margin: 0 0 0.65rem;
                color: var(--favorite-text);
                font-size: 1.35rem;
            }
            #${this.defaultElementId} .favorites-empty p {
                max-width: 30rem;
                margin: 0 0 1.25rem;
                color: var(--favorite-muted);
                line-height: 1.55;
            }
            #${this.defaultElementId} .favorites-empty a {
                position: relative;
                z-index: 1;
                padding: 0.65rem 1rem;
                color: #07111a;
                border-radius: 0.45rem;
                background: linear-gradient(135deg, #ff971d, #ed6e00);
                font-weight: 700;
                text-decoration: none;
            }
            @media (max-width: 575.98px) {
                #${this.defaultElementId} .favorite-card-heading {
                    align-items: flex-start;
                }
            }
        </style>
        <div id="${this.defaultElementId}"></div>
    `;
    }

    protected didMyDataSegmentChange(): boolean {
        return this.store?.favoritesListChanged ?? false;
    }

    protected render(onConnected: boolean): void {
        if (onConnected) {
            return;
        }

        logger.debug('FavoritesList widget: render()');
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, render()`);
            return;
        }

        const { netlist } = this.store?.mainCache?.message ?? { netlist: [] };

        if (netlist && netlist.length === 0) {
            this.defaultElement.replaceChildren(this.createEmptyState());
            return;
        }

        const fragment = document.createDocumentFragment();
        const grid = document.createElement('div');
        grid.classList.add('favorites-grid');
        netlist.forEach(net => grid.appendChild(this.createFavoriteCard(net)));
        fragment.appendChild(grid);

        this.replaceAllDefaultElementChildrenWith(fragment);
    }

    private createFavoriteCard(net: FollowListNetInfo): HTMLElement {
        const { id, title, frequency, mode, modeDetails, followCount } = net;
        const isLive = net.scheduling?.onAir === true;
        const isPreparing = net.scheduling?.preparing === true;
        const card = document.createElement('article');
        card.classList.add('favorite-card');

        const heading = document.createElement('header');
        heading.classList.add('favorite-card-heading');

        const titleLink = document.createElement('a');
        titleLink.classList.add('favorite-title');
        titleLink.href = `/views/livenet/${id}`;
        titleLink.textContent = title;

        const actions = document.createElement('div');
        actions.classList.add('favorite-actions');

        const status = document.createElement('span');
        status.classList.add('favorite-status');
        if (isLive) status.classList.add('is-live');
        if (isPreparing) status.classList.add('is-preparing');
        status.textContent = isLive ? 'ON AIR' : isPreparing ? 'Preparing' : 'OFF AIR';

        const fav = document.createElement('hl-fav-insert') as FavoriteInsert;
        fav.npid = id;
        fav.title = `Remove ${title} from favorites`;
        fav.setAttribute('aria-label', `Remove ${title} from favorites`);
        actions.append(status, fav);
        heading.append(titleLink, actions);

        const details = document.createElement('div');
        details.classList.add('favorite-details');
        const connection = [frequency, mode].filter(Boolean).join(' · ');
        if (connection) {
            const connectionElement = document.createElement('p');
            connectionElement.classList.add('favorite-connection');
            connectionElement.textContent = connection;
            details.appendChild(connectionElement);
        }
        if (modeDetails) {
            const modeDetailsElement = document.createElement('p');
            modeDetailsElement.classList.add('favorite-mode-details');
            modeDetailsElement.textContent = modeDetails;
            details.appendChild(modeDetailsElement);
        }

        const followers = document.createElement('p');
        followers.classList.add('favorite-followers');
        followers.textContent = `${followCount} ${followCount === 1 ? 'Follower' : 'Followers'}`;

        details.appendChild(followers);
        if (!isLive && net.scheduling?.nextOccurrence) {
            const schedule = document.createElement('div');
            schedule.classList.add('favorite-schedule');
            const label = document.createElement('strong');
            label.textContent = isPreparing ? 'Starts Soon' : 'Next Net';
            const next = document.createElement('span');
            next.textContent = new Intl.DateTimeFormat([], {
                weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            }).format(new Date(net.scheduling.nextOccurrence.startAt));
            schedule.append(label, next);
            if (net.scheduling.timezone) {
                const timezone = document.createElement('small');
                timezone.textContent = `Schedule: ${net.scheduling.timezone}`;
                schedule.appendChild(timezone);
            }
            details.appendChild(schedule);
        }
        card.append(heading, details);
        return card;
    }

    private createEmptyState(): HTMLElement {
        const empty = document.createElement('section');
        empty.classList.add('favorites-empty');
        const heading = document.createElement('h2');
        heading.textContent = 'No Favorite Nets Yet';
        const copy = document.createElement('p');
        copy.textContent = 'Favorite nets from the Live Nets page to keep them handy here.';
        const action = document.createElement('a');
        action.href = '/views/dashboard#live-nets';
        action.textContent = 'Browse Live Nets';
        empty.append(heading, copy, action);
        return empty;
    }

    protected onConnected(): void {}
    protected onDisconnected(): void {}

    public static async init(store: FavoritesReactiveStore): Promise<void> {
        await this.initElement('favlist', FavoritesList, store);
    }
}

type StationIcon = (typeof LiveNetElement.ICONS)[keyof typeof LiveNetElement.ICONS];

export abstract class LiveNetElement
    extends HamLiveElement<LiveNetReactiveStore>
    implements SimpleInteractions<Promise<DefaultStateTypes>>
{
    protected ia = new InteractionClient();

    static ICONS = {
        netcontrol: 'bi-mic-fill',
        netlogger: 'bi-journal-check',
        netuser: 'bi-person-check',
        netrelay: 'bi-intersect',
        online: 'bi-eye-fill',
        default: '' // this effects the visibility of the station, see stationIsVisible() below
    } as const;

    protected readonly roleToIcon = {
        netcontrol: LiveNetElement.ICONS.netcontrol,
        netlogger: LiveNetElement.ICONS.netlogger,
        netuser: LiveNetElement.ICONS.netuser,
        netrelay: LiveNetElement.ICONS.netrelay
    } as const;

    protected getStationIcon(station: Station): StationIcon {
        const { role, checkedState, presence } = station;
        if (checkedState === true) {
            return this.roleToIcon[role] || LiveNetElement.ICONS.default;
        } else if (checkedState === null) {
            return presence === 'online' ? LiveNetElement.ICONS.online : LiveNetElement.ICONS.default;
        } else {
            return LiveNetElement.ICONS.default;
        }
    }

    protected stationIsVisible(station: Station): boolean {
        return Boolean(this.getStationIcon(station));
    }

    private async simpleInteractionWrapper(
        action: SimpleInteractionMethodNames,
        callSign: string,
        state?: DefaultStateTypes
    ): Promise<DefaultStateTypes> {
        if (!this.store) {
            throw new Error(`Store is not ready in widget, ${action}`);
        }

        const ret = this.store[action](callSign, state);

        if (typeof state === 'undefined' || ret === null) {
            return ret;
        }

        try {
            await this.ia[action](callSign, ret);
            logger.debug(`${action} updated for ${callSign} in ${this.constructor.name} widget`);
        } catch (error) {
            if (error instanceof Error) {
                logger.error(
                    `Error updating ${action} for ${callSign} in ${this.constructor.name} widget: ${error.message}`
                );
            }
            logger.info(`Reverting ${action} for ${callSign} in ${this.constructor.name} widget`);
            this.store[action](callSign, null);
        }

        return ret;
    }

    public async highlight(callSign: string, state?: DefaultStateTypes): Promise<boolean> {
        return (await this.simpleInteractionWrapper('highlight', callSign, state)) ?? false;
    }

    public async hand(callSign: string, state?: DefaultStateTypes): Promise<boolean> {
        return (await this.simpleInteractionWrapper('hand', callSign, state)) ?? false;
    }

    public async checkState(callSign: string, state?: DefaultStateTypes): Promise<boolean | null> {
        return this.simpleInteractionWrapper('checkState', callSign, state);
    }

    public async sigReport(callSign: string, report: string): Promise<void> {
        const rStr = report.trim()[0];
        const sStr = report.trim()[1];
        const tStr = report.trim()[2];

        if (!rStr || !sStr) {
            throw new Error('Invalid RST values');
        }

        const r = parseInt(rStr);
        const s = parseInt(sStr);
        const t = tStr ? parseInt(tStr) : undefined;

        const rstReport = { r, s, t };

        if (!isRstReportBase(rstReport) && !isRstReportBaseWithTone(rstReport)) {
            throw new Error(`Invalid RST report: ${JSON.stringify(rstReport)} in ${this.constructor.name}`);
        }

        await this.ia.sigReport(callSign, rstReport as RstReportBase | (RstReportBase & { t: StrengthTone }));
    }
}

// To-Do: Implement StateList and StateCount classes that extend StateGroupReport:
// Eventually StateGroupReport will be an abstract class. SateList and StateCount (to-be-developed) will extend this class.
// This class will expect the subclass to implment a getReport() method that will return text.
// That text will be inserted into the defaultElement.
export abstract class StateGroupReport extends LiveNetElement {
    // The `isSettingGroup` flag is used to prevent a recursive loop that occurs when setting the `group` attribute.
    // Without this flag, setting the `group` attribute within the `set group` method triggers the `attributeChangedCallback`,
    // which in turn calls the `handleGroupAttributeChange` method. This method sets the `group` attribute again, causing
    // the `attributeChangedCallback` to be called repeatedly, leading to a "Maximum call stack size exceeded" error.
    // By using the `isSettingGroup` flag, we can prevent this recursive loop. The flag is set to `true` before setting
    // the attribute and reset to `false` afterward. If the flag is already `true`, the `set group` method returns immediately,
    // avoiding the recursive call.
    private isSettingGroup = false;

    protected abstract getReport(stateGroup: ReadonlyStateGroup): string;

    static get observedAttributes(): string[] {
        return ['group'];
    }

    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
        if (name === 'group' && newValue) {
            this.handleGroupAttributeChange(newValue);
        }
    }

    private handleGroupAttributeChange(newValue: string): void {
        if (isStateGroupKey(newValue)) {
            this.group = newValue;
        } else {
            this.logInvalidGroupValue(newValue);
        }
    }

    private logInvalidGroupValue(value: string): void {
        logger.warn(`Invalid group attribute value: ${value} in ${this.constructor.name}`);
    }

    set group(value: string) {
        if (this.isSettingGroup) return;

        if (isStateGroupKey(value)) {
            this.isSettingGroup = true;
            this.setAttribute('group', value);
            this.isSettingGroup = false;
        } else {
            this.logInvalidGroupValue(value);
        }
    }

    get group(): StateGroupKey | null {
        return this.getAttribute('group') as StateGroupKey | null;
    }

    protected getTemplate(): string {
        return /*html*/ `
        <style>
        </style>
        <span id="${this.defaultElementId}"></span>
    `;
    }

    protected didMyDataSegmentChange(): boolean {
        return Boolean(this.group && this.store?.stations.getGroup(this.group)?.newData);
    }

    protected render(onConnected: boolean): void {
        if (onConnected) {
            return;
        }

        if (!this.defaultElement) {
            logger.warn('Default element is not defined in render()');
            return;
        }

        if (!this.group) {
            logger.warn(`Missing group attribute on ${this.constructor.name}`);
            return;
        }

        const callSigns = this.store?.stations.getGroup(this.group);

        if (!callSigns) {
            logger.debug(`No call signs found for group ${this.group}`);
            return;
        }

        this.defaultElement.textContent = this.getReport(callSigns);
        // this.defaultElement.textContent = Array.from(callSigns).join(', ');
    }

    protected onConnected(): void {
        // Implement logic to run when the element is connected to the DOM
    }

    protected onDisconnected(): void {
        // Implement logic to run when the element is disconnected from the DOM
    }

    // public static async init(store: LiveNetReactiveStore): Promise<void> {
    //     await this.initElement('stategroup-report', StateGroupReport, store);
    // }
}

export class StateList extends StateGroupReport {
    protected getReport(stateGroup: ReadonlyStateGroup): string {
        return Array.from(stateGroup).join(', ');
    }

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('state-list', StateList, store);
    }
}

export class StateCount extends StateGroupReport {
    protected getReport(stateGroup: ReadonlyStateGroup): string {
        return stateGroup.size.toString();
    }

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('state-count', StateCount, store);
    }
}

export class NetNotes extends LiveNetElement {
    private tooltip: bootstrap.Tooltip | null = null;
    private bsCollapse: bootstrap.Collapse | null = null;
    private priorNotes: string = '';
    private priorTitle: string = '';

    constructor() {
        super(EncapsulationMode.Open);
    }

    protected getTemplate(): string {
        return /*html*/ `
        <style>
            /* Be careful here, this is in the light dom */
        </style>
        <div id="${this.defaultElementId}" class="hasToolTip" data-bs-toggle="tooltip" data-bs-placement="top" title="Click For Net Details">
            <div class="accordion accordion-flush" id="notes-accordion">
                <div class="accordion-item">
                    <h2 class="accordion-header">
                    <button class="accordion-button collapsed p-1" type="button" data-bs-toggle="collapse" data-bs-target="#accordion-container">
                        <h3 class="text-light p-2 fst-italic" id="accordion-title" aria-hidden="true"></h3>
                    </button>
                    </h2>
                    <div id="accordion-container" class="accordion-collapse collapse" data-bs-parent="#notes-accordion">
                        <div class="accordion-body font-monospace">
                            <code id="notes-content" class="text-tertiary"></code>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    }

    protected didMyDataSegmentChange(): boolean {
        return this.hasDataChanged('notes', this.priorNotes) || this.hasDataChanged('title', this.priorTitle);
    }

    protected render(): void {
        if (!this.defaultElement) {
            logger.warn('Default element is not defined in render()');
            return;
        }

        this.hasDataChanged('title', this.priorTitle, true) && this.updateTitle();
        this.hasDataChanged('notes', this.priorNotes, true) && this.updateNotes();
    }

    protected onConnected(): void {
        if (!this.defaultElement) {
            logger.warn('Default element is not defined in onConnected()');
            return;
        }

        this.tooltip = new window.bootstrap.Tooltip(this.defaultElement);
    }

    protected onDisconnected(): void {
        this.tooltip?.dispose();
        this.tooltip = null;
    }

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('netnotes', NetNotes, store);
    }

    protected hasDataChanged(key: 'notes' | 'title', priorValue: string, overwritePrior: boolean = false): boolean {
        if (!this.store?.mainCache) {
            return true;
        }

        const currentValue = this.store.mainCache.net[key];
        const haveChanged = currentValue !== priorValue;
        if (overwritePrior) {
            if (key === 'notes') {
                this.priorNotes = currentValue;
            } else {
                this.priorTitle = currentValue;
            }
        }
        return haveChanged;
    }

    private updateTitle(): void {
        const accordionTitleElem = this.defaultElement?.querySelector('#accordion-title') as HTMLElement;
        if (!accordionTitleElem) {
            logger.warn('Accordion title element is not defined in updateTitle()');
            return;
        }

        if (!this.store?.mainCache) {
            accordionTitleElem.textContent = 'Loading...';
            return;
        }

        const { title } = this.store.mainCache.net;
        accordionTitleElem.textContent = title;
    }

    private updateNotes(): void {
        const notesContentElem = this.defaultElement?.querySelector('#notes-content') as HTMLElement;
        const accordionContainerElem = this.defaultElement?.querySelector('#accordion-container') as HTMLElement;

        if (!notesContentElem || !accordionContainerElem) {
            logger.warn('Notes content or accordion container element is not defined in updateNotes()');
            return;
        }

        if (!this.store?.mainCache) {
            notesContentElem.textContent = 'Loading...';
            return;
        }

        const { notes } = this.store.mainCache.net;

        if (!notes || notes === '') {
            notesContentElem.textContent = 'No notes available';
            return;
        }

        notesContentElem.innerHTML = notes;

        this.bsCollapse = new window.bootstrap.Collapse(accordionContainerElem, {
            toggle: false
        });

        if (notes.length && window.innerWidth >= 768 && !this.store.stations.iAmAdmin) {
            this.bsCollapse.show();
            setTimeout(() => {
                this.bsCollapse?.hide();
            }, 9000);
        }
    }
}

export class NetDetails extends LiveNetElement {
    private priorNetDetails: NetInfo | null = null;

    protected getTemplate(): string {
        return /*html*/ `
            <style>
                /* Add your component styles here */
            #${this.defaultElementId} {
                color: var(--hl-light);
                white-space: nowrap;

            }         
            </style>
            <span id="${this.defaultElementId}">
            </span>
        `;
    }

    protected get netInfoHasChanged(): boolean {
        if (!this.store?.mainCache || !this.priorNetDetails) {
            this.priorNetDetails = this.store?.mainCache?.net ?? null;
            logger.debug(`Apparent first run of ${this.constructor.name}, netInfoHasChanged(). Returning true`);
            return true;
        }

        const hasChanged = this.store.cachePropertyHasChanged('net', this.priorNetDetails);

        if (hasChanged) this.priorNetDetails = this.store?.mainCache?.net ?? null;

        return hasChanged;
    }

    protected didMyDataSegmentChange(): boolean {
        return this.netInfoHasChanged;
    }

    protected render(): void {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, render()`);
            return;
        }

        if (!this.store?.mainCache) {
            this.defaultElement.textContent = 'Loading...';
            return;
        }

        const net = this.store.mainCache.net;

        if (!net) {
            logger.warn('No net data in store');
            return;
        }

        this.defaultElement.textContent = this.buildFrequencyAndTimeString(net);
    }

    private buildFrequencyAndTimeString(net: NetInfo): string {
        const { mode, frequency, modeDetails, permanent, createdAt, countdownTimer } = net;
        let freqAndTime = '';

        switch (mode) {
            case 'CUSTOM':
                freqAndTime = frequency ? `${frequency} ${modeDetails}` : `${modeDetails}`;
                break;
            case 'Reflector':
                freqAndTime = `${modeDetails}`;
                break;
            default:
                freqAndTime = `${frequency} ${mode}${modeDetails ? ` - ${modeDetails}` : ''}`;
                break;
        }

        if (!permanent) {
            let approximateStartTime = this.calculateApproximateStartTime(createdAt, countdownTimer);
            approximateStartTime = approximateStartTime.replace(/^0/, ''); // Remove leading zero from hours
            freqAndTime += ` @ ${approximateStartTime}`;
        }

        return freqAndTime;
    }

    private calculateApproximateStartTime(
        createdAt: NetInfo['createdAt'],
        countdownTimer: NetInfo['countdownTimer']
    ): string {
        const startTime = new Date(createdAt);
        startTime.setMinutes(startTime.getMinutes() + countdownTimer);
        startTime.setSeconds(0, 0); // Set seconds and milliseconds to 0
        return startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    protected onConnected(): void {}
    protected onDisconnected(): void {}

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('netinfo', NetDetails, store);
    }
}

type ProgressBarStates = 'PENDING_START' | 'NORMAL_START' | 'ABNORMAL_START';

export class NetStartProgress extends LiveNetElement {
    private defaultIntervalMs: number = 500;
    private _width: number = 0;
    private _state: ProgressBarStates = 'PENDING_START';
    private readonly mainLooper = new Looper(this.defaultIntervalMs, this.constructor.name);

    constructor() {
        super(EncapsulationMode.Open);
    }

    private set width(value: number) {
        if (value < 0 || value > 100) {
            throw new Error('Width must be between 0 and 100');
        }
        this._width = value;
        this.renderBarWidth(value);
    }

    private get width(): number {
        return this._width;
    }

    private set state(value: ProgressBarStates) {
        this._state = value;
        this.renderBarStyle();
    }

    private get state(): ProgressBarStates {
        return this._state;
    }

    private gracePeriodPercentComplete(createdAt: Date, gracePeriodMinutes: number, started: boolean = false): number {
        if (started || gracePeriodMinutes === 0) {
            return 100;
        }

        const elapsed = (Date.now() - createdAt.getTime()) / 1000 / 60;
        return Math.min(Math.floor((elapsed / gracePeriodMinutes) * 100), 100);
    }

    protected getTemplate(): string {
        return /*html*/ `
        <style>
            #${this.defaultElementId} {
                background-color: var(--hl-quaternary);
                height: 4px;
            }
            #${this.defaultElementId} .progress-bar {
                width: ${this.width}%;
                height: 4px;
            }
        </style>

        <div class="progress" id="${this.defaultElementId}">
            <div class="progress-bar progress-bar-striped progress-bar-animated bg-danger" role="progressbar"></div>
        </div>
    `;
    }

    private renderBarWidth(value: number): void {
        this.root.querySelector('.progress-bar')?.setAttribute('style', `width: ${value}%`);
    }

    private renderBarStyle(): void {
        const progressBar = this.root.querySelector('.progress-bar') as HTMLElement;
        if (!progressBar) {
            throw new Error('Progress bar element is not defined in widget, renderBarStyle()');
        }

        progressBar.className = 'progress-bar'; // Reset classes

        switch (this.state) {
            case 'PENDING_START':
                progressBar.classList.add('bg-danger', 'progress-bar-striped', 'progress-bar-animated');
                break;
            case 'NORMAL_START':
                progressBar.classList.add('bg-danger');
                break;
            case 'ABNORMAL_START':
                progressBar.classList.add('bg-warning', 'progress-bar-striped', 'progress-bar-animated');
                break;
            default:
                throw new Error('Invalid state in widget, renderBarStyle()');
        }
    }

    protected didMyDataSegmentChange(): boolean {
        return this.store?.mainCache?.net?.started ?? false;
    }

    protected render(): void {
        this.renderBarStyle();
    }

    private startMainLooper(): void {
        this.mainLooper.start(async loopStats => {
            const { ttlMs, net } = this.store?.mainCache ?? {};
            const { countdownTimer: gracePeriodMinutes, started } = net ?? {};
            let { createdAt } = this.store?.mainCache?.net ?? {};
            if (gracePeriodMinutes === undefined || !createdAt) return;

            if (!(createdAt instanceof Date)) {
                createdAt = new Date(createdAt);
            }

            const pct = this.gracePeriodPercentComplete(createdAt, gracePeriodMinutes, started);

            if (this.state === 'PENDING_START' && pct % 10 === 0) {
                logger.info(`Net-start grace period is ${pct}% completed`);
            }

            if (started) {
                this.mainLooper.stop();
                this.state = 'NORMAL_START';
            } else if (pct === 100) {
                const slowIntervalMs = (ttlMs ?? 10000) * 2;

                if (this.state === 'PENDING_START') {
                    if (loopStats.interval === slowIntervalMs) {
                        //in prior loop, interval was set to slow, to allow for backend to update
                        //net-start status. It appears that the net-start status is still pending.
                        //so lets signal that we are in an abnormal start state.
                        this.state = 'ABNORMAL_START';
                        //while in abnormal start stats, lets check for backend start at the faster (default) interval
                        this.mainLooper.setInterval(this.defaultIntervalMs);
                    } else {
                        //first time we have hit 100% so lets slow down the loop to give the backend
                        //a chance to update the net-start status.
                        //the slow interval only happens once.
                        this.mainLooper.setInterval(slowIntervalMs);
                    }
                }
            }

            this.width = pct;
        });
    }

    protected onConnected(): void {
        this.startMainLooper();
    }

    protected onDisconnected(): void {}

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('netstart-progress', NetStartProgress, store);
    }
}

export abstract class NetControlMember extends LiveNetElement {
    protected readonly cmd: AdminClient = new AdminClient();

    protected didMyStatusChange(): boolean {
        try {
            return this.store?.stations.haveMyStationPropertiesChanged(['role', 'checkedState']) ?? false;
        } catch (error) {
            if (error instanceof Error) {
                logger.warn(error.message);
            }
            return false;
        }
    }

    protected get iAmCheckedInAdmin(): boolean {
        let iAmAdmin: boolean;
        let iAmCheckedIn: boolean;

        try {
            ({ iAmAdmin, iAmCheckedIn } = this.store?.stations ?? { iAmAdmin: false, iAmCheckedIn: false });
        } catch (error) {
            if (error instanceof Error)
                logger.warn(`In widget ${this.constructor.name} : iAmCheckedInAdmin(): ${error.message}`);
            return false;
        }

        return iAmAdmin && iAmCheckedIn;
    }
}

export class NetControlUsage extends NetControlMember {
    protected getTemplate(): string {
        return /*html*/ `
        <style>
            #${this.defaultElementId} .command-label {
                color: var(--hl-light);
                font-weight: 600;
            }
            #${this.defaultElementId} .optional {
                font-style: italic;
                color: var(--hl-tertiary);

            }
            #${this.defaultElementId} .argument {
                color: var(--hl-secondary);
                font-family: monospace;
                font-weight: 400;
            }
            #${this.defaultElementId} {
                display: flex;        
                justify-content: flex-start;
                align-items: center;
            }
            #${this.defaultElementId} .expandIconContainer {
                display: flex;
                justify-content: center;
                cursor: pointer;
            }
            #${this.defaultElementId} .headerAndTextContainer {
                display: flex; /* This is what we'll toggle with JS */
                flex-direction: column;
                justify-content: center;
                align-items: center;            
            }
            #${this.defaultElementId} svg {
                display: block;
                padding-right: 10px;
                width: 1.20em; 
                height: 1.20em;
            }
            #${this.defaultElementId} code {
                font-family: monospace;
                font-weight: 400;
                white-space: nowrap;
                color: var(--hl-secondary);
            }
            #${this.defaultElementId} img {
                cursor: pointer;
                width: 75%;
            }
        </style>
        <div id="${this.defaultElementId}">
            <div class="expandIconContainer">
                <span class="expandedIcon hideOnCollapse" role="button" tabindex="0" aria-label="Hide usage text">
                    <span aria-hidden="true">${getIconSvg('bi-dash-circle')}</span>
                </span>
                <span class="collapsedIcon d-none hideOnExpand" role="button" tabindex="0" aria-label="Show usage text">
                    <span aria-hidden="true">${getIconSvg('bi-plus-circle')}</span>
                </span>
            </div>
            <div class="headerAndTextContainer">
                <div class="usage-header hideOnCollapse">
                    <img src="/img/cheat-sheet-dark.png" alt="Open command documentation cheat sheet" />
                </div>
                <div class="help-cmd d-none hideOnExpand" aria-live="polite">
                    ${this.formatUsage('help: ? [ <command> ]')}
                </div>
                <div class="usage-text hideOnCollapse" aria-label="Command usage help">
                    <!-- Usage will be injected here -->
                </div>                
            </div>     
        </div>
    `;
    }

    private collapse(value: boolean, save = true) {
        if (save) prefs.usageCollapsed = value;

        if (value) {
            this.root.querySelectorAll('.hideOnCollapse').forEach(element => element.classList.add('d-none'));
            this.root.querySelectorAll('.hideOnExpand').forEach(element => element.classList.remove('d-none'));
        } else {
            this.root.querySelectorAll('.hideOnCollapse').forEach(element => element.classList.remove('d-none'));
            this.root.querySelectorAll('.hideOnExpand').forEach(element => element.classList.add('d-none'));
        }
    }

    private toggleExpandCollapse = (): void => {
        this.collapse(!prefs.usageCollapsed);
    };

    private handleCommandHelpClick = (): void => {
        const { cmdHelpUrl } = serverInfo;
        if (cmdHelpUrl) {
            window.open(cmdHelpUrl, '_blank');
        }
    };

    protected didMyDataSegmentChange(): boolean {
        return this.didMyStatusChange();
    }

    protected formatUsage(text: string): string {
        const commands = text.split(', ');
        const formattedCommands = commands.map(command => {
            const [label, usage] = command.split(': ');
            const formattedLabel = `<span class="command-label">${label}</span>`;

            if (!usage) {
                return formattedLabel; // or handle the case where usage is undefined
            }

            let formattedUsage = usage
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\[([^\]]+)\]/g, '<span class="optional">[$1]</span>')
                .replace(/&lt;([^&]+)&gt;/g, '<span class="argument">&lt;$1&gt;</span>');
            formattedUsage = `<code>${formattedUsage}</code>`;
            return `${formattedLabel}: ${formattedUsage}`;
        });
        return formattedCommands.join(', ');
    }

    protected render(): void {
        this.cmd
            .usageText()
            .then(text => {
                const usageTextElement = this.root.querySelector('.usage-text') as HTMLElement;
                if (!usageTextElement) {
                    throw new Error('Usage text element is not defined in widget, render()');
                }

                usageTextElement.innerHTML = this.formatUsage(text);
            })
            .catch(error => {
                logger.error(`Error getting command list in widget: ${error}`);
            });
    }

    protected onConnected(): void {
        if (window.innerWidth < 768) {
            // If the screen is small, collapse the usage text temporarily
            this.collapse(true, false);
        } else {
            this.collapse(prefs.usageCollapsed);
        }

        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, onConnected()`);
            return;
        }

        const expandIconContainer = this.defaultElement.querySelector('.expandIconContainer');
        if (expandIconContainer) {
            expandIconContainer.addEventListener('click', this.toggleExpandCollapse);
        }

        const imgElement = this.defaultElement.querySelector('img');
        if (imgElement) {
            imgElement.addEventListener('click', this.handleCommandHelpClick);
        }
    }

    protected onDisconnected(): void {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, onDisconnected()`);
            return;
        }

        const expandIconContainer = this.defaultElement.querySelector('.expandIconContainer');
        if (expandIconContainer) {
            expandIconContainer.removeEventListener('click', this.toggleExpandCollapse);
        }

        const imgElement = this.defaultElement.querySelector('img');
        if (imgElement) {
            imgElement.removeEventListener('click', this.handleCommandHelpClick);
        }
    }

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('netcontrol-usage', NetControlUsage, store);
    }
}

export class NetControlForm extends NetControlMember {
    protected getTemplate(): string {
        return /*html*/ `
    <style>
        /* Style for the response container */
        #${this.defaultElementId} .response {
            margin-top: .75em; /* Add some space above the response */
            display: flex;
            width: 100%; /* Use 100% of the parent's width */
            justify-content: space-between; /* Space out the children */
            align-items: center; /* Center align the items vertically */
            position: relative; /* Make it a positioned element for the overlay */
            
        }

        /* Style for the overlay */
        #${this.defaultElementId} .response .overlay {
            position: absolute; /* Position it absolutely within the response div */
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 1; /* Ensure it is above the response text */
            border-radius: 6px;
            background: var(--hl-response-status-overlay);
        }

        #${this.defaultElementId} .response .overlay.error {
            background: linear-gradient(
                135deg,
                rgba(243, 29, 82, 0.15) 0%,
                rgba(0, 0, 0, 0.2) 50%,
                rgba(243, 29, 82, 0.15) 100%
            );
            border: 1px solid rgba(243, 29, 82, 0.3);
        }

        #${this.defaultElementId} .response .overlay.success {
            background: linear-gradient(
                135deg,
                rgba(60, 206, 60, 0.15) 0%,
                rgba(0, 0, 0, 0.2) 50%,
                rgba(60, 206, 60, 0.15) 100%
            );
            border: 1px solid rgba(60, 206, 60, 0.3);
        }

        /* Center the response text and allow it to take up the available space */
        #${this.defaultElementId} .response .response-text {
            text-align: center; /* Center the text */
        }

        /* Style for the input within the form */
        #${this.defaultElementId} input[type="text"] {
            border-radius: 5px;
            box-sizing: border-box; /* Include padding and border in the element's size */
            background-color: black; /* Set the background color to black */
            color: var(--hl-light); /* Set the text color */
            font-size: 1.20em; /* Set the font size */
            font-style: italic; /* Set the font style to italic */
            border: none; /* Remove default border */
            width: 100%; /* Use 100% of the parent's width */
            padding: 8px; /* Add some padding inside the input */
            border: 1px solid transparent; /* Set initial border to transparent */
            transition: border 0.4s; /* Add transition for border */            
        }
        /* Style for the placeholder text */
        #${this.defaultElementId} input[type="text"]::placeholder {
            color: var(--hl-tertiary); /* Color for the placeholder text */
        }
        #${this.defaultElementId} input[type="text"]:focus {
            border: 1px solid var(--hl-light); /* Change the border color */
            outline: none; /* Remove the default outline */
        }
        #${this.defaultElementId} .brace {
            display: inline-block;
            padding: 0 5px;
        }
        #${this.defaultElementId} .brace.open {
            margin-right: 10px;
        }
        #${this.defaultElementId} .brace.close {
            margin-left: 10px;
        }
    </style>
    <div id="${this.defaultElementId}">   
        <form>
            <label for="cmdLine" class="d-none">Command prompt</label>
            <input type="text" id="cmdLine" aria-label="Command Prompt">
        </form>
        <div class="response">
            <div class="overlay"></div>
            <span class="brace open">{</span>
            <code class="response-text"></code>
            <span class="brace close">}</span>
        </div>
    </div>
    `;
    }

    protected didMyDataSegmentChange(): boolean {
        return this.didMyStatusChange();
    }

    protected render(onConnected: boolean): void {
        if (onConnected) {
            return;
        }

        const input = this.root.querySelector('#cmdLine') as HTMLInputElement;
        if (!input) {
            throw new Error('Input element is not defined in widget, render()');
        }

        let prompt = '';

        if (this.iAmCheckedInAdmin) {
            input.disabled = false;
            input.focus();

            if (!this.store?.stations.mine) {
                throw new Error('My station is not defined in widget, render()');
            }

            const { level } = this.store?.stations.mine;

            if (this.store?.stations.mine) {
                prompt = `${level === 0 ? '☆' : ''}>`;
            }

            input.placeholder = prompt;
        } else {
            input.placeholder = 'X>';
            input.disabled = true;
        }
    }

    public applyFocus() {
        const input = this.root.querySelector('#cmdLine') as HTMLInputElement;
        if (!input) {
            throw new Error('Input element is not defined in widget, focus()');
        }
        input.focus();
    }

    protected respond(response: string, type?: 'error' | 'success'): void {
        const responseText = this.root.querySelector('.response-text') as HTMLElement;
        if (!responseText) {
            throw new Error('Response element is not defined in widget, respond()');
        }

        // Set aria-live according to type
        if (type === 'error') {
            responseText.setAttribute('aria-live', 'assertive');
        } else {
            responseText.setAttribute('aria-live', 'polite');
        }

        responseText.textContent = response;

        const overlay = this.root.querySelector('.overlay') as HTMLElement;
        if (!overlay) {
            throw new Error('Overlay element is not defined in widget, respond()');
        }

        overlay.classList.remove('error', 'success');

        if (type === 'error') {
            overlay.classList.add('error');
        } else if (type === 'success') {
            overlay.classList.add('success');
        }
    }

    protected onConnected(): void {
        this.defaultElement?.querySelector('form')?.addEventListener('submit', e => {
            e.preventDefault();
            const input = this.defaultElement?.querySelector('input') as HTMLInputElement;
            if (!input) {
                throw new Error('Input element is not defined in widget, onConnected()');
            }

            if (!this.store) {
                throw new Error('Store is not defined in widget, onConnected()');
            }

            const { value } = input;
            if (!value) {
                return;
            }

            input.value = '';

            this.respond('processing...');

            this.cmd
                .exec(value.trim())
                .then(response => {
                    this.respond(response.message, 'success');
                })
                .catch(error => {
                    input.value = value;

                    if (isEndPointResponseError(error)) {
                        this.respond(error.message, 'error');
                    } else {
                        if (error instanceof Error) {
                            if (error.message === 'Failed to fetch') {
                                this.respond('Network error', 'error');
                            } else {
                                this.respond(error.message, 'error');
                            }
                        }
                        logger.error(`Error executing command in widget: ${error}`);
                    }
                });
        });
    }
    protected onDisconnected(): void {}

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('netcontrol-form', NetControlForm, store);
    }
}

export class NetControlPanel extends NetControlMember {
    protected getTemplate(): string {
        return /*html*/ `
        <style>
            #${this.defaultElementId} {
                display: none;
                width: 92%;
                flex-direction: column;
                position: absolute; /* Position it absolutely */
                top: 0px; /* Adjust as needed */
                left: 50%; /* Center It */
                transform: translateX(-50%); /* Offset by half its width */
                background: var(--hl-quaternary);
                border: 1px solid rgba(220, 131, 53, 0.25);
                border-radius: 8px;
                padding: 1em;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                z-index: 1000; /* Ensure it is above other elements */
                opacity: 0; /* Start hidden */
                transition: opacity .25s ease-in-out; /* Fade transition */
            }
            #${this.defaultElementId}.visible {
                opacity: 1; /* Fade in */
            }
            #${this.defaultElementId} .close-button {
                color: var(--hl-light);
                position: absolute;
                top: 10px;
                right: 10px;
                background: none;
                border: none;
                cursor: pointer;
            }
            #${this.defaultElementId} .close-button svg {
                width: 1.5em; 
                height: 1.5em;
            }
            #${this.defaultElementId} hl-netcontrol-usage {
                margin: 5px 0;
            }
            @media (min-width: 768px) {
                #${this.defaultElementId} hl-netcontrol-usage {                    
                    margin: 10px 0;
                }
                #${this.defaultElementId} {
                    width: 75%;
                }
            }
            @media (min-width: 992px) {
                #${this.defaultElementId} hl-netcontrol-usage {                    
                    margin: 12px 0;
                }
                #${this.defaultElementId} {
                    width: 60%;
                }
            }
            @media (min-width: 1200px) {
                #${this.defaultElementId} hl-netcontrol-usage {                    
                    margin: 15px 0;
                }
                #${this.defaultElementId} {
                    width: 40%;
                }
            }

        </style>
        <div id="${this.defaultElementId}">

            <div>✋: <em><hl-state-list group="hand-up"></hl-state-list></em></div>


            <hl-netcontrol-usage></hl-netcontrol-usage>
            <hl-netcontrol-form></hl-netcontrol-form>

            <button class="close-button" aria-label="close control panel">${getIconSvg('bi-x-circle-fill')}</button>
        </div>
    `;
    }

    public open(): void {
        if (this.isOpen) {
            return;
        }

        if (!this.defaultElement) {
            throw new Error('Default element is not defined in widget, open()');
        }

        this.defaultElement.style.display = 'flex';

        if (!this.defaultElement) {
            throw new Error('Default element is not defined in widget, open()');
        }
        this.defaultElement.classList.add('visible');

        this.applyFocus();
    }

    public close(): void {
        if (!this.isOpen) {
            return;
        }

        if (!this.defaultElement) {
            throw new Error('Default element is not defined in widget, close()');
        }

        this.defaultElement.classList.remove('visible');
        this.defaultElement.addEventListener(
            'transitionend',
            () => {
                if (!this.defaultElement) {
                    throw new Error('Default element is not defined in widget, close()');
                }
                this.defaultElement.style.display = 'none';
            },
            { once: true }
        );
    }

    private get isOpen(): boolean {
        if (!this.defaultElement) {
            throw new Error('Default element is not defined in widget, isOpen()');
        }

        return this.defaultElement.classList.contains('visible');
    }

    public toggle(): void {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    protected didMyDataSegmentChange(): boolean {
        return this.didMyStatusChange();
    }

    protected render(onConnected: boolean): void {
        if (onConnected) {
            return;
        }

        if (this.iAmCheckedInAdmin) {
            this.open();
        } else {
            this.close();
        }
    }

    public applyFocus(): void {
        const form = this.defaultElement?.querySelector('hl-netcontrol-form') as NetControlForm;
        if (!form) {
            throw new Error('Form element is not defined in widget, applyFocus()');
        }
        form.applyFocus();
    }

    protected onConnected(): void {
        this.defaultElement?.querySelector('.close-button')?.addEventListener('click', () => this.close());
    }
    protected onDisconnected(): void {
        this.defaultElement?.querySelector('.close-button')?.removeEventListener('click', () => this.close());
    }

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('netcontrol-panel', NetControlPanel, store);
    }
}

export class NetControlButton extends NetControlMember {
    protected netControlPanelElement: NetControlPanel | null = null;
    private label = ['Net', 'Logger', 'Relay', 'User'] as const;

    constructor() {
        super(EncapsulationMode.Open);
    }

    protected getTemplate(): string {
        return /*html*/ `
        <style>
            #${this.defaultElementId} {
                background: linear-gradient(135deg, 
                    rgba(220, 131, 53, 0.15) 0%, 
                    rgba(220, 131, 53, 0.25) 100%
                );
                border: 1px solid rgba(220, 131, 53, 0.4);
                color: var(--hl-light);
                border-radius: 20px;
                padding: 4px 16px;
                font-size: 0.85rem;
                transition: all 0.2s ease;
            }
            #${this.defaultElementId}:hover {
                background: linear-gradient(135deg, 
                    rgba(220, 131, 53, 0.25) 0%, 
                    rgba(220, 131, 53, 0.35) 100%
                );
                border-color: rgba(220, 131, 53, 0.6);
                box-shadow: 0 0 8px rgba(220, 131, 53, 0.3);
            }
        </style>

        <button id="${this.defaultElementId}" class="btn btn-sm fade-in d-none" type="button">               
            <slot></slot>
        </button>
    `;
    }

    protected didMyDataSegmentChange(): boolean {
        return this.didMyStatusChange();
    }

    protected render(onConnected: boolean): void {
        if (onConnected) {
            return;
        }

        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, render()`);
            return;
        }

        if (!this.store?.stations) {
            logger.warn(`Store is not defined in ${this.constructor.name}, render()`);
            return;
        }

        const { mine } = this.store.stations;

        if (!mine) {
            logger.warn(
                `My station is not defined in ${this.constructor.name}, render(). Waiting for initial response from /presence?`
            );
            return;
        }

        if (!this.netControlPanelElement) {
            this.netControlPanelElement = document.querySelector('hl-netcontrol-panel') as NetControlPanel;
        }

        if (this.iAmCheckedInAdmin) {
            this.defaultElement.textContent = `${this.label[mine.level]} Control Panel`;
            this.defaultElement.classList.remove('d-none');
        } else {
            this.defaultElement.classList.add('d-none');
        }
    }

    private handleClick = (): void => {
        if (!this.netControlPanelElement) {
            throw new Error('Net Control Panel is not defined in widget, render()');
        }
        this.netControlPanelElement.toggle();
    };

    protected onConnected(): void {
        this.addEventListener('click', this.handleClick);
    }

    protected onDisconnected(): void {
        this.removeEventListener('click', this.handleClick);
    }

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('netcontrol-button', NetControlButton, store);
    }
}

export class RoleStats extends LiveNetElement {
    protected getTemplate(): string {
        return /*html*/ `
        <style>
            /* Add your component styles here */
        </style>
        <em id="${this.defaultElementId}">
            Count ${this.store?.stations.getGroup('checked-in-ever')?.size ?? 0}
                
        </em>
    `;
    }

    protected didMyDataSegmentChange(): boolean {
        return this.store?.stations.getGroup('checked-in-ever')?.newData ?? false;
    }
    protected render(): void {
        logger.debug('RoleStats widget: render()');
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, render()`);
            return;
        }
        this.defaultElement.textContent = `Count ${this.store?.stations.getGroup('checked-in-ever')?.size ?? 0}`;
    }
    protected onConnected(): void {}
    protected onDisconnected(): void {}

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('rolestats', RoleStats, store);
    }
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

type StyleKey = `${Station['role']}-${Station['presence']}-${Station['checkedState']}`;

export abstract class StationTableMember extends LiveNetElement {
    public callSign: string | null = null;
    static readonly styleCache = new Map<StyleKey, CellContentStyling>();

    protected set defaultElementCursorisPointer(pointer: boolean) {
        if (!this.defaultElement) {
            throw new Error('Default element is not defined in widget, defaultElementCursorisPointer()');
        }
        this.defaultElement.style.cursor = pointer ? 'pointer' : 'default';
    }

    private handleClickType =
        (type: SimpleInteractionMethodNames) =>
        (e: Event): void => {
            this.handleClick(type, e);
        };

    // Handlers can't be anonymous (otherwise they can't be removed) or take arguments,
    // so we need a named function for each type of interaction (vs simply using
    // handleClick(type, e) directly on the event listener).

    protected highlightClick = this.handleClickType('highlight');
    protected handClick = this.handleClickType('hand');
    protected checkStateClick = this.handleClickType('checkState');

    protected handleClick = (type: SimpleInteractionMethodNames, e: Event): void => {
        if (!this.callSign) {
            throw new Error('Call sign is not defined in widget, handleClick()');
        }

        if (!this.store) {
            throw new Error('Store is not defined in widget, handleClick()');
        }

        const target = e.target as HTMLElement;
        logger.debug(
            `click event on target: ${target.tagName} with class: ${target.className} in widget: ${this.constructor.name}`
        );

        const isCheckState = type === 'checkState';
        const isHighlightOrCheckState = type === 'highlight' || isCheckState;
        const isHand = type === 'hand';

        if (isCheckState) {
            if (!this.iHaveMorePrivs) {
                // Load the context menu and return
                logger.warn('Cannot check out station with equal or greater privileges');
                return;
            }

            if (!this.iAmStation) {
                // Inhibit context menu if the target station is not me
                e.preventDefault();
            } else {
                // Load the context menu and return
                logger.warn('Cannot check out self');
                return;
            }

            // Inhibit context menu if the target station has less privileges than me
            e.preventDefault();
        }

        const { iAmCheckedIn, iAmAdmin } = this.store.stations;
        const theyAreCheckedIn = this.station?.checkedState === true;

        //highlight and checkOuts can only be performed on checkedIn stations
        if (isHighlightOrCheckState && iAmCheckedIn && iAmAdmin && theyAreCheckedIn) {
            const param = isCheckState ? false : null;
            this[type](this.callSign, param).catch(error => {
                logger.error(`Error updating ${type} state for ${this.callSign} in widget: ${error}`);
            });
            //hand can only be performed regardless of checkedState
        } else if (isHand && ((iAmCheckedIn && iAmAdmin) || this.iAmStation)) {
            this[type](this.callSign, null).catch(error => {
                logger.error(`Error updating ${type} state for ${this.callSign} in widget: ${error}`);
            });
        }
    };

    protected get iAmStation(): boolean {
        if (!this.callSign) {
            throw new Error('Call sign is not defined in widget, iAmStation()');
        }
        return this.callSign === this.store?.stations.mine?.callSign;
    }

    protected get iHaveMorePrivs(): boolean {
        if (!this.station || !this.store?.stations.mine) {
            throw new Error('Station or mine is not defined in widget, iHaveMorePrivs()');
        }
        return this.store.stations.mine.level < this.station.level;
    }

    protected getStationColor(
        station: Station
    ): 'primary' | 'secondary' | 'light' | 'success' | 'tertiary' | 'quaternary' | 'danger' {
        const { role, checkedState, presence } = station;

        if (checkedState === null) {
            return presence === 'online' ? 'light' : 'danger';
        }

        if (checkedState === false) {
            return 'light';
        }

        const roleColorMap: Record<string, 'primary' | 'secondary' | 'tertiary' | 'success' | undefined> = {
            netuser: 'primary',
            netcontrol: 'secondary',
            netlogger: 'tertiary',
            netrelay: 'success',
            default: undefined
        };

        return roleColorMap[role] || 'danger';
    }

    stationIsBold(station: Station): boolean {
        return typeof station.checkedState === 'boolean';
    }
    getStationOpacity(station: Station): number {
        return station.checkedState === false ? 0.5 : 1;
    }

    stationIsItalicized(station: Station): boolean {
        return station.checkedState !== true;
    }

    stationIsLinethrough(station: Station): boolean {
        return station.checkedState === false;
    }

    protected getStyling(station: Station): CellContentStyling {
        const { role, presence, checkedState } = station;

        // Create a unique key based on the properties
        const styleKey: StyleKey = `${role}-${presence}-${checkedState}`;

        if (StationTableMember.styleCache.has(styleKey)) {
            // logger.debug(`Using memoized styling for ${role}, ${presence}, check:${checkedState}`);
            return StationTableMember.styleCache.get(styleKey)!;
        }

        const styling: CellContentStyling = {
            icon: this.getStationIcon(station),
            color: `var(--hl-${this.getStationColor(station)})`,
            fontStyle: this.stationIsItalicized(station) ? 'italic' : 'normal',
            fontWeight: this.stationIsBold(station) ? 'bold' : 'normal',
            opacity: this.getStationOpacity(station),
            visible: this.stationIsVisible(station),
            textDecoration: this.stationIsLinethrough(station) ? 'line-through' : 'none'
        };

        StationTableMember.styleCache.set(styleKey, styling);

        return styling;
    }

    protected applyStyling(element: HTMLElement, styling: Omit<CellContentStyling, 'icon'>): void {
        if (!element.style) {
            throw new Error('The element does not have a style tag in widget, applyStyling()');
        }
        element.style.fontWeight = styling.fontWeight;
        element.style.color = styling.color;
        element.style.fontStyle = styling.fontStyle;
        element.style.textDecoration = styling.textDecoration;
    }

    protected haveThisStationPropertiesChanged(properties: PropertiesOfInterest[]): boolean {
        if (!this.callSign) {
            throw new Error('Call sign is not defined in widget, havePropertiesChanged()');
        }

        return this.store?.stations.havePropertiesChanged(properties, this.callSign) ?? false;
    }

    protected get station() {
        if (!this.callSign) {
            throw new Error('Call sign is not *yet defined in widget, getThisStation()');
        }

        if (!this.store) {
            logger.warn(`Store is not defined in ${this.constructor.name}, getThisStation()`);
            return null;
        }

        return this.store.stations.get(this.callSign);
    }

    protected get stationPrior() {
        if (!this.callSign) {
            throw new Error('Call sign is not defined in widget, getThisStationPrior()');
        }

        if (!this.store) {
            logger.warn(`Store is not defined in ${this.constructor.name}, getThisStationPrior()`);
            return null;
        }

        return this.store.stations.getPrior(this.callSign);
    }
}

export class AvatarCell extends StationTableMember {
    private defaultPhoto = '/img/marconi_88x96.jpg';

    private get photoUrl(): string {
        return this.store?.ready ? (this.station?.photo ?? this.defaultPhoto) : this.defaultPhoto;
    }

    private get isOnline(): boolean {
        return this.station?.presence === 'online';
    }

    protected getTemplate(): string {
        return /*html*/ `
        <style>
            @keyframes throb {
                0%, 100% {
                    transform: scale(1);
                }
                50% {
                    transform: scale(1.1);
                }
            }
          .onlinestatus-icon {
                position: absolute;
                top: 63%;
                left: 55%;
                margin: 0;
                opacity: 0; /* Start with icons hidden */
                visibility: hidden; /* Ensure they don't block interaction */
                transition: opacity 1.25s ease-in, visibility 1.25s ease-in;
                font-size: 0.9rem;
            }
            .onlinestatus-icon.visible {
                opacity: 1;
                visibility: visible;
            }
            .onlinestatus-icon.online.visible {
                animation: throb 1.7s infinite;
            }
            .onlinestatus-icon.offline.visible {
                opacity: 0.65;
            }
            .hand-icon {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-125%, -50%);
                margin: 0;
                opacity: 1;
                transition: opacity 0.5s ease-in-out;
                font-size: 1.9rem;   
            }
            .hand-icon.hand-is-down {
                opacity: 0;
            }
            #${this.defaultElementId} {
                display: flex; /* Enable Flexbox */
                align-items: center; /* Center vertically */
                justify-content: center; /* Center horizontally (optional) */ 
                position: relative;

            }
            #${this.defaultElementId} img {
                padding: 10px;
                width: 55px;
                height: 55px;
                border-radius: 50%;
            }

        </style>

        <div id="${this.defaultElementId}">
            <span class="onlinestatus-icon online">🟢</span> <!-- Online Icon -->
            <span class="onlinestatus-icon offline">⚪️</span> <!-- Offline Icon -->
            <span class="hand-icon hand-is-down">✋</span>
            <img referrerPolicy="no-referrer" src=${this.photoUrl}>
        </div>
        `;
    }

    protected didMyDataSegmentChange(): boolean {
        return this.haveThisStationPropertiesChanged(['photo', 'hand', 'presence']);
    }

    protected render(): void {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, render()`);
            return;
        }

        // Handle photo change
        this.defaultElement.querySelector('img')!.src = this.photoUrl;

        // Handle hand change
        this.defaultElement.querySelector('.hand-icon')!.classList.toggle('hand-is-down', !this.station?.hand);

        // Handle presence change
        const onlineIconElement = this.defaultElement.querySelector('.onlinestatus-icon.online');
        const offlineIconElement = this.defaultElement.querySelector('.onlinestatus-icon.offline');
        if (!onlineIconElement || !offlineIconElement) {
            logger.warn(`Online status elements are not defined in ${this.constructor.name}, render()`);
            return;
        }

        onlineIconElement.classList.toggle('visible', this.isOnline);
        offlineIconElement.classList.toggle('visible', !this.isOnline);

        this.defaultElementCursorisPointer = Boolean(
            this.iAmStation || (this.store?.stations.iAmAdmin && this.store.stations.iAmCheckedIn)
        );
    }

    protected onConnected(): void {
        this.addEventListener('click', this.handClick);
    }

    protected onDisconnected(): void {
        this.removeEventListener('click', this.handClick);
    }

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('avatarcell', AvatarCell, store);
    }
}

export class CallSignCell extends StationTableMember {
    protected getTemplate = (): string => {
        return /*html*/ `
        <style>
            #${this.defaultElementId} {
                display: grid;
                align-items: center;
                justify-items: start;
                padding: 10px;
                /* Remaining styles by applyStyling() */
            }
            .inline-icon {
                display: inline-flex;
                align-items: center;
            }
            .inline-icon svg {
                margin-top: 2px;
                margin-left: 5px;
                color: var(--hl-light);
            }
        </style>

        <div id="${this.defaultElementId}">
        </div>
        `;
    };

    protected didMyDataSegmentChange(): boolean {
        return this.haveThisStationPropertiesChanged(['role', 'callSign', 'checkedState', 'presence']);
    }

    protected render(): void {
        if (!this.station) {
            logger.warn(`Station is not defined in ${this.constructor.name}, render()`);
            return;
        }

        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, render()`);
            return;
        }

        const styling = this.getStyling(this.station);
        const { icon, ...styleProps } = styling;
        this.applyStyling(this.defaultElement, styleProps);

        if (!this.callSign) {
            throw new Error('Call sign is not defined in CallSignCell widget, render()');
        }

        this.defaultElement.innerHTML = `
            <span class="inline-icon">
                ${this.callSign} ${icon && getIconSvg(icon)}
            </span>
        `;

        this.defaultElementCursorisPointer = Boolean(
            this.store?.stations.iAmCheckedIn && this.store?.stations.iAmAdmin && this.station?.checkedState
        );
    }

    protected onConnected(): void {
        this.addEventListener('click', this.highlightClick);
        this.addEventListener('contextmenu', this.checkStateClick);
    }

    protected onDisconnected(): void {
        this.removeEventListener('click', this.highlightClick);
        this.removeEventListener('contextmenu', this.checkStateClick);
    }

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('callsigncell', CallSignCell, store);
    }
}

export class NameCell extends StationTableMember {
    private tooltip: bootstrap.Tooltip | null = null;

    protected getTemplate(): string {
        return /*html*/ `
        <style>
            #${this.defaultElementId} {
                display: grid;
                align-items: center;
                justify-items: start;
                padding: 10px;
                /* Remaining styles by applyStyling() */
            }
        </style>

        <div id="${this.defaultElementId}">
        </div>
        `;
    }

    protected didMyDataSegmentChange(): boolean {
        return this.haveThisStationPropertiesChanged(['location', 'displayName', 'role', 'checkedState', 'presence']);
    }

    private refreshTooltip(): void {
        this.cleanupTooltip();

        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, refreshTooltip()`);
            return;
        }

        this.defaultElement.setAttribute('data-bs-toggle', 'tooltip');
        this.defaultElement.setAttribute('data-bs-placement', 'left');

        if (!this.callSign) {
            throw new Error('Call sign is not defined in NameCell widget, refreshTooltip()');
        }

        this.defaultElement.setAttribute('title', this.station?.location ?? '🚫');
        this.tooltip = new window.bootstrap.Tooltip(this.defaultElement);
    }

    protected render(onConnected: boolean): void {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, render()`);
            return;
        }

        // This widget will be disconnected and reconnected every time a station row is recreated.
        // Therefore, many of the conditionals below need to be executed "onConnected".
        // This is more about handling the widget's lifecycle during subsequent create/destroy cycles
        // rather than the initial page load.

        // Handle location change
        if (onConnected || this.haveThisStationPropertiesChanged(['location'])) {
            this.refreshTooltip();
        }

        // Handle display name change
        if (onConnected || this.haveThisStationPropertiesChanged(['displayName'])) {
            this.defaultElement.textContent = `${this.station?.displayName ?? ''}`;
        }

        // Handle styling for role, checkedState, and presence changes
        if (onConnected || this.haveThisStationPropertiesChanged(['role', 'checkedState', 'presence'])) {
            if (!this.station) {
                throw new Error('Station is null in NameCell widget, render()');
            }

            this.applyStyling(this.defaultElement, this.getStyling(this.station));
        }
    }

    protected onConnected(): void {}

    protected onDisconnected(): void {
        this.cleanupTooltip();
    }

    private cleanupTooltip(): void {
        this.tooltip?.dispose();
        this.tooltip = null;
    }

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('namecell', NameCell, store);
    }
}

export class SigReportCell extends StationTableMember {
    private lastSigReportType: string | null = null;
    private restrictedSigReports: boolean | null = null;

    protected getTemplate(): string {
        return /*html*/ `
        <style>
            ${this.getInputStyles()}
        </style>
        <form id="${this.defaultElementId}">
            <input type="text" placeholder="..." size="4" aria-label="Input Signal Report">
        </form>
        `;
    }

    private getInputStyles(): string {
        return /*css*/ `
            #${this.defaultElementId} input {
                color: var(--hl-light);
                font-size: 1rem;
                background: black;
                padding: 10px;
                border: 1px solid #777;
                border-radius: 5px;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                transition: border-color 0.4s, box-shadow 0.4s;
            }
            #${this.defaultElementId} input::placeholder {
                color: gray;
            }
            #${this.defaultElementId} input:focus {
                border-color: var(--hl-light);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                outline: none;
            }
            #${this.defaultElementId} input:disabled {
                background: #333;
                color: #777;
            }
        `;
    }

    private haveNetSigReportAttribsChanged(): boolean {
        const sigReportType = this.store?.mainCache?.net.sigReportType ?? null;
        const restrictedSigReports = this.store?.mainCache?.net.restrictedSigReports ?? null;

        const hasChanged =
            sigReportType !== this.lastSigReportType || restrictedSigReports !== this.restrictedSigReports;

        this.lastSigReportType = sigReportType;
        this.restrictedSigReports = restrictedSigReports;

        return hasChanged;
    }

    private updateVisibility(): void {
        if (!this.defaultElement) {
            throw new Error('Default element is not defined in widget, updateVisibility()');
        }

        this.style.display = this.store?.mainCache?.net.sigReportType === null ? 'none' : 'block';
    }

    private updateInputPlaceholderValue(input: HTMLInputElement): void {
        input.placeholder = this.store?.mainCache?.net.sigReportType ?? '...';
    }

    private indicateInputValueChange(): void {
        if (this.store && this.store.version <= 1) {
            return;
        }

        const input = this.getInputElement();
        const { averageSigReport } = this.station ?? {};
        const { averageSigReport: priorAverageSigReport } = this.stationPrior ?? {};

        if (this.store?.ready && typeof averageSigReport === 'string' && averageSigReport !== priorAverageSigReport) {
            this.updateInputBorderStyle(input, 'success');
        }
    }

    private updateInputValue(input: HTMLInputElement, value?: string): void {
        input.value = value ?? this.station?.averageSigReport ?? '';
    }

    private updateInputState(input: HTMLInputElement): void {
        const restrictedSigReports = this.store?.mainCache?.net.restrictedSigReports ?? false;
        const isNetControl = this.store?.stations.mine?.role === 'netcontrol';
        const isCheckedStateFalse = this.station?.checkedState === false;

        input.disabled =
            (restrictedSigReports && !isNetControl) ||
            isCheckedStateFalse ||
            this.store?.mainCache?.net.sigReportType === null;
    }

    private updateInputBorderStyle(input: HTMLInputElement, applyTemp?: 'success' | 'danger'): void {
        const borderStyles = {
            default: { color: 'rgba(240, 238, 222, 0.15)', style: 'solid', width: '1px' },
            hasSigReport: { color: 'var(--hl-tertiary)', style: 'solid', width: '2px' },
            success: { color: 'var(--hl-success)', style: 'solid', width: '2px' },
            danger: { color: 'var(--hl-danger)', style: 'solid', width: '2px' }
        };

        let borderStyle = borderStyles.default;

        if (applyTemp) {
            borderStyle = applyTemp === 'success' ? borderStyles.success : borderStyles.danger;
            setTimeout(() => this.updateInputBorderStyle(input), 2500);
        } else {
            if (!this.station) {
                throw new Error('Station is null in SigReportCell widget, updateInputBorderStyle()');
            }

            borderStyle = this.station.averageSigReport ? borderStyles.hasSigReport : borderStyles.default;
            if (this.station.checkedState === false) borderStyle = borderStyles.default;
        }

        input.style.borderColor = borderStyle.color;
        input.style.borderStyle = borderStyle.style;
        input.style.borderWidth = borderStyle.width;
    }

    private handleInputFocus = (e: FocusEvent): void => {
        const input = e.target as HTMLInputElement;
        input.style.borderColor = 'var(--hl-light)';
        input.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
        input.style.borderWidth = '1px';
        input.style.outline = 'none';
        this.updateInputValue(input, '');
    };

    private handleInputBlur = (e: FocusEvent): void => {
        const input = e.target as HTMLInputElement;
        this.updateInputBorderStyle(input);
        this.updateInputPlaceholderValue(input);
        this.updateInputValue(input);
    };

    private handleSubmit = (e: Event): void => {
        e.preventDefault();
        const input = this.getInputElement();

        if (!this.callSign) {
            throw new Error('Call sign is not defined in widget, handleSubmit()');
        }

        this.sigReport(this.callSign, input.value.trim())
            .then(() => {
                input.blur();
                this.updateInputBorderStyle(input, 'success');
                this.updateInputValue(input, input.value.trim());
            })
            .catch(error => {
                logger.error(`Error updating sigReport for ${this.callSign} in widget: ${error}`);
                this.updateInputBorderStyle(input, 'danger');
            });
    };

    private getInputElement(): HTMLInputElement {
        const input = this.defaultElement?.querySelector('input');
        if (!input) {
            throw new Error('Input element is not defined in widget');
        }
        return input;
    }

    protected didMyDataSegmentChange(): boolean {
        return (
            this.haveNetSigReportAttribsChanged() ||
            this.haveThisStationPropertiesChanged(['checkedState', 'averageSigReport'])
        );
    }

    protected render(): void {
        const input = this.getInputElement();
        this.updateInputPlaceholderValue(input);
        this.updateInputState(input);
        this.updateInputBorderStyle(input);
        this.updateInputValue(input);
        this.updateVisibility();
        this.indicateInputValueChange();
    }

    protected onConnected(): void {
        const input = this.getInputElement();
        input.addEventListener('focus', this.handleInputFocus);
        input.addEventListener('blur', this.handleInputBlur);
        this.defaultElement?.addEventListener('submit', this.handleSubmit);
    }

    protected onDisconnected(): void {
        const input = this.getInputElement();
        input.removeEventListener('focus', this.handleInputFocus);
        input.removeEventListener('blur', this.handleInputBlur);
        this.defaultElement?.removeEventListener('submit', this.handleSubmit);
    }

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('sigreportcell', SigReportCell, store);
    }
}
export class StationRow extends StationTableMember {
    private readonly cellTypes = ['avatar', 'callsign', 'name', 'sigreport'] as const;

    protected getTemplate(): string {
        return /*html*/ `
        <style>
            #${this.defaultElementId} {
                padding-right: 20px;
                align-items: center;
                border: 1px solid transparent;
                border-bottom: 1px solid rgba(240, 238, 222, 0.15);
                justify-items: center; /* Center contents horizontally */
                text-align: center; /* Center text horizontally */
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
            }
            .highlighted-${this.uuid} {
                background-image: linear-gradient(to right, var(--hl-quaternary), var(--hl-quaternary), #333, #555, var(--hl-quaternary));
            }
        </style>
        <div id="${this.defaultElementId}"></div>`;
    }

    private createCell<T extends StationTableMember>(type: string): T {
        const cell = document.createElement(`hl-${type}cell`) as T;
        cell.callSign = this.callSign || '';
        return cell;
    }

    protected didMyDataSegmentChange(): boolean {
        return this.haveThisStationPropertiesChanged(['highlight', 'role', 'checkedState', 'presence']);
    }

    protected render(onConnected: boolean): void {
        if (!this.defaultElement) {
            throw new Error('Default element is not defined in widget, render()');
        }

        //Handle highlight change
        if (onConnected || this.haveThisStationPropertiesChanged(['highlight'])) {
            this.defaultElement.classList.toggle(`highlighted-${this.uuid}`, Boolean(this.station?.highlight));
        }

        //Handle role and checkedState change
        //Note-When a station row is disconnected and reconnected, we need to reapply the opacity (thus the onConnected check)
        if (onConnected || this.haveThisStationPropertiesChanged(['role', 'checkedState', 'presence'])) {
            if (!this.station) {
                throw new Error('Station is null in StationRow widget, render()');
            }
            this.defaultElement.style.opacity = String(this.getStyling(this.station).opacity);
        }
    }

    protected onConnected(): void {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, onConnected()`);
            return;
        }
        this.cellTypes.forEach(type => {
            this.defaultElement?.appendChild(this.createCell(type));
        });
    }

    protected onDisconnected(): void {
        // Remove all cells from the row
        this.removeAllDefaultElementChildren();
    }

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('stationrow', StationRow, store);
    }
}

export class StationTable extends LiveNetElement {
    protected getTemplate(): string {
        return /*html*/ `
        <style>
            #${this.defaultElementId} {
            display: grid;
            width: 100%;
            height: 100%;
            
            /* center table */
            color: var(--hl-light)
            }
        </style>

        <div id="${this.defaultElementId}">
        </div>
        `;
    }

    // Helper function to create a station row
    private createStationRow(callSign: string, isLastNonCheckedOutAttendee = false): StationRow {
        const stationRow = document.createElement('hl-stationrow') as StationRow;
        stationRow.callSign = callSign;
        isLastNonCheckedOutAttendee && stationRow.classList.add('last-non-checkedout-attendee');
        return stationRow;
    }

    protected didMyDataSegmentChange(): boolean {
        return Boolean(
            this.store?.stations.getGroup('attendees')?.newData || this.store?.stations.getGroup('checked-out')?.newData
        );
    }

    protected onConnected(): void {}
    protected onDisconnected(): void {}

    protected render(onConnected: boolean): void {
        if (onConnected) {
            return;
        }

        if (this.store?.ready) {
            const fragment = this.createDocumentFragmentWithStations();
            this.replaceAllDefaultElementChildrenWith(fragment);
            this.scrollToLastNonCheckedOutAttendee();
        }
    }

    private createDocumentFragmentWithStations(): DocumentFragment {
        const fragment = document.createDocumentFragment();

        this.store?.stations.list.forEach(station =>
            fragment.appendChild(
                this.createStationRow(station.callSign, station.callSign === this.lastNonCheckedOutAttendee)
            )
        );

        return fragment;
    }

    private get lastNonCheckedOutAttendee(): string | undefined {
        const stations = this.store?.stations.list ?? [];
        const lastNonCheckedOutStation = stations.filter(station => station.checkedState !== false).pop();
        return lastNonCheckedOutStation?.callSign;
    }

    private scrollToLastNonCheckedOutAttendee(): void {
        if (!prefs.autoScrollStationTable) {
            return;
        }

        const lastNonCheckedOutAttendeeElement = this.defaultElement?.querySelector('.last-non-checkedout-attendee');
        if (lastNonCheckedOutAttendeeElement) {
            schedule(() => {
                lastNonCheckedOutAttendeeElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'end',
                    inline: 'nearest'
                });
            }, SchedulingMethod.NextAnimationFrame);
        }
    }

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('stationtable', StationTable, store);
    }
}

export class ButtonBar extends LiveNetElement {
    private tooltipInstances: Map<HTMLElement, bootstrap.Tooltip> = new Map();

    constructor() {
        super(EncapsulationMode.Open);
    }

    protected wrapWithButton(element: ButtonBarInsert): HTMLButtonElement {
        const button = document.createElement('button');
        button.classList.add('btn', 'btn-outline-primary', 'hasToolTip');
        button.type = 'button';
        button.setAttribute('data-bs-toggle', 'tooltip');
        button.setAttribute('data-bs-placement', 'bottom');
        button.setAttribute('title', element.toolTipText);
        button.setAttribute('aria-label', element.toolTipText);
        button.appendChild(element);

        const tooltipInstance = new window.bootstrap.Tooltip(button);

        button.addEventListener('click', event => {
            if (event.target === button) {
                event.stopPropagation(); // Stop the original click event from propagating
                const customEvent = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
                element.dispatchEvent(customEvent);
            }
            tooltipInstance.hide();
        });

        this.tooltipInstances.set(button, tooltipInstance);
        return button;
    }

    protected getTemplate(): string {
        return /*html*/ `
        <style>
            /* Add your component styles here */
             #${this.defaultElementId} {                
                height: 38px;
                padding: 0 8px;
                border-radius: 8px;
                border: 1px solid rgba(220, 131, 53, 0.2);
                color: inherit;
            }
            #${this.defaultElementId} .btn {
                background: transparent;
                border: none;
                border-radius: 0;
            }
            #${this.defaultElementId} .btn:not(:last-child) {
                border-right: 1px solid rgba(240, 238, 222, 0.15);
            }
            #${this.defaultElementId} .btn:hover {
                background: rgba(220, 131, 53, 0.15);
            }
        </style>
        <div id="${this.defaultElementId}" class="btn-group" role="group" aria-label="Station Actions">                
        </div>
    `;
    }

    protected didMyDataSegmentChange(): boolean {
        return this.store?.version === 1;
    }
    protected render(onConnected: boolean): void {
        if (onConnected) {
            const autoScrollElem = document.createElement('hl-autoscroll-insert') as AutoScrollInsert;
            const handElem = document.createElement('hl-hand-insert') as HandInsert;

            this.defaultElement?.appendChild(this.wrapWithButton(autoScrollElem));
            this.defaultElement?.appendChild(this.wrapWithButton(handElem));
        } else if (!this.store?.mainCache?.net.permanent) {
            //Initial data load
            //store at v1 (see didMyDataSegmentChange()):
            logger.debug('This net is not permanent, adding favorite insert button');
            const favElem = document.createElement('hl-fav-insert') as FavoriteInsert;
            favElem.npid = getNpid();
            this.defaultElement?.appendChild(this.wrapWithButton(favElem));
        }
    }

    protected onConnected(): void {}

    protected onDisconnected(): void {
        this.tooltipInstances.forEach(tooltipInstance => {
            tooltipInstance.dispose();
        });
        this.tooltipInstances.clear();
    }
    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('button-bar', ButtonBar, store);
    }
}

export class HandInsert extends LiveNetElement implements ButtonBarInsert {
    public toolTipText = 'Raise/Lower Your Hand';

    protected getTemplate(): string {
        return /*html*/ `
        <style>
        </style>

        <span id="${this.defaultElementId}"></span>
    `;
    }

    protected didMyDataSegmentChange(): boolean {
        return this.store?.stations.haveMyStationPropertiesChanged(['hand']) ?? false;
    }

    protected getIcon(): string {
        return this.store?.stations.mine?.hand ? '👊' : '✋';
    }

    private toggleState = (): void => {
        logger.debug('Toggling hand state');

        if (!this.isCallSignDefined()) {
            logger.warn('Call sign is not defined in HandInsert widget, toggleState()');
            return;
        }

        const callSign = this.store?.stations.mine?.callSign;

        if (!callSign) {
            logger.warn('Call sign is not defined in HandInsert widget, toggleState()');
            return;
        }

        this.updateHandState(callSign).catch(error => {
            logger.error(`Error updating hand state for ${callSign} in widget: ${error}`);
        });
    };

    private isCallSignDefined(): boolean {
        return !!this.store?.stations.mine?.callSign;
    }

    private async updateHandState(callSign: string): Promise<void> {
        try {
            await this.hand(callSign, null);
        } catch (error) {
            logger.error(`Error updating hand state for ${callSign} in widget: ${String(error)}`);
        }
    }

    protected render(): void {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, renderIcon()`);
            return;
        }

        if (!this.store?.ready) {
            return;
        }

        this.defaultElement.innerHTML = this.getIcon();
    }

    protected onConnected(): void {
        this.addEventListener('click', this.toggleState);
    }

    protected onDisconnected(): void {
        this.removeEventListener('click', this.toggleState);
    }

    public static async init(store: LiveNetReactiveStore): Promise<void> {
        await this.initElement('hand-insert', HandInsert, store);
    }
}
