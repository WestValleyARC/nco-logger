import { ReactiveStore, isStateGroupKey } from '#@client/lib/stores.js';
import { isEndPointResponseError, isNpid, isRstReportBase, isRstReportBaseWithTone, } from '#@client/types/commonTypesupport.js';
import { generateUUID, InteractionClient, AdminClient, FavoriteClient, UserAgentPersistentPreferences, getIconSvg, Looper, schedule, SchedulingMethod, getNpid, } from '#@client/lib/clientUtils.js';
import { createLogger } from '#@client/lib/logger.js';
import { serverInfo } from '#@client/lib/serverInfo.js';
const logger = createLogger('lib/widgets.ts');
const prefs = new UserAgentPersistentPreferences();
export class NetworkStatus extends HTMLElement {
    updateOnlineStatus = () => {
        document.body.classList.toggle('offline', !navigator.onLine);
    };
    connectedCallback() {
        this.updateOnlineStatus();
        window.addEventListener('online', this.updateOnlineStatus);
        window.addEventListener('offline', this.updateOnlineStatus);
    }
    disconnectedCallback() {
        window.removeEventListener('online', this.updateOnlineStatus);
        window.removeEventListener('offline', this.updateOnlineStatus);
    }
    static init() {
        customElements.define('hl-network-status', NetworkStatus);
    }
}
export class StatsTable extends HTMLElement {
    constructor() {
        super();
        try {
            const shadowRoot = this.attachShadow({ mode: 'closed' });
            shadowRoot.innerHTML = this.getTemplate();
        }
        catch (error) {
            logger.error('Failed to attach shadow root:', error);
        }
    }
    getTemplate() {
        return `
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
    static init() {
        customElements.define('hl-stats-table', StatsTable);
    }
}
var EncapsulationMode;
(function (EncapsulationMode) {
    EncapsulationMode["Open"] = "open";
    EncapsulationMode["Closed"] = "closed";
})(EncapsulationMode || (EncapsulationMode = {}));
export class HamLiveElement extends HTMLElement {
    encapsulate;
    _store = null;
    static storeMap = new Map();
    _shadowRoot = null;
    uuid = generateUUID();
    defaultElementId = `default-${this.uuid}`;
    defaultElement = null;
    static sharedStylesPromise = (async () => {
        let sheet = null;
        try {
            sheet = new CSSStyleSheet();
        }
        catch (err) {
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
            }
            catch (error) {
                if (error instanceof Error) {
                    logger.error(`Error importing shared styles: ${error.message}`);
                }
                else if (typeof error === 'string') {
                    logger.error(`Error importing shared styles: ${error}`);
                }
            }
        }
        if (!sheet) {
            throw new Error('CSSStyleSheet could not be created.');
        }
        return sheet;
    })();
    constructor(encapsulate = EncapsulationMode.Closed) {
        super();
        this.encapsulate = encapsulate;
    }
    set root(node) {
        if (this.encapsulate === EncapsulationMode.Closed) {
            this._shadowRoot = node instanceof ShadowRoot ? node : null;
        }
        else {
            this._shadowRoot = null;
        }
    }
    get root() {
        return this.encapsulate !== EncapsulationMode.Open ? this._shadowRoot : this;
    }
    async setupWidgetRoot() {
        if (this.encapsulate === EncapsulationMode.Closed) {
            this.root = this.attachShadow({ mode: 'closed' });
            this.root.adoptedStyleSheets = [await HamLiveElement.sharedStylesPromise];
        }
        else {
            logger.warn(`${this.constructor.name} using light DOM`);
            this.root = this;
        }
    }
    subscribeToStore(store) {
        store.subscribe(this);
        this._store = store;
    }
    unsubscribeFromStore() {
        if (this._store) {
            this._store.unsubscribe(this);
            this._store = null;
        }
        else {
            logger.warn('Store is already null, cannot unsubscribe');
        }
    }
    set store(store) {
        if (store) {
            this.subscribeToStore(store);
        }
        else {
            this.unsubscribeFromStore();
        }
    }
    get store() {
        return this._store;
    }
    async newData() {
        if (this.store?.mainCache) {
            if (this.didMyDataSegmentChange()) {
                logger.info(`My segment of the store changed in ${this.constructor.name} widget`);
                return this.render(false);
            }
        }
        else {
            throw new Error('Store is not defined in widget, newData()');
        }
    }
    set online(online) {
        if (this.defaultElement) {
            if (!online) {
                this.defaultElement.classList.add('offline');
                logger.debug(`${this.constructor.name} is offline`);
            }
            else {
                this.defaultElement.classList.remove('offline');
                logger.debug(`${this.constructor.name} is online`);
            }
        }
    }
    get online() {
        return !this.classList.contains('offline');
    }
    removeAllDefaultElementChildren() {
        if (!this.defaultElement) {
            logger.warn('Default element is not defined in widget, removeAllDefaultElementChildren()');
            return;
        }
        while (this.defaultElement.firstChild) {
            this.defaultElement.removeChild(this.defaultElement.firstChild);
        }
    }
    appendToDefaultElement(child) {
        if (!this.defaultElement) {
            logger.warn('Default element is not defined in widget, appendToDefaultElement()');
            return;
        }
        this.defaultElement.appendChild(child);
    }
    replaceAllDefaultElementChildrenWith(child) {
        this.removeAllDefaultElementChildren();
        this.appendToDefaultElement(child);
    }
    static async initElement(tagName, elementClass, store) {
        const prefixedTagName = `hl-${tagName}`;
        HamLiveElement.storeMap.set(prefixedTagName.toLowerCase(), store);
        window.customElements.define(prefixedTagName, elementClass);
        await customElements.whenDefined(prefixedTagName);
    }
    assignDefaultElement() {
        this.defaultElement = this.defaultElement || this.root.querySelector(`#${this.defaultElementId}`);
    }
    applyTemplate() {
        const template = document.createElement('template');
        template.innerHTML = this.getTemplate();
        if (template.content.querySelector(this.tagName.toLowerCase())) {
            throw new Error(`Recursive template detected in ${this.tagName}. A custom element should not contain its own tag in its template.`);
        }
        this.root.innerHTML = '';
        this.root.append(template.content.cloneNode(true));
    }
    async connectedCallback() {
        const store = HamLiveElement.storeMap.get(this.tagName.toLowerCase());
        if (!store) {
            throw new Error(`Store not assigned to ${this.tagName}`);
        }
        if (!(store instanceof ReactiveStore)) {
            throw new Error(`Store for ${this.tagName} is not an instance of ReactiveStore`);
        }
        await this.setupWidgetRoot();
        this.applyTemplate();
        this.assignDefaultElement();
        this.onConnected();
        this.store = store;
        this.render(true);
    }
    disconnectedCallback() {
        logger.debug(`${this.constructor.name} disconnected from the DOM`);
        this.store = null;
        this.onDisconnected();
    }
}
class BaseInsert extends HamLiveElement {
    getTemplate() {
        return `
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
    renderIcon() {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, renderIcon()`);
            return;
        }
        this.defaultElement.innerHTML = this.getIcon();
    }
    onConnected() {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, onConnected()`);
            return;
        }
        this.renderIcon();
        this.addEventListener('click', this.toggleState);
    }
    onDisconnected() {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, onDisconnected()`);
            return;
        }
        this.removeEventListener('click', this.toggleState);
    }
}
export class FavoriteInsert extends BaseInsert {
    toolTipText = 'Click to Follow/Unfollow';
    iconColor = 'var(--hl-tertiary)';
    state = false;
    _npid = null;
    fc = new FavoriteClient();
    getIcon() {
        return getIconSvg(this.state ? 'bi-star-fill' : 'bi-star');
    }
    toggleState = () => {
        this.store?.delayServerDataIngest();
        this.state = !this.state;
        this.renderIcon();
        if (this.npid)
            this.fc.set(this.npid, this.state);
    };
    set npid(npid) {
        if (!isNpid(npid)) {
            throw new Error('Invalid NPID in Favorite widget, set npid()');
        }
        this._npid = npid;
    }
    get npid() {
        return this._npid;
    }
    get storeDiffers() {
        if (!this.store?.ready) {
            logger.warn(`Store is not *yet ready in ${this.constructor.name}, storeDiffers()`);
            return false;
        }
        return this.npid ? this.store?.state(this.npid) !== this.state : false;
    }
    didMyDataSegmentChange() {
        return this.storeDiffers;
    }
    render() {
        if (this.store?.ready && this.storeDiffers) {
            this.state = !this.state;
        }
        this.renderIcon();
    }
    static async init(store) {
        await this.initElement('fav-insert', FavoriteInsert, store);
    }
}
export class AutoScrollInsert extends HTMLElement {
    toolTipText = 'Toggle Autoscroll';
    iconColor = 'var(--hl-secondary)';
    _shadowRoot = null;
    constructor() {
        super();
        try {
            this._shadowRoot = this.attachShadow({ mode: 'closed' });
            this._shadowRoot.innerHTML = this.getTemplate();
        }
        catch (error) {
            logger.error('Failed to attach shadow root:', error);
        }
    }
    handleIconClick = () => {
        prefs.autoScrollStationTable = !prefs.autoScrollStationTable;
        this.renderIcon();
    };
    getTemplate() {
        return `
            <style>
                svg {
                    color: ${this.iconColor};
                }
            </style>
            ${this.getIcon()}
        `;
    }
    getIcon() {
        return prefs.autoScrollStationTable ? getIconSvg('bi-chevron-double-down') : getIconSvg('bi-chevron-contract');
    }
    renderIcon() {
        if (!this._shadowRoot) {
            logger.warn(`Shadow root is not defined in ${this.constructor.name}, renderIcon()`);
            return;
        }
        this._shadowRoot.innerHTML = this.getTemplate();
    }
    connectedCallback() {
        this.addEventListener('click', this.handleIconClick);
    }
    disconnectedCallback() {
        this.removeEventListener('click', this.handleIconClick);
    }
    static init() {
        customElements.define('hl-autoscroll-insert', AutoScrollInsert);
    }
}
export class FavoritesList extends HamLiveElement {
    getTemplate() {
        return `
        <style>
            #${this.defaultElementId} {
                color: #f4f5f2;
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
                border: 1px solid rgba(155, 169, 178, 0.48);
                border-radius: 0.75rem;
                background: linear-gradient(150deg, rgba(11, 29, 41, 0.92), rgba(5, 15, 23, 0.98));
                box-shadow: 0 1.5rem 3rem rgba(0, 0, 0, 0.18);
                cursor: pointer;
                transition: border-color 140ms ease, outline-color 140ms ease, transform 140ms ease;
            }
            #${this.defaultElementId} .favorite-card:hover,
            #${this.defaultElementId} .favorite-card:focus-within {
                border-color: rgba(0, 200, 240, 0.58);
                outline: 1px solid rgba(0, 200, 240, 0.16);
                transform: translateY(-1px);
            }
            #${this.defaultElementId} .favorite-card-heading {
                display: flex;
                gap: 0.8rem;
                align-items: center;
                justify-content: space-between;
                padding-bottom: 0.65rem;
                border-bottom: 1px solid rgba(155, 169, 178, 0.32);
            }
            #${this.defaultElementId} .favorite-title {
                color: #f4f5f2;
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
                color: #84949b;
                border: 1px solid rgba(155, 169, 178, 0.18);
                border-radius: 0.35rem;
                background: rgba(26, 39, 48, 0.34);
                font-size: 0.7rem;
                font-weight: 700;
                white-space: nowrap;
            }
            #${this.defaultElementId} .favorite-status.is-live {
                color: #eaffef;
                border-color: rgba(67, 209, 122, 0.5);
                background: rgba(32, 128, 66, 0.72);
            }
            #${this.defaultElementId} .favorite-details {
                display: grid;
                gap: 0.25rem;
                padding-top: 0.65rem;
            }
            #${this.defaultElementId} .favorite-connection {
                margin: 0;
                color: #e2e8ea;
                font-size: 0.95rem;
            }
            #${this.defaultElementId} .favorite-mode-details {
                margin: 0;
                color: #9ba9b2;
                font-size: 0.83rem;
            }
            #${this.defaultElementId} .favorite-followers {
                margin: 0.3rem 0 0;
                color: #bdc8cc;
                font-size: 0.78rem;
            }
            #${this.defaultElementId} .favorites-empty {
                display: grid;
                min-height: 18rem;
                place-content: center;
                justify-items: center;
                padding: 2rem;
                border: 1px solid rgba(155, 169, 178, 0.48);
                border-radius: 0.75rem;
                background: linear-gradient(150deg, rgba(11, 29, 41, 0.92), rgba(5, 15, 23, 0.98));
                box-shadow: 0 1.5rem 3rem rgba(0, 0, 0, 0.18);
                text-align: center;
            }
            #${this.defaultElementId} .favorites-empty h2 {
                margin: 0 0 0.65rem;
                color: #f4f5f2;
                font-size: 1.35rem;
            }
            #${this.defaultElementId} .favorites-empty p {
                max-width: 30rem;
                margin: 0 0 1.25rem;
                color: #9ba9b2;
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
    didMyDataSegmentChange() {
        return this.store?.favoritesListChanged ?? false;
    }
    render(onConnected) {
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
    createFavoriteCard(net) {
        const { id, title, frequency, mode, modeDetails, followCount } = net;
        const isLive = Boolean(net.liveNet);
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
        if (isLive)
            status.classList.add('is-live');
        status.textContent = isLive ? 'ON AIR' : 'OFF AIR';
        const fav = document.createElement('hl-fav-insert');
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
        card.append(heading, details);
        return card;
    }
    createEmptyState() {
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
    onConnected() { }
    onDisconnected() { }
    static async init(store) {
        await this.initElement('favlist', FavoritesList, store);
    }
}
export class LiveNetElement extends HamLiveElement {
    ia = new InteractionClient();
    static ICONS = {
        netcontrol: 'bi-mic-fill',
        netlogger: 'bi-journal-check',
        netuser: 'bi-person-check',
        netrelay: 'bi-intersect',
        online: 'bi-eye-fill',
        default: ''
    };
    roleToIcon = {
        netcontrol: LiveNetElement.ICONS.netcontrol,
        netlogger: LiveNetElement.ICONS.netlogger,
        netuser: LiveNetElement.ICONS.netuser,
        netrelay: LiveNetElement.ICONS.netrelay
    };
    getStationIcon(station) {
        const { role, checkedState, presence } = station;
        if (checkedState === true) {
            return this.roleToIcon[role] || LiveNetElement.ICONS.default;
        }
        else if (checkedState === null) {
            return presence === 'online' ? LiveNetElement.ICONS.online : LiveNetElement.ICONS.default;
        }
        else {
            return LiveNetElement.ICONS.default;
        }
    }
    stationIsVisible(station) {
        return Boolean(this.getStationIcon(station));
    }
    async simpleInteractionWrapper(action, callSign, state) {
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
        }
        catch (error) {
            if (error instanceof Error) {
                logger.error(`Error updating ${action} for ${callSign} in ${this.constructor.name} widget: ${error.message}`);
            }
            logger.info(`Reverting ${action} for ${callSign} in ${this.constructor.name} widget`);
            this.store[action](callSign, null);
        }
        return ret;
    }
    async highlight(callSign, state) {
        return (await this.simpleInteractionWrapper('highlight', callSign, state)) ?? false;
    }
    async hand(callSign, state) {
        return (await this.simpleInteractionWrapper('hand', callSign, state)) ?? false;
    }
    async checkState(callSign, state) {
        return this.simpleInteractionWrapper('checkState', callSign, state);
    }
    async sigReport(callSign, report) {
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
        await this.ia.sigReport(callSign, rstReport);
    }
}
export class StateGroupReport extends LiveNetElement {
    isSettingGroup = false;
    static get observedAttributes() {
        return ['group'];
    }
    attributeChangedCallback(name, _oldValue, newValue) {
        if (name === 'group' && newValue) {
            this.handleGroupAttributeChange(newValue);
        }
    }
    handleGroupAttributeChange(newValue) {
        if (isStateGroupKey(newValue)) {
            this.group = newValue;
        }
        else {
            this.logInvalidGroupValue(newValue);
        }
    }
    logInvalidGroupValue(value) {
        logger.warn(`Invalid group attribute value: ${value} in ${this.constructor.name}`);
    }
    set group(value) {
        if (this.isSettingGroup)
            return;
        if (isStateGroupKey(value)) {
            this.isSettingGroup = true;
            this.setAttribute('group', value);
            this.isSettingGroup = false;
        }
        else {
            this.logInvalidGroupValue(value);
        }
    }
    get group() {
        return this.getAttribute('group');
    }
    getTemplate() {
        return `
        <style>
        </style>
        <span id="${this.defaultElementId}"></span>
    `;
    }
    didMyDataSegmentChange() {
        return Boolean(this.group && this.store?.stations.getGroup(this.group)?.newData);
    }
    render(onConnected) {
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
    }
    onConnected() {
    }
    onDisconnected() {
    }
}
export class StateList extends StateGroupReport {
    getReport(stateGroup) {
        return Array.from(stateGroup).join(', ');
    }
    static async init(store) {
        await this.initElement('state-list', StateList, store);
    }
}
export class StateCount extends StateGroupReport {
    getReport(stateGroup) {
        return stateGroup.size.toString();
    }
    static async init(store) {
        await this.initElement('state-count', StateCount, store);
    }
}
export class NetNotes extends LiveNetElement {
    tooltip = null;
    bsCollapse = null;
    priorNotes = '';
    priorTitle = '';
    constructor() {
        super(EncapsulationMode.Open);
    }
    getTemplate() {
        return `
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
    didMyDataSegmentChange() {
        return this.hasDataChanged('notes', this.priorNotes) || this.hasDataChanged('title', this.priorTitle);
    }
    render() {
        if (!this.defaultElement) {
            logger.warn('Default element is not defined in render()');
            return;
        }
        this.hasDataChanged('title', this.priorTitle, true) && this.updateTitle();
        this.hasDataChanged('notes', this.priorNotes, true) && this.updateNotes();
    }
    onConnected() {
        if (!this.defaultElement) {
            logger.warn('Default element is not defined in onConnected()');
            return;
        }
        this.tooltip = new window.bootstrap.Tooltip(this.defaultElement);
    }
    onDisconnected() {
        this.tooltip?.dispose();
        this.tooltip = null;
    }
    static async init(store) {
        await this.initElement('netnotes', NetNotes, store);
    }
    hasDataChanged(key, priorValue, overwritePrior = false) {
        if (!this.store?.mainCache) {
            return true;
        }
        const currentValue = this.store.mainCache.net[key];
        const haveChanged = currentValue !== priorValue;
        if (overwritePrior) {
            if (key === 'notes') {
                this.priorNotes = currentValue;
            }
            else {
                this.priorTitle = currentValue;
            }
        }
        return haveChanged;
    }
    updateTitle() {
        const accordionTitleElem = this.defaultElement?.querySelector('#accordion-title');
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
    updateNotes() {
        const notesContentElem = this.defaultElement?.querySelector('#notes-content');
        const accordionContainerElem = this.defaultElement?.querySelector('#accordion-container');
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
    priorNetDetails = null;
    getTemplate() {
        return `
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
    get netInfoHasChanged() {
        if (!this.store?.mainCache || !this.priorNetDetails) {
            this.priorNetDetails = this.store?.mainCache?.net ?? null;
            logger.debug(`Apparent first run of ${this.constructor.name}, netInfoHasChanged(). Returning true`);
            return true;
        }
        const hasChanged = this.store.cachePropertyHasChanged('net', this.priorNetDetails);
        if (hasChanged)
            this.priorNetDetails = this.store?.mainCache?.net ?? null;
        return hasChanged;
    }
    didMyDataSegmentChange() {
        return this.netInfoHasChanged;
    }
    render() {
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
    buildFrequencyAndTimeString(net) {
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
            approximateStartTime = approximateStartTime.replace(/^0/, '');
            freqAndTime += ` @ ${approximateStartTime}`;
        }
        return freqAndTime;
    }
    calculateApproximateStartTime(createdAt, countdownTimer) {
        const startTime = new Date(createdAt);
        startTime.setMinutes(startTime.getMinutes() + countdownTimer);
        startTime.setSeconds(0, 0);
        return startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
    onConnected() { }
    onDisconnected() { }
    static async init(store) {
        await this.initElement('netinfo', NetDetails, store);
    }
}
export class NetStartProgress extends LiveNetElement {
    defaultIntervalMs = 500;
    _width = 0;
    _state = 'PENDING_START';
    mainLooper = new Looper(this.defaultIntervalMs, this.constructor.name);
    constructor() {
        super(EncapsulationMode.Open);
    }
    set width(value) {
        if (value < 0 || value > 100) {
            throw new Error('Width must be between 0 and 100');
        }
        this._width = value;
        this.renderBarWidth(value);
    }
    get width() {
        return this._width;
    }
    set state(value) {
        this._state = value;
        this.renderBarStyle();
    }
    get state() {
        return this._state;
    }
    gracePeriodPercentComplete(createdAt, gracePeriodMinutes, started = false) {
        if (started || gracePeriodMinutes === 0) {
            return 100;
        }
        const elapsed = (Date.now() - createdAt.getTime()) / 1000 / 60;
        return Math.min(Math.floor((elapsed / gracePeriodMinutes) * 100), 100);
    }
    getTemplate() {
        return `
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
    renderBarWidth(value) {
        this.root.querySelector('.progress-bar')?.setAttribute('style', `width: ${value}%`);
    }
    renderBarStyle() {
        const progressBar = this.root.querySelector('.progress-bar');
        if (!progressBar) {
            throw new Error('Progress bar element is not defined in widget, renderBarStyle()');
        }
        progressBar.className = 'progress-bar';
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
    didMyDataSegmentChange() {
        return this.store?.mainCache?.net?.started ?? false;
    }
    render() {
        this.renderBarStyle();
    }
    startMainLooper() {
        this.mainLooper.start(async (loopStats) => {
            const { ttlMs, net } = this.store?.mainCache ?? {};
            const { countdownTimer: gracePeriodMinutes, started } = net ?? {};
            let { createdAt } = this.store?.mainCache?.net ?? {};
            if (gracePeriodMinutes === undefined || !createdAt)
                return;
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
            }
            else if (pct === 100) {
                const slowIntervalMs = (ttlMs ?? 10000) * 2;
                if (this.state === 'PENDING_START') {
                    if (loopStats.interval === slowIntervalMs) {
                        this.state = 'ABNORMAL_START';
                        this.mainLooper.setInterval(this.defaultIntervalMs);
                    }
                    else {
                        this.mainLooper.setInterval(slowIntervalMs);
                    }
                }
            }
            this.width = pct;
        });
    }
    onConnected() {
        this.startMainLooper();
    }
    onDisconnected() { }
    static async init(store) {
        await this.initElement('netstart-progress', NetStartProgress, store);
    }
}
export class NetControlMember extends LiveNetElement {
    cmd = new AdminClient();
    didMyStatusChange() {
        try {
            return this.store?.stations.haveMyStationPropertiesChanged(['role', 'checkedState']) ?? false;
        }
        catch (error) {
            if (error instanceof Error) {
                logger.warn(error.message);
            }
            return false;
        }
    }
    get iAmCheckedInAdmin() {
        let iAmAdmin;
        let iAmCheckedIn;
        try {
            ({ iAmAdmin, iAmCheckedIn } = this.store?.stations ?? { iAmAdmin: false, iAmCheckedIn: false });
        }
        catch (error) {
            if (error instanceof Error)
                logger.warn(`In widget ${this.constructor.name} : iAmCheckedInAdmin(): ${error.message}`);
            return false;
        }
        return iAmAdmin && iAmCheckedIn;
    }
}
export class NetControlUsage extends NetControlMember {
    getTemplate() {
        return `
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
    collapse(value, save = true) {
        if (save)
            prefs.usageCollapsed = value;
        if (value) {
            this.root.querySelectorAll('.hideOnCollapse').forEach(element => element.classList.add('d-none'));
            this.root.querySelectorAll('.hideOnExpand').forEach(element => element.classList.remove('d-none'));
        }
        else {
            this.root.querySelectorAll('.hideOnCollapse').forEach(element => element.classList.remove('d-none'));
            this.root.querySelectorAll('.hideOnExpand').forEach(element => element.classList.add('d-none'));
        }
    }
    toggleExpandCollapse = () => {
        this.collapse(!prefs.usageCollapsed);
    };
    handleCommandHelpClick = () => {
        const { cmdHelpUrl } = serverInfo;
        if (cmdHelpUrl) {
            window.open(cmdHelpUrl, '_blank');
        }
    };
    didMyDataSegmentChange() {
        return this.didMyStatusChange();
    }
    formatUsage(text) {
        const commands = text.split(', ');
        const formattedCommands = commands.map(command => {
            const [label, usage] = command.split(': ');
            const formattedLabel = `<span class="command-label">${label}</span>`;
            if (!usage) {
                return formattedLabel;
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
    render() {
        this.cmd
            .usageText()
            .then(text => {
            const usageTextElement = this.root.querySelector('.usage-text');
            if (!usageTextElement) {
                throw new Error('Usage text element is not defined in widget, render()');
            }
            usageTextElement.innerHTML = this.formatUsage(text);
        })
            .catch(error => {
            logger.error(`Error getting command list in widget: ${error}`);
        });
    }
    onConnected() {
        if (window.innerWidth < 768) {
            this.collapse(true, false);
        }
        else {
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
    onDisconnected() {
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
    static async init(store) {
        await this.initElement('netcontrol-usage', NetControlUsage, store);
    }
}
export class NetControlForm extends NetControlMember {
    getTemplate() {
        return `
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
    didMyDataSegmentChange() {
        return this.didMyStatusChange();
    }
    render(onConnected) {
        if (onConnected) {
            return;
        }
        const input = this.root.querySelector('#cmdLine');
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
        }
        else {
            input.placeholder = 'X>';
            input.disabled = true;
        }
    }
    applyFocus() {
        const input = this.root.querySelector('#cmdLine');
        if (!input) {
            throw new Error('Input element is not defined in widget, focus()');
        }
        input.focus();
    }
    respond(response, type) {
        const responseText = this.root.querySelector('.response-text');
        if (!responseText) {
            throw new Error('Response element is not defined in widget, respond()');
        }
        if (type === 'error') {
            responseText.setAttribute('aria-live', 'assertive');
        }
        else {
            responseText.setAttribute('aria-live', 'polite');
        }
        responseText.textContent = response;
        const overlay = this.root.querySelector('.overlay');
        if (!overlay) {
            throw new Error('Overlay element is not defined in widget, respond()');
        }
        overlay.classList.remove('error', 'success');
        if (type === 'error') {
            overlay.classList.add('error');
        }
        else if (type === 'success') {
            overlay.classList.add('success');
        }
    }
    onConnected() {
        this.defaultElement?.querySelector('form')?.addEventListener('submit', e => {
            e.preventDefault();
            const input = this.defaultElement?.querySelector('input');
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
                }
                else {
                    if (error instanceof Error) {
                        if (error.message === 'Failed to fetch') {
                            this.respond('Network error', 'error');
                        }
                        else {
                            this.respond(error.message, 'error');
                        }
                    }
                    logger.error(`Error executing command in widget: ${error}`);
                }
            });
        });
    }
    onDisconnected() { }
    static async init(store) {
        await this.initElement('netcontrol-form', NetControlForm, store);
    }
}
export class NetControlPanel extends NetControlMember {
    getTemplate() {
        return `
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
    open() {
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
    close() {
        if (!this.isOpen) {
            return;
        }
        if (!this.defaultElement) {
            throw new Error('Default element is not defined in widget, close()');
        }
        this.defaultElement.classList.remove('visible');
        this.defaultElement.addEventListener('transitionend', () => {
            if (!this.defaultElement) {
                throw new Error('Default element is not defined in widget, close()');
            }
            this.defaultElement.style.display = 'none';
        }, { once: true });
    }
    get isOpen() {
        if (!this.defaultElement) {
            throw new Error('Default element is not defined in widget, isOpen()');
        }
        return this.defaultElement.classList.contains('visible');
    }
    toggle() {
        if (this.isOpen) {
            this.close();
        }
        else {
            this.open();
        }
    }
    didMyDataSegmentChange() {
        return this.didMyStatusChange();
    }
    render(onConnected) {
        if (onConnected) {
            return;
        }
        if (this.iAmCheckedInAdmin) {
            this.open();
        }
        else {
            this.close();
        }
    }
    applyFocus() {
        const form = this.defaultElement?.querySelector('hl-netcontrol-form');
        if (!form) {
            throw new Error('Form element is not defined in widget, applyFocus()');
        }
        form.applyFocus();
    }
    onConnected() {
        this.defaultElement?.querySelector('.close-button')?.addEventListener('click', () => this.close());
    }
    onDisconnected() {
        this.defaultElement?.querySelector('.close-button')?.removeEventListener('click', () => this.close());
    }
    static async init(store) {
        await this.initElement('netcontrol-panel', NetControlPanel, store);
    }
}
export class NetControlButton extends NetControlMember {
    netControlPanelElement = null;
    label = ['Net', 'Logger', 'Relay', 'User'];
    constructor() {
        super(EncapsulationMode.Open);
    }
    getTemplate() {
        return `
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
    didMyDataSegmentChange() {
        return this.didMyStatusChange();
    }
    render(onConnected) {
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
            logger.warn(`My station is not defined in ${this.constructor.name}, render(). Waiting for initial response from /presence?`);
            return;
        }
        if (!this.netControlPanelElement) {
            this.netControlPanelElement = document.querySelector('hl-netcontrol-panel');
        }
        if (this.iAmCheckedInAdmin) {
            this.defaultElement.textContent = `${this.label[mine.level]} Control Panel`;
            this.defaultElement.classList.remove('d-none');
        }
        else {
            this.defaultElement.classList.add('d-none');
        }
    }
    handleClick = () => {
        if (!this.netControlPanelElement) {
            throw new Error('Net Control Panel is not defined in widget, render()');
        }
        this.netControlPanelElement.toggle();
    };
    onConnected() {
        this.addEventListener('click', this.handleClick);
    }
    onDisconnected() {
        this.removeEventListener('click', this.handleClick);
    }
    static async init(store) {
        await this.initElement('netcontrol-button', NetControlButton, store);
    }
}
export class RoleStats extends LiveNetElement {
    getTemplate() {
        return `
        <style>
            /* Add your component styles here */
        </style>
        <em id="${this.defaultElementId}">
            Count ${this.store?.stations.getGroup('checked-in-ever')?.size ?? 0}
                
        </em>
    `;
    }
    didMyDataSegmentChange() {
        return this.store?.stations.getGroup('checked-in-ever')?.newData ?? false;
    }
    render() {
        logger.debug('RoleStats widget: render()');
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, render()`);
            return;
        }
        this.defaultElement.textContent = `Count ${this.store?.stations.getGroup('checked-in-ever')?.size ?? 0}`;
    }
    onConnected() { }
    onDisconnected() { }
    static async init(store) {
        await this.initElement('rolestats', RoleStats, store);
    }
}
export class StationTableMember extends LiveNetElement {
    callSign = null;
    static styleCache = new Map();
    set defaultElementCursorisPointer(pointer) {
        if (!this.defaultElement) {
            throw new Error('Default element is not defined in widget, defaultElementCursorisPointer()');
        }
        this.defaultElement.style.cursor = pointer ? 'pointer' : 'default';
    }
    handleClickType = (type) => (e) => {
        this.handleClick(type, e);
    };
    highlightClick = this.handleClickType('highlight');
    handClick = this.handleClickType('hand');
    checkStateClick = this.handleClickType('checkState');
    handleClick = (type, e) => {
        if (!this.callSign) {
            throw new Error('Call sign is not defined in widget, handleClick()');
        }
        if (!this.store) {
            throw new Error('Store is not defined in widget, handleClick()');
        }
        const target = e.target;
        logger.debug(`click event on target: ${target.tagName} with class: ${target.className} in widget: ${this.constructor.name}`);
        const isCheckState = type === 'checkState';
        const isHighlightOrCheckState = type === 'highlight' || isCheckState;
        const isHand = type === 'hand';
        if (isCheckState) {
            if (!this.iHaveMorePrivs) {
                logger.warn('Cannot check out station with equal or greater privileges');
                return;
            }
            if (!this.iAmStation) {
                e.preventDefault();
            }
            else {
                logger.warn('Cannot check out self');
                return;
            }
            e.preventDefault();
        }
        const { iAmCheckedIn, iAmAdmin } = this.store.stations;
        const theyAreCheckedIn = this.station?.checkedState === true;
        if (isHighlightOrCheckState && iAmCheckedIn && iAmAdmin && theyAreCheckedIn) {
            const param = isCheckState ? false : null;
            this[type](this.callSign, param).catch(error => {
                logger.error(`Error updating ${type} state for ${this.callSign} in widget: ${error}`);
            });
        }
        else if (isHand && ((iAmCheckedIn && iAmAdmin) || this.iAmStation)) {
            this[type](this.callSign, null).catch(error => {
                logger.error(`Error updating ${type} state for ${this.callSign} in widget: ${error}`);
            });
        }
    };
    get iAmStation() {
        if (!this.callSign) {
            throw new Error('Call sign is not defined in widget, iAmStation()');
        }
        return this.callSign === this.store?.stations.mine?.callSign;
    }
    get iHaveMorePrivs() {
        if (!this.station || !this.store?.stations.mine) {
            throw new Error('Station or mine is not defined in widget, iHaveMorePrivs()');
        }
        return this.store.stations.mine.level < this.station.level;
    }
    getStationColor(station) {
        const { role, checkedState, presence } = station;
        if (checkedState === null) {
            return presence === 'online' ? 'light' : 'danger';
        }
        if (checkedState === false) {
            return 'light';
        }
        const roleColorMap = {
            netuser: 'primary',
            netcontrol: 'secondary',
            netlogger: 'tertiary',
            netrelay: 'success',
            default: undefined
        };
        return roleColorMap[role] || 'danger';
    }
    stationIsBold(station) {
        return typeof station.checkedState === 'boolean';
    }
    getStationOpacity(station) {
        return station.checkedState === false ? 0.5 : 1;
    }
    stationIsItalicized(station) {
        return station.checkedState !== true;
    }
    stationIsLinethrough(station) {
        return station.checkedState === false;
    }
    getStyling(station) {
        const { role, presence, checkedState } = station;
        const styleKey = `${role}-${presence}-${checkedState}`;
        if (StationTableMember.styleCache.has(styleKey)) {
            return StationTableMember.styleCache.get(styleKey);
        }
        const styling = {
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
    applyStyling(element, styling) {
        if (!element.style) {
            throw new Error('The element does not have a style tag in widget, applyStyling()');
        }
        element.style.fontWeight = styling.fontWeight;
        element.style.color = styling.color;
        element.style.fontStyle = styling.fontStyle;
        element.style.textDecoration = styling.textDecoration;
    }
    haveThisStationPropertiesChanged(properties) {
        if (!this.callSign) {
            throw new Error('Call sign is not defined in widget, havePropertiesChanged()');
        }
        return this.store?.stations.havePropertiesChanged(properties, this.callSign) ?? false;
    }
    get station() {
        if (!this.callSign) {
            throw new Error('Call sign is not *yet defined in widget, getThisStation()');
        }
        if (!this.store) {
            logger.warn(`Store is not defined in ${this.constructor.name}, getThisStation()`);
            return null;
        }
        return this.store.stations.get(this.callSign);
    }
    get stationPrior() {
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
    defaultPhoto = '/img/marconi_88x96.jpg';
    get photoUrl() {
        return this.store?.ready ? (this.station?.photo ?? this.defaultPhoto) : this.defaultPhoto;
    }
    get isOnline() {
        return this.station?.presence === 'online';
    }
    getTemplate() {
        return `
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
    didMyDataSegmentChange() {
        return this.haveThisStationPropertiesChanged(['photo', 'hand', 'presence']);
    }
    render() {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, render()`);
            return;
        }
        this.defaultElement.querySelector('img').src = this.photoUrl;
        this.defaultElement.querySelector('.hand-icon').classList.toggle('hand-is-down', !this.station?.hand);
        const onlineIconElement = this.defaultElement.querySelector('.onlinestatus-icon.online');
        const offlineIconElement = this.defaultElement.querySelector('.onlinestatus-icon.offline');
        if (!onlineIconElement || !offlineIconElement) {
            logger.warn(`Online status elements are not defined in ${this.constructor.name}, render()`);
            return;
        }
        onlineIconElement.classList.toggle('visible', this.isOnline);
        offlineIconElement.classList.toggle('visible', !this.isOnline);
        this.defaultElementCursorisPointer = Boolean(this.iAmStation || (this.store?.stations.iAmAdmin && this.store.stations.iAmCheckedIn));
    }
    onConnected() {
        this.addEventListener('click', this.handClick);
    }
    onDisconnected() {
        this.removeEventListener('click', this.handClick);
    }
    static async init(store) {
        await this.initElement('avatarcell', AvatarCell, store);
    }
}
export class CallSignCell extends StationTableMember {
    getTemplate = () => {
        return `
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
    didMyDataSegmentChange() {
        return this.haveThisStationPropertiesChanged(['role', 'callSign', 'checkedState', 'presence']);
    }
    render() {
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
        this.defaultElementCursorisPointer = Boolean(this.store?.stations.iAmCheckedIn && this.store?.stations.iAmAdmin && this.station?.checkedState);
    }
    onConnected() {
        this.addEventListener('click', this.highlightClick);
        this.addEventListener('contextmenu', this.checkStateClick);
    }
    onDisconnected() {
        this.removeEventListener('click', this.highlightClick);
        this.removeEventListener('contextmenu', this.checkStateClick);
    }
    static async init(store) {
        await this.initElement('callsigncell', CallSignCell, store);
    }
}
export class NameCell extends StationTableMember {
    tooltip = null;
    getTemplate() {
        return `
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
    didMyDataSegmentChange() {
        return this.haveThisStationPropertiesChanged(['location', 'displayName', 'role', 'checkedState', 'presence']);
    }
    refreshTooltip() {
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
    render(onConnected) {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, render()`);
            return;
        }
        if (onConnected || this.haveThisStationPropertiesChanged(['location'])) {
            this.refreshTooltip();
        }
        if (onConnected || this.haveThisStationPropertiesChanged(['displayName'])) {
            this.defaultElement.textContent = `${this.station?.displayName ?? ''}`;
        }
        if (onConnected || this.haveThisStationPropertiesChanged(['role', 'checkedState', 'presence'])) {
            if (!this.station) {
                throw new Error('Station is null in NameCell widget, render()');
            }
            this.applyStyling(this.defaultElement, this.getStyling(this.station));
        }
    }
    onConnected() { }
    onDisconnected() {
        this.cleanupTooltip();
    }
    cleanupTooltip() {
        this.tooltip?.dispose();
        this.tooltip = null;
    }
    static async init(store) {
        await this.initElement('namecell', NameCell, store);
    }
}
export class SigReportCell extends StationTableMember {
    lastSigReportType = null;
    restrictedSigReports = null;
    getTemplate() {
        return `
        <style>
            ${this.getInputStyles()}
        </style>
        <form id="${this.defaultElementId}">
            <input type="text" placeholder="..." size="4" aria-label="Input Signal Report">
        </form>
        `;
    }
    getInputStyles() {
        return `
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
    haveNetSigReportAttribsChanged() {
        const sigReportType = this.store?.mainCache?.net.sigReportType ?? null;
        const restrictedSigReports = this.store?.mainCache?.net.restrictedSigReports ?? null;
        const hasChanged = sigReportType !== this.lastSigReportType || restrictedSigReports !== this.restrictedSigReports;
        this.lastSigReportType = sigReportType;
        this.restrictedSigReports = restrictedSigReports;
        return hasChanged;
    }
    updateVisibility() {
        if (!this.defaultElement) {
            throw new Error('Default element is not defined in widget, updateVisibility()');
        }
        this.style.display = this.store?.mainCache?.net.sigReportType === null ? 'none' : 'block';
    }
    updateInputPlaceholderValue(input) {
        input.placeholder = this.store?.mainCache?.net.sigReportType ?? '...';
    }
    indicateInputValueChange() {
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
    updateInputValue(input, value) {
        input.value = value ?? this.station?.averageSigReport ?? '';
    }
    updateInputState(input) {
        const restrictedSigReports = this.store?.mainCache?.net.restrictedSigReports ?? false;
        const isNetControl = this.store?.stations.mine?.role === 'netcontrol';
        const isCheckedStateFalse = this.station?.checkedState === false;
        input.disabled =
            (restrictedSigReports && !isNetControl) ||
                isCheckedStateFalse ||
                this.store?.mainCache?.net.sigReportType === null;
    }
    updateInputBorderStyle(input, applyTemp) {
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
        }
        else {
            if (!this.station) {
                throw new Error('Station is null in SigReportCell widget, updateInputBorderStyle()');
            }
            borderStyle = this.station.averageSigReport ? borderStyles.hasSigReport : borderStyles.default;
            if (this.station.checkedState === false)
                borderStyle = borderStyles.default;
        }
        input.style.borderColor = borderStyle.color;
        input.style.borderStyle = borderStyle.style;
        input.style.borderWidth = borderStyle.width;
    }
    handleInputFocus = (e) => {
        const input = e.target;
        input.style.borderColor = 'var(--hl-light)';
        input.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
        input.style.borderWidth = '1px';
        input.style.outline = 'none';
        this.updateInputValue(input, '');
    };
    handleInputBlur = (e) => {
        const input = e.target;
        this.updateInputBorderStyle(input);
        this.updateInputPlaceholderValue(input);
        this.updateInputValue(input);
    };
    handleSubmit = (e) => {
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
    getInputElement() {
        const input = this.defaultElement?.querySelector('input');
        if (!input) {
            throw new Error('Input element is not defined in widget');
        }
        return input;
    }
    didMyDataSegmentChange() {
        return (this.haveNetSigReportAttribsChanged() ||
            this.haveThisStationPropertiesChanged(['checkedState', 'averageSigReport']));
    }
    render() {
        const input = this.getInputElement();
        this.updateInputPlaceholderValue(input);
        this.updateInputState(input);
        this.updateInputBorderStyle(input);
        this.updateInputValue(input);
        this.updateVisibility();
        this.indicateInputValueChange();
    }
    onConnected() {
        const input = this.getInputElement();
        input.addEventListener('focus', this.handleInputFocus);
        input.addEventListener('blur', this.handleInputBlur);
        this.defaultElement?.addEventListener('submit', this.handleSubmit);
    }
    onDisconnected() {
        const input = this.getInputElement();
        input.removeEventListener('focus', this.handleInputFocus);
        input.removeEventListener('blur', this.handleInputBlur);
        this.defaultElement?.removeEventListener('submit', this.handleSubmit);
    }
    static async init(store) {
        await this.initElement('sigreportcell', SigReportCell, store);
    }
}
export class StationRow extends StationTableMember {
    cellTypes = ['avatar', 'callsign', 'name', 'sigreport'];
    getTemplate() {
        return `
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
    createCell(type) {
        const cell = document.createElement(`hl-${type}cell`);
        cell.callSign = this.callSign || '';
        return cell;
    }
    didMyDataSegmentChange() {
        return this.haveThisStationPropertiesChanged(['highlight', 'role', 'checkedState', 'presence']);
    }
    render(onConnected) {
        if (!this.defaultElement) {
            throw new Error('Default element is not defined in widget, render()');
        }
        if (onConnected || this.haveThisStationPropertiesChanged(['highlight'])) {
            this.defaultElement.classList.toggle(`highlighted-${this.uuid}`, Boolean(this.station?.highlight));
        }
        if (onConnected || this.haveThisStationPropertiesChanged(['role', 'checkedState', 'presence'])) {
            if (!this.station) {
                throw new Error('Station is null in StationRow widget, render()');
            }
            this.defaultElement.style.opacity = String(this.getStyling(this.station).opacity);
        }
    }
    onConnected() {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, onConnected()`);
            return;
        }
        this.cellTypes.forEach(type => {
            this.defaultElement?.appendChild(this.createCell(type));
        });
    }
    onDisconnected() {
        this.removeAllDefaultElementChildren();
    }
    static async init(store) {
        await this.initElement('stationrow', StationRow, store);
    }
}
export class StationTable extends LiveNetElement {
    getTemplate() {
        return `
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
    createStationRow(callSign, isLastNonCheckedOutAttendee = false) {
        const stationRow = document.createElement('hl-stationrow');
        stationRow.callSign = callSign;
        isLastNonCheckedOutAttendee && stationRow.classList.add('last-non-checkedout-attendee');
        return stationRow;
    }
    didMyDataSegmentChange() {
        return Boolean(this.store?.stations.getGroup('attendees')?.newData || this.store?.stations.getGroup('checked-out')?.newData);
    }
    onConnected() { }
    onDisconnected() { }
    render(onConnected) {
        if (onConnected) {
            return;
        }
        if (this.store?.ready) {
            const fragment = this.createDocumentFragmentWithStations();
            this.replaceAllDefaultElementChildrenWith(fragment);
            this.scrollToLastNonCheckedOutAttendee();
        }
    }
    createDocumentFragmentWithStations() {
        const fragment = document.createDocumentFragment();
        this.store?.stations.list.forEach(station => fragment.appendChild(this.createStationRow(station.callSign, station.callSign === this.lastNonCheckedOutAttendee)));
        return fragment;
    }
    get lastNonCheckedOutAttendee() {
        const stations = this.store?.stations.list ?? [];
        const lastNonCheckedOutStation = stations.filter(station => station.checkedState !== false).pop();
        return lastNonCheckedOutStation?.callSign;
    }
    scrollToLastNonCheckedOutAttendee() {
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
    static async init(store) {
        await this.initElement('stationtable', StationTable, store);
    }
}
export class ButtonBar extends LiveNetElement {
    tooltipInstances = new Map();
    constructor() {
        super(EncapsulationMode.Open);
    }
    wrapWithButton(element) {
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
                event.stopPropagation();
                const customEvent = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
                element.dispatchEvent(customEvent);
            }
            tooltipInstance.hide();
        });
        this.tooltipInstances.set(button, tooltipInstance);
        return button;
    }
    getTemplate() {
        return `
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
    didMyDataSegmentChange() {
        return this.store?.version === 1;
    }
    render(onConnected) {
        if (onConnected) {
            const autoScrollElem = document.createElement('hl-autoscroll-insert');
            const handElem = document.createElement('hl-hand-insert');
            this.defaultElement?.appendChild(this.wrapWithButton(autoScrollElem));
            this.defaultElement?.appendChild(this.wrapWithButton(handElem));
        }
        else if (!this.store?.mainCache?.net.permanent) {
            logger.debug('This net is not permanent, adding favorite insert button');
            const favElem = document.createElement('hl-fav-insert');
            favElem.npid = getNpid();
            this.defaultElement?.appendChild(this.wrapWithButton(favElem));
        }
    }
    onConnected() { }
    onDisconnected() {
        this.tooltipInstances.forEach(tooltipInstance => {
            tooltipInstance.dispose();
        });
        this.tooltipInstances.clear();
    }
    static async init(store) {
        await this.initElement('button-bar', ButtonBar, store);
    }
}
export class HandInsert extends LiveNetElement {
    toolTipText = 'Raise/Lower Your Hand';
    getTemplate() {
        return `
        <style>
        </style>

        <span id="${this.defaultElementId}"></span>
    `;
    }
    didMyDataSegmentChange() {
        return this.store?.stations.haveMyStationPropertiesChanged(['hand']) ?? false;
    }
    getIcon() {
        return this.store?.stations.mine?.hand ? '👊' : '✋';
    }
    toggleState = () => {
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
    isCallSignDefined() {
        return !!this.store?.stations.mine?.callSign;
    }
    async updateHandState(callSign) {
        try {
            await this.hand(callSign, null);
        }
        catch (error) {
            logger.error(`Error updating hand state for ${callSign} in widget: ${String(error)}`);
        }
    }
    render() {
        if (!this.defaultElement) {
            logger.warn(`Default element is not defined in ${this.constructor.name}, renderIcon()`);
            return;
        }
        if (!this.store?.ready) {
            return;
        }
        this.defaultElement.innerHTML = this.getIcon();
    }
    onConnected() {
        this.addEventListener('click', this.toggleState);
    }
    onDisconnected() {
        this.removeEventListener('click', this.toggleState);
    }
    static async init(store) {
        await this.initElement('hand-insert', HandInsert, store);
    }
}
//# sourceMappingURL=widgets.js.map