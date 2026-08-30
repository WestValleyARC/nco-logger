(() => {
    "use strict";
    const POLL_MS = 3000;
    const VERSION = "1.1.0-alpha.1";
    const BUG_REPORT_URL = `mailto:ke7wil@gmail.com?subject=${encodeURIComponent(`WVARC NCO Logger Bug Report - ${VERSION}`)}&body=${encodeURIComponent(`Version: ${VERSION}\nLogger mode: \nWhat happened?\n\nWhat did you expect?\n\nSteps to reproduce:\n`)}`;
    const NOTE_MAX = 60;
    const MODULE_IDS = ["controls", "chat", "checkedOut", "active", "lurkers"];
    const MODULE_LABELS = {
        controls: "Station Controls", chat: "Chat", checkedOut: "Checked Out", active: "Active Log", lurkers: "Lurkers"
    };
    const LEGACY_GRID_COLUMNS = 12;
    const GRID_COLUMNS = 24;
    const GRID_ROWS = 20;
    const LAYOUT_GRID_VERSION = 4;
    const GRID_ROW_HEIGHT = 26;
    const GRID_GAP = 1;
    const MIN_MODULE_COLUMNS = 2;
    const CHAT_FONT_SIZES = Object.freeze({ small: 12, normal: 14, large: 16 });
    const PRIVATE_CHAT_PREFIX = "~NCHPM1~";
    const HELPER_CHAT_MAX = 80;
    const HELP_FONT_SIZES = Object.freeze({ small: 11, normal: 13, large: 15 });
    const SLASH_HELP_BANNER = "WVARC NCO Logger handles these shortcuts directly. Nothing beginning with / is sent to group chat.";
    const SLASH_COMMANDS = Object.freeze([
        ["help", ["?"], "/h [help|?]", "Show local command and hotkey help"],
        ["in", ["checkin"], "/h in CALL", "Check in a station"],
        ["out", ["checkout", "o"], "/h out [CALL]", "Check out a station"],
        ["next", ["nn"], "/h next [CALL]", "Toggle Needed Next"],
        ["nr", ["noreply"], "/h nr [CALL]", "Toggle No Reply"],
        ["skip", ["s"], "/h skip [CALL]", "Toggle Skip"],
        ["attn", ["attention"], "/h attn [CALL]", "Toggle Attention"],
        ["clear", [], "/h clear [CALL]", "Clear station tags"],
        ["edit", [], "/h edit [CALL]", "Open Edit Station"],
        ["note", [], "/h note [CALL]", "Open Note"],
        ["guest", ["g"], "/h guest [CALL]", "Toggle Special Guest"],
        ["hi", [], "/h hi CALL", "Check in, then highlight"],
        ["li", [], "/h li", "Confirm and check in visible lurkers"],
        ["f", [], "/h f [frequency]", "Show or change frequency"],
        ["w", [], "/h w [CALL]", "Ask NetControl.live for station role and permission details"]
    ].map(([name, aliases, usage, description]) => Object.freeze({
        name, aliases: Object.freeze(aliases), usage, description
    })));
    const SLASH_COMMAND_BY_TOKEN = (() => {
        const commands = new Map();
        for (const command of SLASH_COMMANDS) {
            for (const token of [command.name, ...command.aliases]) {
                if (commands.has(token))
                    throw new Error(`Duplicate NCO Helper slash token: ${token}`);
                commands.set(token, command);
            }
        }
        return commands;
    })();
    const MIN_MODULE_ROWS = Object.freeze({ controls: 4, chat: 5, checkedOut: 2, active: 4, lurkers: 2 });
    const DEFAULT_MODULE_LAYOUT = Object.freeze({
        gridVersion: LAYOUT_GRID_VERSION,
        items: {
            lurkers: { x: 0, y: 0, w: 10, h: 4 },
            controls: { x: 10, y: 0, w: 4, h: 4 },
            checkedOut: { x: 14, y: 0, w: 10, h: 4 },
            chat: { x: 0, y: 4, w: 8, h: 16 },
            active: { x: 8, y: 4, w: 16, h: 16 }
        },
        collapsed: {}
    });
    const DEFAULT_AVATAR = "/img/nco-logger-default-avatar.svg";
    const npid = location.pathname.split("/")[3] || "";
    if (!/^[0-9a-f]{24}$/i.test(npid))
        return;
    const stateKey = `ncs-helper:${npid}`;
    const layoutKey = "ncs-helper:layout";
    const qrzUserKey = "ncs-helper:qrz-user";
    const qrzAuthKey = "ncs-helper:qrz-auth";
    const relayTokenKey = "ncs-helper:relay-token";
    const sharedProfileKey = "ncs-helper:shared-profiles";
    const selfCall = () => (document.querySelector("#serverInfo")?.dataset?.callSign || "").trim().toUpperCase();
    let panel = null;
    let latestStations = [];
    let latestNetTitle = "";
    let latestNetFrequency = "";
    let currentUserRole = "netuser";
    let local = {
        order: [], checkedOutOrder: [], lurkerOrder: [], ioCalls: [], recheckCalls: [], details: {},
        hiddenCalls: [], paneSizes: {}, collapsedSections: {}, moduleLayout: {},
        helperFontPreset: "normal", chatFontPreset: "normal", helpFontPreset: "normal", manualOrder: false, sharedUpdatedAt: 0
    };
    let dragging = null;
    let resizing = null;
    let modulePointerDrag = null;
    let editingNoteCall = "";
    const noteDrafts = new Map();
    const avatarSourceCache = new Map();
    const resolvedAvatarDataUrls = new Map();
    let qrzSessionKey = "";
    let qrzUsername = "";
    let qrzPassword = "";
    let relayToken = "";
    let relayConnectionState = "unavailable";
    let qrzLookupRunning = false;
    const qrzLookupQueue = [];
    const qrzAttemptedCalls = new Set();
    const busyCalls = new Set();
    const rowPulses = new Map();
    const hiddenAwayCalls = new Set();
    let sharedProfiles = {};
    let stationTransitionBaseline = null;
    let selectedNextCall = "";
    let pinnedActionCall = "";
    let scrollActiveAfterRender = false;
    let updateCheckInFlight = false;
    let latestAvailableVersion = "";
    let updatePromptDismissed = false;
    let refreshRequestSequence = 0;
    let refreshAppliedSequence = 0;
    let lastRemoteRenderSignature = "";
    let chatObserver = null;
    let chatObserverHost = null;
    let chatImageHost = null;
    let slashBridgeHandlerRegistered = false;
    let photoTrigger = null;
    const hiddenCalls = new Set();
    let priorDocumentOverflow = "";
    let priorBodyOverflow = "";
    let backgroundScrollLocked = false;
    let statusTimer = null;
    let statusSequence = 0;
    let viewer = null;
    let syncEngine = null;
    let relayClient = null;
    let syncStartedForRole = "";
    let syncStartedForIdentity = "";
    let syncSnapshotRequestTimer = null;
    let loggerStateSaveTimer = null;
    let lastServerLoggerRevision = 0;
    let closedAfterHandoff = false;
    const helperPeers = new Map();
    const privateThreads = new Map();
    const pinnedChatMessages = new Map();
    const expandedPinnedChatIds = new Set();
    let privateChatTarget = "";
    const browserStorage = {
        get(keys, callback) {
            const result = {};
            for (const key of keys) {
                try {
                    const raw = window.localStorage.getItem(key);
                    if (raw !== null)
                        result[key] = JSON.parse(raw);
                }
                catch { }
            }
            callback(result);
        },
        set(entries) {
            for (const [key, value] of Object.entries(entries)) {
                window.localStorage.setItem(key, JSON.stringify(value));
            }
        },
        remove(key) { window.localStorage.removeItem(key); }
    };
    const isNcoUser = () => currentUserRole === "netcontrol";
    const canManageStations = () => ["netcontrol", "netlogger"].includes(currentUserRole);
    const modeId = () => ({ netcontrol: "nco", netlogger: "logger", netrelay: "relay" }[currentUserRole] || "viewer");
    const helperModeLabel = () => ({
        netcontrol: "NCO Mode",
        netlogger: "Logger Mode",
        netrelay: "Relay Mode"
    })[currentUserRole] || "Viewer Mode";
    const helperModeShortLabel = () => helperModeLabel().replace(/ Mode$/, "");
    const moduleAvailable = id => id !== "controls" || canManageStations();
    const normalizeFontPreset = value => ["small", "normal", "large"].includes(value) ? value : "normal";
    function commandAllowed(command) {
        const [verb, rawCall = ""] = String(command || "").trim().split(/\s+/);
        const call = normalizeCall(rawCall);
        const station = latestStations.find(item => normalizeCall(item.callSign) === call);
        if (["o", "io", "ui"].includes(verb) && station?.role === "netcontrol")
            return false;
        if (verb === "o" && call === selfCall())
            return false;
        if (isNcoUser())
            return ["i", "o", "ui", "io", "l", "r", "handoff", "close", "f"].includes(verb);
        if (currentUserRole === "netlogger")
            return ["i", "o", "ui", "io", "r"].includes(verb);
        return false;
    }
    const storageGet = () => new Promise(resolve => browserStorage.get([stateKey, layoutKey, sharedProfileKey], data => {
        const saved = data[stateKey] || local;
        const layout = data[layoutKey] && typeof data[layoutKey] === "object" ? data[layoutKey] : {};
        resolve({
            ...saved,
            paneSizes: layout.paneSizes && typeof layout.paneSizes === "object" ? layout.paneSizes : saved.paneSizes,
            collapsedSections: layout.collapsedSections && typeof layout.collapsedSections === "object"
                ? layout.collapsedSections
                : saved.collapsedSections,
            moduleLayout: layout.moduleLayout && typeof layout.moduleLayout === "object"
                ? layout.moduleLayout
                : saved.moduleLayout,
            helperFontPreset: normalizeFontPreset(layout.helperFontPreset || saved.helperFontPreset),
            chatFontPreset: normalizeFontPreset(layout.chatFontPreset || saved.chatFontPreset),
            helpFontPreset: normalizeFontPreset(layout.helpFontPreset || saved.helpFontPreset),
            sharedProfiles: data[sharedProfileKey] && typeof data[sharedProfileKey] === "object" ? data[sharedProfileKey] : {}
        });
    }));
    const storageSet = () => browserStorage.set({
        [stateKey]: local,
        [layoutKey]: {
            paneSizes: local.paneSizes || {},
            collapsedSections: local.collapsedSections || {},
            moduleLayout: local.moduleLayout || {},
            helperFontPreset: normalizeFontPreset(local.helperFontPreset),
            chatFontPreset: normalizeFontPreset(local.chatFontPreset),
            helpFontPreset: normalizeFontPreset(local.helpFontPreset)
        }
    });
    const storeQrzUsername = () => browserStorage.set({ [qrzUserKey]: qrzUsername });
    const storeQrzAuth = () => browserStorage.set({
        [qrzAuthKey]: { username: qrzUsername, password: qrzPassword }
    });
    const storeSharedProfiles = () => browserStorage.set({ [sharedProfileKey]: sharedProfiles });
    const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
    const normalizeCall = value => String(value || "").trim().toUpperCase();
    const formatName = value => String(value || "").trim().split(/\s+/).filter(Boolean).map(part => {
        const lower = part.toLocaleLowerCase();
        const normalized = lower.replace(/(^|[-'’])(\p{L})/gu, (_, prefix, letter) => prefix + letter.toLocaleUpperCase());
        const suffix = normalized.replace(/[.,]/g, "").toLocaleUpperCase();
        if (["I", "II", "III", "IV", "V"].includes(suffix))
            return suffix;
        if (suffix === "JR")
            return "Jr.";
        if (suffix === "SR")
            return "Sr.";
        return normalized;
    }).join(" ");
    const formatLocation = value => String(value || "").trim().split(/\s*,\s*/).filter(Boolean).map(part => /^[a-z]{2,3}$/i.test(part) ? part.toLocaleUpperCase() : formatName(part)).join(", ");
    const parseAppVersion = value => {
        const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.(\d+))?$/);
        if (!match)
            return null;
        return {
            core: match.slice(1, 4).map(Number),
            channel: match[4] || "stable",
            build: Number(match[5] || 0)
        };
    };
    const isNewerVersion = (candidate, current = VERSION) => {
        const left = parseAppVersion(candidate);
        const right = parseAppVersion(current);
        if (!left || !right)
            return false;
        for (let index = 0; index < left.core.length; index += 1) {
            if (left.core[index] !== right.core[index])
                return left.core[index] > right.core[index];
        }
        const channelRank = { alpha: 0, beta: 1, stable: 2 };
        if (left.channel !== right.channel)
            return channelRank[left.channel] > channelRank[right.channel];
        return left.build > right.build;
    };
    function renderAvailableUpdate() {
        const version = panel?.querySelector("[data-role='helper-version']");
        if (!version)
            return;
        version.textContent = `Version ${VERSION}`;
        if (!isNewerVersion(latestAvailableVersion))
            return;
        version.innerHTML = `Version ${escapeHtml(VERSION)} · <button class="nch-update-link" data-role="show-update">Update Available</button>`;
        const prompt = panel.querySelector("[data-role='update-modal']");
        if (prompt && !updatePromptDismissed) {
            prompt.querySelector("[data-role='available-version']").textContent = latestAvailableVersion;
            prompt.hidden = false;
            syncNativeChatVisibility();
        }
    }
    async function checkForUpdate() {
        return false;
    }
    function launchUpdater() {
        return false;
    }
    const stationSignalSnapshot = stations => new Map(stations.map(station => [normalizeCall(station.callSign), {
            checkedState: typeof station.checkedState === "boolean" ? station.checkedState : null,
            hand: station.hand === true
        }]).filter(([call]) => call));
    function startRowPulse(call, kind) {
        const pulse = { kind, startedAt: performance.now() };
        rowPulses.set(call, pulse);
        window.setTimeout(() => {
            if (rowPulses.get(call) !== pulse)
                return;
            rowPulses.delete(call);
            const row = panel?.querySelector(`.nch-row[data-call='${CSS.escape(call)}']`);
            row?.classList.remove("nch-pulse-new-lurker", "nch-pulse-hand-raised");
            row?.style.removeProperty("--nch-row-pulse-delay");
        }, 1850);
    }
    function observeStationTransitions(stations) {
        const next = stationSignalSnapshot(stations);
        if (stationTransitionBaseline) {
            hiddenCalls.forEach(call => {
                if (!next.has(call))
                    hiddenAwayCalls.add(call);
                if (next.has(call) && hiddenAwayCalls.has(call)) {
                    hiddenAwayCalls.delete(call);
                    hiddenCalls.delete(call);
                    local.hiddenCalls = [...hiddenCalls];
                    publishSharedVisibility(call, false);
                }
            });
            next.forEach((current, call) => {
                const prior = stationTransitionBaseline.get(call);
                if (current.checkedState === true && prior?.checkedState !== true)
                    scrollActiveAfterRender = true;
                if (current.checkedState === null && (!prior || prior.checkedState !== null) && !hiddenCalls.has(call)) {
                    startRowPulse(call, "lurker");
                }
                if (current.hand && !prior?.hand && current.checkedState !== null) {
                    startRowPulse(call, "hand");
                }
                if (prior?.checkedState === false && current.checkedState === true) {
                    setRecheck(call, true, false);
                    if (canManageStations())
                        publishSharedTags(call);
                }
                if (current.checkedState === false && prior?.checkedState !== false) {
                    clearCheckoutAlerts(call);
                    if (canManageStations())
                        publishSharedTags(call);
                }
            });
            if (selectedNextCall && next.get(selectedNextCall)?.checkedState !== true) {
                selectedNextCall = "";
                if (canManageStations())
                    publishSharedSelection();
            }
        }
        stationTransitionBaseline = next;
    }
    function pulsePresentation(call) {
        const pulse = rowPulses.get(call);
        if (!pulse)
            return { className: "", style: "" };
        const elapsed = performance.now() - pulse.startedAt;
        if (elapsed >= 1800) {
            rowPulses.delete(call);
            return { className: "", style: "" };
        }
        return {
            className: pulse.kind === "lurker" ? " nch-pulse-new-lurker" : " nch-pulse-hand-raised",
            style: ` style="--nch-row-pulse-delay:-${Math.max(0, Math.round(elapsed))}ms"`
        };
    }
    const safeImageUrl = value => {
        try {
            const url = new URL(String(value || ""));
            if (url.protocol === "http:" && (url.hostname === "qrz.com" || url.hostname.endsWith(".qrz.com"))) {
                url.protocol = "https:";
            }
            return url.protocol === "https:" ? url.href : "";
        }
        catch {
            return "";
        }
    };
    const maskedPasswordHint = value => {
        const password = String(value || "");
        if (!password)
            return "";
        return "•".repeat(Math.min(12, Math.max(8, password.length)));
    };
    async function fetchNet() {
        const response = await fetch(`/api/data/livenets/${npid}?capturePresence=false`, {
            credentials: "same-origin",
            headers: { Accept: "application/json" }
        });
        if (!response.ok)
            throw new Error(`Net data unavailable (${response.status})`);
        return response.json();
    }
    function commandMessage(command, phase) {
        const [verb, call = ""] = String(command).trim().split(/\s+/);
        const messages = {
            i: [`Checking in ${call}…`, `${call} checked in.`],
            o: [`Checking out ${call}…`, `${call} checked out.`],
            ui: [`Returning ${call} to lurkers…`, `${call} returned to lurkers.`],
            io: [`Logging ${call} as In & Out…`, `${call} logged as In & Out.`],
            l: [`Updating ${call}'s Logger role…`, `Logger role updated for ${call}.`],
            r: [`Updating ${call}'s Relay role…`, `Relay role updated for ${call}.`],
            handoff: [`Handing NCO control to ${call}…`, `NCO control handed to ${call}.`],
            f: ["Updating net frequency…", "Net frequency updated."],
            close: ["Closing the net…", "Net closed successfully."]
        };
        return messages[verb]?.[phase === "success" ? 1 : 0] ||
            (phase === "success" ? "Action completed." : "Completing action…");
    }
    async function runCommand(command, finalMessage = "") {
        if (!commandAllowed(command)) {
            setStatus("That action is not available in the current helper mode.", "warning");
            return false;
        }
        setStatus(commandMessage(command, "working"), "working");
        try {
            const [verb, rawValue = ""] = String(command).trim().split(/\s+/, 2);
            const actionByVerb = {
                i: "checkIn", hi: "checkInHighlighted", o: "checkOut", ui: "undoCheckIn",
                io: "checkInOut", l: "setLogger", r: "setRelay", handoff: "handoff",
                f: "frequency", close: "close"
            };
            const action = actionByVerb[verb];
            if (!action)
                throw new Error("That logger action is not supported.");
            const payload = { action };
            if (["f"].includes(verb))
                payload.frequency = rawValue;
            else if (rawValue)
                payload.callSign = normalizeCall(rawValue);
            const response = await fetch(`/api/nco-logger/${npid}`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok)
                throw new Error(data.errorMessage || `${response.status} ${response.statusText}`);
            setStatus(finalMessage || commandMessage(command, "success"), "success");
            if (canManageStations())
                local.sharedUpdatedAt = Date.now();
            window.setTimeout(refresh, 350);
            window.setTimeout(publishSharedSnapshotSafely, 900);
            return true;
        }
        catch (error) {
            const errorMessage = error.message || String(error);
            const [verb, targetCall] = String(command).trim().split(/\s+/);
            if (/create an account first/i.test(errorMessage) && ["l", "handoff"].includes(verb)) {
                const call = normalizeCall(targetCall);
                const role = verb === "l" ? "Logger" : "NCO";
                setStatus(`${call || "This station"} needs a registered NetControl.live account before being assigned ${role}. Relay does not require an account.`, "warning");
            }
            else {
                setStatus(`Couldn’t complete that action: ${errorMessage}`, "error");
            }
            return false;
        }
    }
    function publishSharedSnapshotSafely() {
        if (!canManageStations())
            return;
        if (loggerStateSaveTimer)
            window.clearTimeout(loggerStateSaveTimer);
        loggerStateSaveTimer = window.setTimeout(async () => {
            loggerStateSaveTimer = null;
            try {
                const response = await fetch(`/api/nco-logger/${npid}`, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({ action: "loggerState", state: sharedSnapshot() })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok)
                    throw new Error(data.errorMessage || `${response.status} ${response.statusText}`);
                const saved = data.message?.loggerState;
                if (saved?.updated_at) {
                    lastServerLoggerRevision = Number(saved.updated_at);
                    local.sharedUpdatedAt = Number(saved.updated_at);
                }
                storageSet();
            }
            catch (error) {
                console.warn("[WVARC NCO Logger] Shared state save failed", error);
                setStatus(`Logger state could not be saved: ${error.message || String(error)}`, "warning");
            }
        }, 180);
    }
    async function runReadCommand(command) {
        setStatus(commandMessage(command, "working"), "working");
        try {
            const [, rawCall = selfCall()] = String(command).trim().split(/\s+/, 2);
            const response = await fetch(`/api/nco-logger/${npid}`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ action: "stationInfo", callSign: normalizeCall(rawCall) })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok)
                throw new Error(data.errorMessage || `${response.status} ${response.statusText}`);
            const result = data.message || {};
            const message = result.callSign
                ? `${String(result.callSign).toLowerCase()}: ${result.role}/${result.level} [owner:${Boolean(result.owner)}]`
                : "";
            setStatus(message || "NetControl.live returned no additional details.", "success");
            return true;
        }
        catch (error) {
            setStatus(`Couldn’t complete that read: ${error.message || String(error)}`, "error");
            return false;
        }
    }
    async function setStationInteraction(callSign, action, state) {
        const canChange = canManageStations() || (action === "hand" && normalizeCall(callSign) === selfCall());
        if (!canChange) {
            setStatus("Only an NCO or Logger can change another station’s highlight or hand.", "warning");
            return false;
        }
        const label = action === "highlight" ? "highlight" : "hand";
        const working = action === "highlight"
            ? `${state ? "Highlighting" : "Clearing highlight for"} ${callSign}…`
            : `${state ? "Raising" : "Lowering"} ${callSign}’s hand…`;
        setStatus(working, "working");
        try {
            const response = await fetch(`/api/station/interactions/${npid}`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ action, actionParams: { state }, dstStation: callSign })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok)
                throw new Error(data.errorMessage || `${response.status} ${response.statusText}`);
            const completed = label === "highlight"
                ? `${callSign} ${state ? "highlighted" : "highlight cleared"}.`
                : `${callSign}’s hand ${state ? "raised" : "lowered"}.`;
            setStatus(completed, "success");
            window.setTimeout(refresh, 350);
            return true;
        }
        catch (error) {
            setStatus(`Couldn’t update ${callSign}: ${error.message || String(error)}`, "error");
            return false;
        }
    }
    const xmlText = (doc, name) => doc.getElementsByTagNameNS("*", name)[0]?.textContent?.trim() ||
        doc.getElementsByTagName(name)[0]?.textContent?.trim() || "";
    async function qrzLogin() {
        const username = normalizeCall(panel?.querySelector("[data-role='qrz-user']")?.value || qrzUsername);
        const password = panel?.querySelector("[data-role='qrz-password']")?.value || qrzPassword;
        if (!username || !password)
            throw new Error("Enter your QRZ username and password under QRZ Setup.");
        qrzUsername = username;
        qrzPassword = password;
        storeQrzUsername();
        const body = new URLSearchParams({
            username,
            password,
            agent: `NCOHelperByKE7WIL-${VERSION}`
        });
        const response = await fetch("https://xmldata.qrz.com/xml/current/", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body
        });
        if (!response.ok)
            throw new Error(`QRZ login failed (${response.status}).`);
        const doc = new DOMParser().parseFromString(await response.text(), "application/xml");
        const error = xmlText(doc, "Error");
        if (error)
            throw new Error(`QRZ: ${error}`);
        qrzSessionKey = xmlText(doc, "Key");
        if (!qrzSessionKey)
            throw new Error(xmlText(doc, "Message") || "QRZ did not return a session key.");
        const alert = xmlText(doc, "Alert");
        const passwordInput = panel?.querySelector("[data-role='qrz-password']");
        if (passwordInput)
            passwordInput.value = "";
        refreshQrzPasswordHint();
        storeQrzAuth();
        if (alert)
            setStatus(`QRZ alert: ${alert}`, "warning");
    }
    async function lookupQrz(callSign, allowSessionRetry = true, options = {}) {
        const { silent = false } = options;
        const call = normalizeCall(callSign || panel?.querySelector("[data-role='callsign']")?.value);
        if (!call)
            return setStatus("Enter a callsign first.", "error");
        if (!silent)
            setStatus(`Looking up ${call} on QRZ…`, "working");
        try {
            if (!qrzSessionKey)
                await qrzLogin();
            const url = new URL("https://xmldata.qrz.com/xml/current/");
            url.searchParams.set("s", qrzSessionKey);
            url.searchParams.set("callsign", call);
            const response = await fetch(url);
            if (!response.ok)
                throw new Error(`QRZ lookup failed (${response.status}).`);
            const doc = new DOMParser().parseFromString(await response.text(), "application/xml");
            const error = xmlText(doc, "Error");
            if (error) {
                if (/session|timeout|key/i.test(error) && allowSessionRetry && qrzPassword) {
                    qrzSessionKey = "";
                    await qrzLogin();
                    return lookupQrz(call, false, options);
                }
                if (/session|timeout|key/i.test(error)) {
                    qrzSessionKey = "";
                    storeQrzAuth();
                }
                throw new Error(`QRZ: ${error}`);
            }
            const city = xmlText(doc, "addr2");
            const state = xmlText(doc, "state");
            const country = xmlText(doc, "country");
            const location = formatLocation([city, state].filter(Boolean).join(", ") || country);
            const firstName = formatName(xmlText(doc, "fname").split(/\s+/)[0] || "");
            const lastName = formatName(xmlText(doc, "name"));
            const qrzMessage = xmlText(doc, "Message");
            const displayName = [firstName, lastName].filter(Boolean).join(" ");
            const photo = safeImageUrl(xmlText(doc, "image"));
            if (!location && !displayName && !photo) {
                throw new Error(xmlText(doc, "Message") || `QRZ returned no profile information for ${call}.`);
            }
            const current = detailsFor(call);
            local.details[call] = {
                ...current,
                location: current.locationOverride ? current.location : (location || current.location),
                name: current.nameOverride ? current.name : (displayName || current.name),
                qrzPhoto: photo,
                qrzPhotoChecked: true,
                qrzCheckedAt: Date.now(),
                qrzNameVersion: 2
            };
            if (canManageStations()) {
                const lookupProfile = {};
                if (displayName)
                    Object.assign(lookupProfile, { name: displayName, nameOverride: true, nameOrigin: "lookup" });
                if (location)
                    Object.assign(lookupProfile, { location, locationOverride: true, locationOrigin: "lookup" });
                if (Object.keys(lookupProfile).length) {
                    const authorityTime = Date.now();
                    const { accepted } = applyProfileCandidate(call, lookupProfile, currentUserRole, authorityTime, `local-lookup-${authorityTime}`);
                    publishSharedProfile(call, accepted);
                }
            }
            storageSet();
            if (normalizeCall(panel?.querySelector("[data-role='callsign']")?.value) === call)
                loadEditor(call);
            renderQueue();
            if (silent && call === selfCall() && !photo && panel?.querySelector("[data-role='status']")?.dataset.type !== "success") {
                const reason = qrzMessage ? `: ${qrzMessage}` : ".";
                setStatus(`QRZ returned no photo for ${call}${reason} Using the default avatar.`, "warning");
            }
            if (!silent) {
                const summary = [displayName, location].filter(Boolean).join(" · ") || `${call} profile loaded.`;
                setStatus(`QRZ found ${summary}${photo ? "" : " · no photo returned; default used."}`, photo ? "success" : "warning");
            }
            return true;
        }
        catch (error) {
            if (!silent)
                setStatus(`QRZ lookup failed for ${call}: ${error.message || String(error)}`, "error");
            return false;
        }
    }
    function queueMissingQrzPhotos() {
        if (!qrzPassword && !qrzSessionKey)
            return;
        const staleBefore = Date.now() - 24 * 60 * 60 * 1000;
        const priority = station => {
            if (normalizeCall(station.callSign) === selfCall())
                return 0;
            if (station.checkedState === true && station.role === "netcontrol")
                return 1;
            if (station.checkedState === true && station.role === "netlogger")
                return 2;
            if (station.checkedState === true && station.role === "netrelay")
                return 3;
            if (station.checkedState === true)
                return 4;
            if (station.checkedState === false)
                return 5;
            return 6;
        };
        [...latestStations].sort((left, right) => priority(left) - priority(right)).forEach(station => {
            const call = normalizeCall(station.callSign);
            const saved = local.details[call] || {};
            const isFresh = saved.qrzNameVersion === 2 && saved.qrzPhotoChecked &&
                Number(saved.qrzCheckedAt || 0) > staleBefore;
            if (!call || isFresh || qrzAttemptedCalls.has(call) || qrzLookupQueue.includes(call))
                return;
            qrzLookupQueue.push(call);
        });
        processQrzLookupQueue();
    }
    async function processQrzLookupQueue() {
        if (qrzLookupRunning || !qrzLookupQueue.length)
            return;
        qrzLookupRunning = true;
        while (qrzLookupQueue.length && (qrzPassword || qrzSessionKey)) {
            const call = qrzLookupQueue.shift();
            qrzAttemptedCalls.add(call);
            await lookupQrz(call, true, { silent: true });
            await new Promise(resolve => window.setTimeout(resolve, 250));
        }
        qrzLookupRunning = false;
    }
    function restoreNativeChat() {
        document.dispatchEvent(new Event("nch-helper-slash-disable"));
        unregisterSlashBridgeHandler();
        chatObserver?.disconnect();
        chatObserver = null;
        chatObserverHost = null;
        chatImageHost?.removeEventListener("click", openChatImage, true);
        chatImageHost = null;
        const chat = document.querySelector("hl-chat.nch-chat-docked");
        chat?.classList.remove("nch-chat-docked", "nch-chat-floating", "nch-chat-suspended");
        ["--nch-chat-left", "--nch-chat-top", "--nch-chat-width", "--nch-chat-height", "--nch-font-adjust"].forEach(property => chat?.style.removeProperty(property));
    }
    const nativeChat = () => document.querySelector("hl-chat.nch-chat-docked");
    function applyDisplayPreferences() {
        const helperPreset = normalizeFontPreset(local.helperFontPreset);
        const chatPreset = normalizeFontPreset(local.chatFontPreset);
        const helpPreset = normalizeFontPreset(local.helpFontPreset);
        const helperFontAdjustments = { small: "-1px", normal: "0px", large: "2px" };
        local.helperFontPreset = helperPreset;
        local.chatFontPreset = chatPreset;
        local.helpFontPreset = helpPreset;
        panel?.style.setProperty("--nch-font-adjust", helperFontAdjustments[helperPreset]);
        nativeChat()?.style.setProperty("--nch-font-adjust", helperFontAdjustments[helperPreset]);
        nativeChat()?.style.setProperty("--nch-chat-font-size", `${CHAT_FONT_SIZES[chatPreset]}px`);
        nativeChat()?.style.setProperty("--nch-chat-composer-font-size", `${Math.max(11, CHAT_FONT_SIZES[chatPreset] - 1)}px`);
        panel?.style.setProperty("--nch-help-font-size", `${HELP_FONT_SIZES[helpPreset]}px`);
        panel?.querySelectorAll("[data-helper-font]").forEach(button => {
            button.setAttribute("aria-pressed", String(button.dataset.helperFont === helperPreset));
        });
        panel?.querySelectorAll("[data-chat-font]").forEach(button => {
            button.setAttribute("aria-pressed", String(button.dataset.chatFont === chatPreset));
        });
        panel?.querySelectorAll("[data-help-font]").forEach(button => {
            button.setAttribute("aria-pressed", String(button.dataset.helpFont === helpPreset));
        });
    }
    function positionNativeChat() {
        const chat = nativeChat();
        const slot = panel?.querySelector("[data-role='chat-slot']");
        if (!chat || !slot || !chat.classList.contains("nch-chat-floating"))
            return;
        const rect = slot.getBoundingClientRect();
        chat.style.setProperty("--nch-chat-left", `${Math.round(rect.left + 2)}px`);
        chat.style.setProperty("--nch-chat-top", `${Math.round(rect.top + 2)}px`);
        chat.style.setProperty("--nch-chat-width", `${Math.max(0, Math.round(rect.width - 4))}px`);
        chat.style.setProperty("--nch-chat-height", `${Math.max(0, Math.round(rect.height - 4))}px`);
        syncNativeChatVisibility();
    }
    function handleWindowResize() {
        window.requestAnimationFrame(() => {
            applyModuleLayout();
            positionNativeChat();
        });
    }
    function syncNativeChatVisibility() {
        const modalOpen = panel && (panel.querySelector("[data-module='chat']")?.hidden ||
            panel.querySelector("[data-role='private-selector']")?.open ||
            [...panel.querySelectorAll("[data-role='photo-viewer'], [data-role='edit-modal'], [data-role='close-confirm'], [data-role='help-modal'], [data-role='commands-modal'], [data-role='update-modal'], [data-role='viewer-host']")]
                .some(element => !element.hidden));
        nativeChat()?.classList.toggle("nch-chat-suspended", Boolean(modalOpen));
    }
    function customizeNativeChat() {
        const sendButton = nativeChat()?.querySelector(".chat-send-btn");
        if (!sendButton)
            return;
        sendButton.textContent = "Send";
        sendButton.title = "Send message";
        sendButton.setAttribute("aria-label", "Send message");
        sendButton.classList.add("nch-chat-send");
        safeNormalizeChatDisplay();
        const chat = nativeChat();
        if (chat && chatImageHost !== chat) {
            chatImageHost?.removeEventListener("click", openChatImage, true);
            chat.addEventListener("click", openChatImage, true);
            chatImageHost = chat;
        }
        if (chat && chatObserverHost !== chat) {
            chatObserver?.disconnect();
            chatObserver = new MutationObserver(safeNormalizeChatDisplay);
            chatObserver.observe(chat, { childList: true, subtree: true });
            chatObserverHost = chat;
        }
    }
    function deduplicateChatMessages() {
        const chat = nativeChat();
        if (Array.isArray(chat?.messages)) {
            const seenDataIds = new Set();
            const uniqueMessages = chat.messages.filter(message => {
                const id = String(message?.id || message?._id || message?.messageId || "").trim();
                if (!id)
                    return true;
                if (seenDataIds.has(id))
                    return false;
                seenDataIds.add(id);
                return true;
            });
            if (uniqueMessages.length !== chat.messages.length)
                chat.messages = uniqueMessages;
        }
        const seen = new Set();
        chat?.querySelectorAll("[data-message-id], [data-id]").forEach(message => {
            const id = String(message.dataset.messageId || message.dataset.id || "").trim();
            if (!id)
                return;
            if (seen.has(id))
                message.remove();
            else
                seen.add(id);
        });
    }
    const makeLocalId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    function chatPeerLabel(peer) {
        const role = ({ netcontrol: "NCO", netlogger: "Logger", netrelay: "Relay" })[peer?.role || ""] || "";
        const call = normalizeCall(peer?.callSign);
        const name = String(peer?.name || "").trim();
        const identity = name && normalizeCall(name) !== call ? `${name} (${call})` : call || "Unknown";
        return `${identity}${role ? ` — ${role}` : ""}`;
    }
    function stationDisplayName(station) {
        const call = normalizeCall(station?.callSign);
        return call ? detailsFor(call).name || call : "";
    }
    function refreshHelperPeers() {
        const loggedCalls = new Set();
        latestStations.forEach(station => {
            if (typeof station.checkedState !== "boolean")
                return;
            const call = normalizeCall(station.callSign);
            if (!call)
                return;
            loggedCalls.add(call);
            const stationUserId = String(station.userProfile || station.userId || station.userID || station.user_id || "").trim();
            const details = detailsFor(call);
            const prior = helperPeers.get(call) || {};
            const identityChanged = Boolean(stationUserId && prior.userId && stationUserId !== prior.userId);
            helperPeers.set(call, {
                ...prior,
                callSign: call,
                userId: stationUserId || String(prior.userId || ""),
                name: stationDisplayName(station),
                role: station.role || "netuser",
                present: Boolean(prior.present && !identityChanged),
                checkedState: station.checkedState,
                lastSeen: Number(prior.lastSeen) || 0
            });
        });
        [...helperPeers.keys()].forEach(call => {
            if (!loggedCalls.has(call))
                helperPeers.delete(call);
        });
    }
    const privatePeerAvailable = peer => Boolean(peer?.present && peer?.userId);
    function orderedPrivatePeers() {
        refreshHelperPeers();
        const self = selfCall();
        const rank = role => ({ netcontrol: 0, netlogger: 1, netrelay: 2 })[role] ?? 3;
        return [...helperPeers.values()]
            .filter(peer => peer.callSign && peer.callSign !== self)
            .sort((a, b) => rank(a.role) - rank(b.role) || String(a.name || a.callSign).localeCompare(String(b.name || b.callSign)));
    }
    function encodeHelperPrivate(action, payload) {
        const text = `${PRIVATE_CHAT_PREFIX}${JSON.stringify({
            version: 1,
            net_id: npid,
            action,
            id: makeLocalId("pm"),
            timestamp: Date.now(),
            payload
        })}`;
        return text.length <= 1800 ? text : "";
    }
    function decodeHelperPrivate(text) {
        if (typeof text !== "string" || !text.startsWith(PRIVATE_CHAT_PREFIX))
            return null;
        try {
            const message = JSON.parse(text.slice(PRIVATE_CHAT_PREFIX.length));
            if (message?.version !== 1 || message?.net_id !== npid || !["presence", "private"].includes(message?.action))
                return null;
            if (!message.id || !Number.isFinite(Number(message.timestamp)) || !message.payload || typeof message.payload !== "object")
                return null;
            return message;
        }
        catch {
            return null;
        }
    }
    async function publishHelperPrivate(action, payload) {
        if (!relayClient)
            return false;
        const text = encodeHelperPrivate(action, payload);
        if (!text)
            return false;
        try {
            return Boolean(await relayClient.publish({ text }, makeLocalId("helper")));
        }
        catch {
            return false;
        }
    }
    function publishHelperPresence() {
        const identity = currentRelayIdentity();
        if (!identity || !relayClient)
            return;
        publishHelperPrivate("presence", {
            callSign: identity.callSign,
            userId: identity.userId,
            role: currentUserRole,
            name: stationDisplayName(latestStations.find(station => normalizeCall(station.callSign) === identity.callSign)) || identity.callSign
        });
    }
    function receiveHelperPrivate(frame, message) {
        const senderCall = normalizeCall(frame?.sender?.callsign);
        const senderUserId = String(frame?.sender?.user_id || "");
        if (!senderCall || !senderUserId)
            return;
        const payload = message.payload || {};
        const peer = helperPeers.get(senderCall) || {};
        helperPeers.set(senderCall, {
            ...peer,
            callSign: senderCall,
            userId: senderUserId,
            name: String(payload.name || peer.name || senderCall).slice(0, 60),
            role: String(payload.role || peer.role || "netuser"),
            present: true,
            lastSeen: Date.now()
        });
        if (message.action === "private") {
            const toCall = normalizeCall(payload.toCall);
            const body = String(payload.body || "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 800);
            const identity = currentRelayIdentity();
            const toUserId = String(payload.toUserId || "").trim();
            if ((toCall !== selfCall() && (!identity || toUserId !== identity.userId)) || !body)
                return;
            const thread = privateThreads.get(senderCall) || [];
            if (!thread.some(item => item.id === message.id)) {
                thread.push({ id: message.id, from: senderCall, body, timestamp: Number(message.timestamp) || Date.now(), incoming: true });
                privateThreads.set(senderCall, thread.slice(-HELPER_CHAT_MAX));
                if (!privateChatTarget)
                    privateChatTarget = senderCall;
                setStatus(`Private helper message from ${senderCall}.`, "success");
            }
        }
        renderHelperChatUi();
    }
    function renderHelperChatUiUnsafe() {
        if (!panel)
            return;
        refreshHelperPeers();
        const host = panel.querySelector("[data-role='helper-chat']");
        if (!host)
            return;
        const selector = host.querySelector("[data-role='private-selector']");
        const summary = host.querySelector("[data-role='private-selector-summary']");
        const options = host.querySelector("[data-role='private-options']");
        if (!selector || !summary || !options)
            return;
        const peers = orderedPrivatePeers();
        const current = peers.some(peer => peer.callSign === privateChatTarget && privatePeerAvailable(peer)) ? privateChatTarget : "";
        privateChatTarget = current;
        const availablePeers = peers.filter(privatePeerAvailable);
        const unavailablePeers = peers.filter(peer => !privatePeerAvailable(peer));
        const peerOptions = (items, available) => items.map(peer => `<button type="button" role="option" class="nch-private-peer-option nch-private-peer-${available ? "available" : "unavailable"}" data-private-choice="${escapeHtml(peer.callSign)}" aria-selected="${peer.callSign === privateChatTarget ? "true" : "false"}"${available ? "" : " disabled"}>
        <span class="nch-private-choice-check" aria-hidden="true">${peer.callSign === privateChatTarget ? "✓" : ""}</span><span class="nch-private-peer-dot" aria-hidden="true"></span><span>${escapeHtml(chatPeerLabel(peer))}</span>
      </button>`).join("");
        options.innerHTML = `
      <button type="button" role="option" class="nch-private-peer-option nch-private-group-choice" data-private-choice="" aria-selected="${privateChatTarget ? "false" : "true"}"><span class="nch-private-choice-check" aria-hidden="true">${privateChatTarget ? "" : "✓"}</span><span>Group Chat</span></button>
      <div class="nch-private-option-heading">Available for Private Chat</div>
      ${availablePeers.length ? peerOptions(availablePeers, true) : '<div class="nch-private-option-empty">None</div>'}
      <div class="nch-private-option-heading">Unavailable — Helper not detected</div>
      ${unavailablePeers.length ? peerOptions(unavailablePeers, false) : '<div class="nch-private-option-empty">None</div>'}`;
        const selectedPeer = privateChatTarget ? helperPeers.get(privateChatTarget) : null;
        summary.innerHTML = selectedPeer
            ? `<span class="nch-private-choice-check" aria-hidden="true">✓</span><span class="nch-private-peer-dot is-available" aria-hidden="true"></span><span>${escapeHtml(chatPeerLabel(selectedPeer))}</span>`
            : '<span class="nch-private-choice-check" aria-hidden="true">✓</span><span>Group Chat</span>';
        const privatePane = host.querySelector("[data-role='private-pane']");
        const privateMessages = host.querySelector("[data-role='private-messages']");
        const warning = host.querySelector("[data-role='private-warning']");
        const input = host.querySelector("[data-role='private-input']");
        const send = host.querySelector("[data-role='private-send']");
        const peer = privateChatTarget ? helperPeers.get(privateChatTarget) : null;
        if (privatePane)
            privatePane.hidden = !privateChatTarget;
        if (warning)
            warning.textContent = privateChatTarget && !privatePeerAvailable(peer)
                ? `${privateChatTarget} is not currently advertising NCO Helper private chat, so they may not receive this.`
                : "";
        if (send)
            send.disabled = !privateChatTarget || !privatePeerAvailable(peer);
        if (input)
            input.disabled = !privateChatTarget || !privatePeerAvailable(peer);
        if (privateMessages) {
            const messages = privateChatTarget ? privateThreads.get(privateChatTarget) || [] : [];
            const html = messages.map(item => `
        <div class="nch-private-message${item.incoming ? " nch-private-incoming" : " nch-private-outgoing"}">
          <strong>${escapeHtml(item.incoming ? item.from : "Me")}</strong>
          <span>${escapeHtml(item.body)}</span>
        </div>`).join("");
            const switchingThread = privateMessages.dataset.threadCall !== privateChatTarget;
            const wasAtBottom = privateMessages.scrollHeight - privateMessages.clientHeight - privateMessages.scrollTop <= 8;
            const priorScrollTop = privateMessages.scrollTop;
            if (privateMessages.innerHTML !== html)
                privateMessages.innerHTML = html;
            privateMessages.dataset.threadCall = privateChatTarget;
            if (switchingThread || wasAtBottom)
                privateMessages.scrollTop = privateMessages.scrollHeight;
            else
                privateMessages.scrollTop = priorScrollTop;
        }
        renderPinnedChatStrip();
    }
    function renderHelperChatUi() {
        try {
            renderHelperChatUiUnsafe();
        }
        catch (error) {
            console.warn("NCO Helper private chat rendering skipped; local station rendering continues:", error);
        }
    }
    function chatMessagePlainText(message, maxLength = 2000) {
        const body = message?.querySelector?.(".chat-text, .chat-message-content, .message-text, [data-role='message-text']");
        if (body)
            return String(body.innerText || body.textContent || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
        const clone = message?.cloneNode?.(true);
        clone?.querySelectorAll?.(".nch-pin-chat, .nch-chat-download, .nch-unpin-chat, .nch-pinned-chat-open")
            .forEach(control => control.remove());
        return String(clone?.textContent || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
    }
    function messagePinText(message) {
        return chatMessagePlainText(message);
    }
    function messagePinImageUrl(message) {
        const image = message?.querySelector?.(".chat-image-link img, .chat-message-content img, img.chat-image, img[src]");
        const link = image?.closest?.("a[href]") || message?.querySelector?.(".chat-image-link[href]");
        const candidate = String(image?.currentSrc || image?.src || image?.dataset?.imageUrl || link?.href || "");
        if (!candidate)
            return "";
        try {
            const url = new URL(candidate, location.href);
            return url.origin === location.origin && (url.protocol === "https:" || url.protocol === "http:") ? url.href : "";
        }
        catch {
            return "";
        }
    }
    function messagePinId(message) {
        return String(message?.dataset?.messageId || message?.dataset?.id || message?.getAttribute?.("id") || "").trim();
    }
    function renderPinnedChatStrip() {
        const chat = nativeChat();
        if (!chat)
            return;
        const messages = chat.querySelector(".chat-messages");
        const parent = messages?.parentNode && chat.contains(messages) ? messages.parentNode : chat;
        const before = messages?.parentNode === parent ? messages : null;
        let strip = chat.querySelector(".nch-pinned-chat-strip");
        if (!strip) {
            strip = document.createElement("div");
            strip.className = "nch-pinned-chat-strip";
        }
        if (strip.parentNode !== parent || (before && strip.nextSibling !== before)) {
            if (before?.parentNode === parent)
                parent.insertBefore(strip, before);
            else if (parent === chat || chat.contains(parent))
                parent.appendChild(strip);
        }
        const pins = [...pinnedChatMessages.values()].sort((a, b) => a.pinnedAt - b.pinnedAt);
        strip.hidden = pins.length === 0;
        const html = pins.map(pin => {
            const expanded = expandedPinnedChatIds.has(pin.id);
            const image = pin.imageUrl
                ? `<img class="nch-pinned-chat-image" src="${escapeHtml(pin.imageUrl)}" alt="Pinned image from ${escapeHtml(pin.author || "chat participant")}" loading="lazy">`
                : "";
            return `
      <div class="nch-pinned-chat-item${expanded ? " is-expanded" : ""}" data-pin-id="${escapeHtml(pin.id)}">
        <span aria-hidden="true">📌</span>
        <button type="button" class="nch-pinned-chat-open" data-open-pin="${escapeHtml(pin.id)}" aria-expanded="${expanded ? "true" : "false"}" aria-label="${expanded ? "Collapse" : "Show full"} pinned message from ${escapeHtml(pin.author || "Pinned")}" title="${expanded ? "Collapse" : "Show full"} pinned message">
          <strong>${escapeHtml(pin.author || "Pinned")}</strong>${pin.text ? `<span class="nch-pinned-chat-text">${escapeHtml(pin.text)}</span>` : ""}${image}
          <span class="nch-pin-expand-label">${expanded ? "Collapse ▴" : "Show full ▾"}</span>
        </button>
        <button type="button" class="nch-unpin-chat" data-unpin-chat="${escapeHtml(pin.id)}" aria-label="Unpin chat message">×</button>
      </div>`;
        }).join("");
        if (strip.innerHTML !== html)
            strip.innerHTML = html;
    }
    function togglePinnedChatMessage(message, explicitId = "") {
        if (!message)
            return;
        const id = explicitId || messagePinId(message) || makeLocalId("chatpin");
        if (!message.dataset.messageId && !message.dataset.id)
            message.dataset.messageId = id;
        if (pinnedChatMessages.has(id)) {
            pinnedChatMessages.delete(id);
            expandedPinnedChatIds.delete(id);
            setStatus("Chat message unpinned.", "success");
        }
        else {
            const author = message.querySelector(".chat-message-author, .chat-message-sender, .chat-sender, .chat-author, .chat-user-name, .chat-username")?.textContent?.trim() || "";
            pinnedChatMessages.set(id, {
                id,
                author,
                text: messagePinText(message),
                imageUrl: messagePinImageUrl(message),
                pinnedAt: Date.now()
            });
            setStatus("Chat message pinned.", "success");
        }
        renderPinnedChatStrip();
    }
    async function sendPrivateChatMessage() {
        const host = panel?.querySelector("[data-role='helper-chat']");
        const input = host?.querySelector("[data-role='private-input']");
        const targetCall = normalizeCall(privateChatTarget);
        const peer = targetCall ? helperPeers.get(targetCall) : null;
        const body = String(input?.value || "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 800);
        if (!targetCall)
            return setStatus("Choose a private chat recipient first.", "warning");
        if (!privatePeerAvailable(peer))
            return setStatus(`${targetCall} is not currently running NCO Helper private chat.`, "warning");
        if (!body)
            return;
        const identity = currentRelayIdentity();
        const sent = await publishHelperPrivate("private", {
            toCall: targetCall,
            toUserId: peer.userId,
            body,
            fromCall: identity?.callSign || selfCall()
        });
        if (!sent)
            return setStatus("Private helper chat could not send because the relay is not connected.", "error");
        const thread = privateThreads.get(targetCall) || [];
        thread.push({ id: makeLocalId("localpm"), from: identity?.callSign || selfCall(), body, timestamp: Date.now(), incoming: false });
        privateThreads.set(targetCall, thread.slice(-HELPER_CHAT_MAX));
        if (input)
            input.value = "";
        renderHelperChatUi();
        setStatus(`Private helper message sent to ${targetCall}.`, "success");
    }
    function normalizeLatestChatPrompt() {
        const chat = nativeChat();
        if (!chat)
            return;
        const hasVisibleMessage = [...chat.querySelectorAll(".chat-message, [data-message-id]")]
            .some(message => {
            if (message.hidden || message.closest("[hidden]"))
                return false;
            const text = chatMessagePlainText(message, 400);
            if (!text || text.includes("~NCHSYNC1~"))
                return false;
            return !/^chat history cleared by (?:ncs|nco)$/i.test(text);
        });
        chat.querySelectorAll("button, [role='button'], a").forEach(control => {
            const label = String(control.getAttribute("aria-label") || control.textContent || "").trim().toLocaleLowerCase();
            if (!/\blatest(?:\s|\d|$)/.test(label))
                return;
            control.classList.toggle("nch-stale-latest", !hasVisibleMessage);
            control.setAttribute("aria-hidden", String(!hasVisibleMessage));
            if (!hasVisibleMessage)
                control.setAttribute("tabindex", "-1");
            else if (control.getAttribute("tabindex") === "-1")
                control.removeAttribute("tabindex");
        });
    }
    function normalizeChatDisplay() {
        deduplicateChatMessages();
        normalizeLatestChatPrompt();
        nativeChat()?.querySelectorAll(".chat-message-author, .chat-message-sender, .chat-sender, .chat-author, .chat-user, .chat-user-name, .chat-username").forEach(element => {
            const text = String(element.textContent || "").trim();
            if (/^[^()]{1,50}\([A-Z0-9/-]{3,15}\)$/.test(text)) {
                const normalized = text.replace(/\s*\(/, " (");
                if (normalized !== text)
                    element.textContent = normalized;
            }
        });
        nativeChat()?.querySelectorAll(".chat-message *").forEach(element => {
            if (element.childElementCount || element.matches(".chat-text, .chat-message-content"))
                return;
            const text = String(element.textContent || "");
            if (text.length <= 80 && /^[^()]{1,50}\([A-Z0-9/-]{3,15}\)$/.test(text.trim())) {
                const normalized = text.trim().replace(/\s*\(/, " (");
                if (normalized !== text)
                    element.textContent = normalized;
            }
        });
        nativeChat()?.querySelectorAll(".chat-message-content img").forEach(image => {
            const container = image.closest(".chat-message-content");
            if (!container || container.querySelector(":scope > .nch-chat-download"))
                return;
            container.classList.add("nch-chat-image-wrap");
            const button = document.createElement("button");
            button.type = "button";
            button.className = "nch-chat-download";
            button.title = "Download chat image";
            button.setAttribute("aria-label", "Download chat image");
            button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14"/></svg>';
            container.appendChild(button);
        });
        nativeChat()?.querySelectorAll("button, [role='button']").forEach(control => {
            if (control.matches(".nch-pin-chat, .nch-unpin-chat, .nch-pinned-chat-open"))
                return;
            const label = String(control.getAttribute("aria-label") || control.title || control.textContent || "").trim();
            if (!/^(?:un)?pin\b/i.test(label))
                return;
            control.classList.add("nch-native-pin-control");
            control.setAttribute("aria-hidden", "true");
            control.setAttribute("tabindex", "-1");
        });
        nativeChat()?.querySelectorAll(".chat-message, [data-message-id]").forEach(message => {
            if (message.closest(".nch-pinned-chat-strip") || message.querySelector(":scope > .nch-pin-chat"))
                return;
            const id = messagePinId(message) || makeLocalId("chatpin");
            if (!message.dataset.messageId && !message.dataset.id)
                message.dataset.messageId = id;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "nch-pin-chat";
            button.dataset.pinChat = id;
            button.title = "Pin chat message";
            button.setAttribute("aria-label", "Pin chat message");
            button.textContent = "📌";
            message.appendChild(button);
        });
        renderPinnedChatStrip();
    }
    function safeNormalizeChatDisplay() {
        const chat = nativeChat();
        const observer = chatObserver;
        const resumeObserver = Boolean(chat && observer && chatObserverHost === chat);
        if (resumeObserver)
            observer.disconnect();
        try {
            normalizeChatDisplay();
        }
        catch (error) {
            console.warn("NCO Helper chat normalization skipped:", error);
        }
        finally {
            if (resumeObserver && observer === chatObserver && chatObserverHost === chat && chat.isConnected) {
                observer.observe(chat, { childList: true, subtree: true });
            }
        }
    }
    function chatImageFilename(source) {
        try {
            const last = new URL(source, location.href).pathname.split("/").filter(Boolean).pop() || "chat-image";
            const clean = decodeURIComponent(last).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80);
            return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(clean) ? clean : `${clean || "chat-image"}.jpg`;
        }
        catch {
            return "chat-image.jpg";
        }
    }
    async function downloadChatImage(source) {
        const candidate = String(source || "");
        if (!/^https?:\/\//i.test(candidate) && !/^data:image\//i.test(candidate)) {
            setStatus("That chat image cannot be downloaded safely.", "warning");
            return;
        }
        try {
            const anchor = document.createElement("a");
            anchor.href = candidate;
            anchor.download = chatImageFilename(candidate);
            anchor.rel = "noopener";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setStatus("Chat image download started.", "success");
        }
        catch (error) {
            setStatus(`Couldn’t download the chat image: ${error.message || String(error)}`, "error");
        }
    }
    function openPhotoViewer(source, title, alt, trigger = null, kind = "station") {
        const candidate = String(source || "");
        const permitted = /^data:image\//i.test(candidate) || safeImageUrl(candidate) || candidate === DEFAULT_AVATAR;
        if (!panel || !permitted)
            return;
        const modal = panel.querySelector("[data-role='photo-viewer']");
        if (!modal)
            return;
        modal.dataset.photoKind = kind;
        modal.querySelector("[data-role='photo-title']").textContent = title;
        const image = modal.querySelector("[data-role='photo-image']");
        image.src = candidate;
        image.alt = alt;
        const download = modal.querySelector("[data-role='download-photo']");
        if (download) {
            download.hidden = kind !== "chat";
            download.dataset.imageUrl = kind === "chat" ? candidate : "";
        }
        photoTrigger = trigger;
        modal.hidden = false;
        syncNativeChatVisibility();
        modal.querySelector("[data-role='close-photo']")?.focus();
    }
    function openChatImage(event) {
        const pin = event.target.closest?.(".nch-pin-chat");
        if (pin && chatImageHost?.contains(pin)) {
            const message = pin.closest(".chat-message, [data-message-id]");
            event.preventDefault();
            event.stopImmediatePropagation();
            togglePinnedChatMessage(message, pin.dataset.pinChat);
            return;
        }
        const openPin = event.target.closest?.(".nch-pinned-chat-open");
        if (openPin && chatImageHost?.contains(openPin)) {
            const id = String(openPin.dataset.openPin || "");
            event.preventDefault();
            event.stopImmediatePropagation();
            if (expandedPinnedChatIds.has(id))
                expandedPinnedChatIds.delete(id);
            else
                expandedPinnedChatIds.add(id);
            renderPinnedChatStrip();
            return;
        }
        const unpin = event.target.closest?.(".nch-unpin-chat");
        if (unpin && chatImageHost?.contains(unpin)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            const id = String(unpin.dataset.unpinChat || "");
            pinnedChatMessages.delete(id);
            expandedPinnedChatIds.delete(id);
            renderPinnedChatStrip();
            setStatus("Chat message unpinned.", "success");
            return;
        }
        const chatControl = event.target.closest?.("button, [role='button']");
        const controlLabel = String(chatControl?.getAttribute("aria-label") || chatControl?.title || chatControl?.textContent || "").trim();
        if (/^clear chat history$/i.test(controlLabel)) {
            [0, 75, 300].forEach(delay => window.setTimeout(normalizeLatestChatPrompt, delay));
        }
        const download = event.target.closest?.(".nch-chat-download");
        if (download && chatImageHost?.contains(download)) {
            const image = download.closest(".chat-message-content")?.querySelector("img");
            const source = image?.currentSrc || image?.src || image?.dataset.imageUrl || "";
            if (!source)
                return;
            event.preventDefault();
            event.stopImmediatePropagation();
            downloadChatImage(source);
            return;
        }
        const image = event.target.closest?.(".chat-message-content img");
        if (!image || !chatImageHost?.contains(image))
            return;
        const source = image.currentSrc || image.src || image.dataset.imageUrl || "";
        if (!source)
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        openPhotoViewer(source, "Chat image", image.alt || "Enlarged chat image", image, "chat");
    }
    function dockNativeChatUnsafe() {
        const chat = document.querySelector("hl-chat");
        const slot = panel?.querySelector("[data-role='chat-slot']");
        if (!slot)
            return;
        if (!chat) {
            slot.textContent = "Waiting for NetControl.live chat to load…";
            return;
        }
        slot.textContent = "";
        chat.classList.add("nch-chat-docked", "nch-chat-floating");
        registerSlashBridgeHandler();
        document.dispatchEvent(new Event("nch-helper-slash-enable"));
        positionNativeChat();
        customizeNativeChat();
        applyDisplayPreferences();
        renderHelperChatUi();
    }
    function dockNativeChat() {
        try {
            dockNativeChatUnsafe();
        }
        catch (error) {
            console.warn("NCO Helper native chat docking skipped; local station rendering continues:", error);
        }
    }
    function lockBackgroundScroll() {
        if (backgroundScrollLocked)
            return;
        backgroundScrollLocked = true;
        priorDocumentOverflow = document.documentElement.style.overflow;
        priorBodyOverflow = document.body.style.overflow;
        document.documentElement.classList.add("nch-helper-scroll-locked");
        document.body.classList.add("nch-helper-scroll-locked");
        document.documentElement.style.overflow = "hidden";
        document.body.style.overflow = "hidden";
    }
    function unlockBackgroundScroll() {
        if (!backgroundScrollLocked)
            return;
        backgroundScrollLocked = false;
        document.documentElement.classList.remove("nch-helper-scroll-locked");
        document.body.classList.remove("nch-helper-scroll-locked");
        document.documentElement.style.overflow = priorDocumentOverflow;
        document.body.style.overflow = priorBodyOverflow;
    }
    function setStatus(message, type = "") {
        const target = panel?.querySelector("[data-role='status']");
        if (!target)
            return;
        if (statusTimer) {
            clearTimeout(statusTimer);
            statusTimer = null;
        }
        const sequence = ++statusSequence;
        const displayMessage = message || "Ready.";
        const displayType = message ? (type || "info") : "info";
        const icons = { working: "◌", success: "✓", info: "i", warning: "!", error: "!" };
        const labels = { working: "In progress", success: "Success", info: "Information", warning: "Warning", error: "Error" };
        target.innerHTML = `
      <span class="nch-status-icon" aria-label="${labels[displayType] || "Status"}">${icons[displayType] || "i"}</span>
      <span class="nch-status-message" title="${escapeHtml(displayMessage)}">${escapeHtml(displayMessage)}</span>`;
        target.dataset.type = displayType;
        target.dataset.message = displayMessage;
        target.hidden = false;
        if (message && displayType !== "working") {
            statusTimer = window.setTimeout(() => {
                if (sequence !== statusSequence)
                    return;
                statusTimer = null;
                setStatus("");
            }, 10000);
        }
    }
    function currentRelayIdentity() {
        const callSign = selfCall();
        const station = latestStations.find(item => normalizeCall(item.callSign) === callSign);
        const candidateUserId = station?.userProfile || station?.userId || station?.userID || station?.user_id || "";
        const userId = typeof candidateUserId === "string" || typeof candidateUserId === "number"
            ? String(candidateUserId).trim() : "";
        if (!/^[A-Z0-9/.-]{1,24}$/.test(callSign) || !/^[A-Za-z0-9_-]{1,64}$/.test(userId))
            return null;
        return { netId: npid, callSign, userId, role: station?.role || "netuser" };
    }
    function relayIdentityKey(identity = currentRelayIdentity()) {
        return identity ? `${identity.netId}:${identity.callSign}:${identity.userId}` : "";
    }
    function updateRelayStatus(state, detail = "") {
        relayConnectionState = ["connected", "connecting", "setup_required", "authentication_failed", "unavailable"].includes(state)
            ? state : "unavailable";
        const target = panel?.querySelector("[data-role='relay-status']");
        if (!target)
            return;
        const labels = {
            connected: "Relay connected",
            connecting: "Connecting/reconnecting",
            setup_required: "Relay Setup Required",
            authentication_failed: "Relay authentication failed",
            unavailable: "Relay unavailable"
        };
        const defaultDetails = {
            setup_required: "Open Menu → Relay Setup to add your relay token.",
            authentication_failed: "Relay authentication failed. Open Menu → Relay Setup to verify the saved relay token."
        };
        target.textContent = labels[relayConnectionState];
        target.dataset.state = relayConnectionState;
        target.title = detail || defaultDetails[relayConnectionState] || labels[relayConnectionState];
        target.setAttribute("aria-label", labels[relayConnectionState]);
    }
    function refreshRelaySetup() {
        const identity = currentRelayIdentity();
        const identityTarget = panel?.querySelector("[data-role='relay-identity']");
        const tokenInput = panel?.querySelector("[data-role='relay-token']");
        const tokenHint = panel?.querySelector("[data-role='relay-token-hint']");
        if (identityTarget) {
            identityTarget.textContent = identity
                ? `Detected: Net ${identity.netId} · ${identity.callSign} · user ${identity.userId}`
                : "Waiting for the current NetControl.live station identity.";
        }
        if (tokenInput) {
            tokenInput.placeholder = relayToken ? "Relay token saved locally" : "Paste relay token";
        }
        if (tokenHint) {
            tokenHint.textContent = relayToken
                ? "A relay token is saved in this extension's local Chrome storage."
                : "No relay token is saved.";
            tokenHint.dataset.saved = relayToken ? "true" : "false";
        }
        updateRelayStatus(relayConnectionState);
    }
    function closePhotoViewer() {
        const modal = panel?.querySelector("[data-role='photo-viewer']");
        if (modal)
            modal.hidden = true;
        syncNativeChatVisibility();
        photoTrigger?.focus?.();
        photoTrigger = null;
    }
    function refreshQrzPasswordHint() {
        const input = panel?.querySelector("[data-role='qrz-password']");
        const hint = panel?.querySelector("[data-role='qrz-password-hint']");
        if (!input || !hint)
            return;
        const masked = maskedPasswordHint(qrzPassword);
        input.placeholder = masked;
        hint.textContent = masked ? `Saved password: ${masked}` : "No QRZ password saved.";
        hint.dataset.saved = masked ? "true" : "false";
    }
    function detailsFor(callSign) {
        const call = normalizeCall(callSign);
        const station = latestStations.find(item => normalizeCall(item.callSign) === call);
        const saved = local.details[call] || {};
        const shared = sharedProfiles[call] && typeof sharedProfiles[call] === "object" ? sharedProfiles[call] : {};
        const nameOverride = Boolean(shared.nameOverride ?? saved.nameOverride);
        const locationOverride = Boolean(shared.locationOverride ?? saved.locationOverride);
        const storedName = nameOverride ? shared.name ?? saved.name : saved.name;
        const storedLocation = locationOverride ? shared.location ?? saved.location : saved.location;
        return {
            location: locationOverride ? formatLocation(storedLocation) : formatLocation(String(storedLocation || "").trim() || station?.location || ""),
            name: nameOverride
                ? formatName(String(storedName || "").trim())
                : formatName((Number(saved.qrzNameVersion || 0) === 2 ? String(storedName || "").trim() : "") || station?.displayName || ""),
            nameOverride,
            locationOverride,
            qrzPhoto: safeImageUrl(saved.qrzPhoto) || safeImageUrl(station?.photo),
            qrzPhotoChecked: Boolean(saved.qrzPhotoChecked),
            qrzCheckedAt: Number(saved.qrzCheckedAt || 0),
            qrzNameVersion: Number(saved.qrzNameVersion || 0),
            mobile: Boolean(saved.mobile),
            portable: Boolean(saved.portable),
            shortTime: Boolean(saved.shortTime),
            notResponding: Boolean(saved.notResponding),
            neededNext: Boolean(saved.neededNext),
            skipped: Boolean(saved.skipped),
            specialGuest: Boolean(saved.specialGuest),
            pendingRole: ["netuser", "netrelay", "netlogger", "netcontrol"].includes(saved.pendingRole) ? saved.pendingRole : "",
            recheck: Array.isArray(local.recheckCalls) && local.recheckCalls.includes(call),
            note: String(saved.note || "").slice(0, NOTE_MAX)
        };
    }
    async function resolvedAvatarSource(candidate) {
        if (resolvedAvatarDataUrls.has(candidate))
            return resolvedAvatarDataUrls.get(candidate);
        if (avatarSourceCache.has(candidate))
            return avatarSourceCache.get(candidate);
        const pending = (async () => {
            return safeImageUrl(candidate);
        })();
        avatarSourceCache.set(candidate, pending);
        const source = await pending;
        if (source)
            resolvedAvatarDataUrls.set(candidate, source);
        if (!source) {
            window.setTimeout(() => {
                if (avatarSourceCache.get(candidate) === pending)
                    avatarSourceCache.delete(candidate);
            }, 10000);
        }
        return source;
    }
    function hydrateAvatars(root = panel) {
        root?.querySelectorAll("img.nch-avatar[data-qrz-photo]").forEach(image => {
            const candidate = safeImageUrl(image.dataset.qrzPhoto);
            if (!candidate || image.dataset.loading === "true" || resolvedAvatarDataUrls.get(candidate) === image.src)
                return;
            image.dataset.loading = "true";
            image.addEventListener("error", () => {
                if (image.src !== DEFAULT_AVATAR) {
                    image.classList.remove("nch-avatar-qrz");
                    image.src = DEFAULT_AVATAR;
                }
            });
            resolvedAvatarSource(candidate).then(source => {
                if (!source) {
                    image.classList.remove("nch-avatar-qrz");
                    image.src = DEFAULT_AVATAR;
                    return;
                }
                const preload = new Image();
                preload.onload = async () => {
                    try {
                        if (preload.decode)
                            await preload.decode();
                        if (image.isConnected && image.dataset.qrzPhoto === candidate) {
                            image.src = source;
                            image.classList.add("nch-avatar-qrz");
                        }
                    }
                    catch {
                        image.src = DEFAULT_AVATAR;
                    }
                };
                preload.onerror = () => { if (image.isConnected)
                    image.src = DEFAULT_AVATAR; };
                preload.src = source;
            });
        });
    }
    function quickTagState(tag, state) {
        const button = panel?.querySelector(`[data-quick-tag='${tag}']`);
        if (!button)
            return false;
        if (typeof state === "boolean") {
            button.setAttribute("aria-pressed", String(state));
            button.classList.toggle("is-active", state);
        }
        return button.getAttribute("aria-pressed") === "true";
    }
    function saveEditor() {
        if (!panel)
            return null;
        const call = normalizeCall(panel.querySelector("[data-role='callsign']").value);
        if (!call)
            return null;
        const current = detailsFor(call);
        local.details[call] = {
            ...current,
            location: formatLocation(panel.querySelector("[data-role='location']").value),
            name: formatName(panel.querySelector("[data-role='name']").value),
            qrzNameVersion: 2,
            mobile: quickTagState("mobile"),
            portable: quickTagState("portable"),
            shortTime: quickTagState("shortTime"),
            notResponding: current.notResponding,
            neededNext: current.neededNext
        };
        storageSet();
        return call;
    }
    function loadEditor(callSign) {
        if (!panel)
            return;
        const call = normalizeCall(callSign);
        const details = detailsFor(call);
        panel.querySelector("[data-role='callsign']").value = call;
        panel.querySelector("[data-role='name']").value = details.name;
        panel.querySelector("[data-role='location']").value = details.location;
        quickTagState("mobile", details.mobile);
        quickTagState("portable", details.portable);
        quickTagState("shortTime", details.shortTime);
    }
    function clearEditor() {
        panel.querySelector("[data-role='callsign']").value = "";
        panel.querySelector("[data-role='name']").value = "";
        panel.querySelector("[data-role='location']").value = "";
        ["mobile", "portable", "shortTime"].forEach(tag => quickTagState(tag, false));
        panel.querySelector("[data-role='callsign']").focus();
    }
    function openEditModal(callSign) {
        if (!canManageStations())
            return setStatus("Station editing is not available in this helper mode.", "warning");
        const call = normalizeCall(callSign);
        const details = detailsFor(call);
        const modal = panel.querySelector("[data-role='edit-modal']");
        modal.dataset.originalCall = call;
        modal.querySelector("[data-modal='callsign']").value = call;
        modal.querySelector("[data-modal='name']").value = details.name;
        modal.querySelector("[data-modal='location']").value = details.location;
        const station = latestStations.find(item => normalizeCall(item.callSign) === call);
        const protectedForLogger = !isNcoUser() && ["netcontrol", "netlogger"].includes(station?.role || "");
        modal.querySelector("[data-modal='callsign']").disabled = protectedForLogger;
        modal.hidden = false;
        syncNativeChatVisibility();
        modal.querySelector("[data-modal='callsign']").focus();
    }
    function closeEditModal() {
        const modal = panel.querySelector("[data-role='edit-modal']");
        modal.hidden = true;
        modal.dataset.originalCall = "";
        syncNativeChatVisibility();
    }
    function replaceCallInLocalLists(oldCall, newCall) {
        ["order", "checkedOutOrder", "lurkerOrder"].forEach(key => {
            local[key] = local[key].map(call => call === oldCall ? newCall : call)
                .filter((call, index, list) => list.indexOf(call) === index);
        });
        local.ioCalls = local.ioCalls.map(call => call === oldCall ? newCall : call)
            .filter((call, index, list) => list.indexOf(call) === index);
        local.hiddenCalls = local.hiddenCalls.filter(call => call !== oldCall && call !== newCall);
        hiddenCalls.delete(oldCall);
        hiddenCalls.delete(newCall);
    }
    async function correctCallsign(oldCall, newCall, station, editedDetails) {
        if (station?.role === "netcontrol") {
            setStatus("The NCO callsign can only change through a formal handoff.", "warning");
            return false;
        }
        if (station?.role === "netlogger" && !isNcoUser()) {
            setStatus("Only the NCO can correct a Logger callsign and restore that role.", "warning");
            return false;
        }
        if (!/^[A-Z0-9/-]{2,15}$/.test(newCall)) {
            setStatus("Enter a valid callsign using letters, numbers, slash, or hyphen.", "warning");
            return false;
        }
        if (latestStations.some(item => normalizeCall(item.callSign) === newCall)) {
            setStatus(`${newCall} is already present on this net.`, "warning");
            return false;
        }
        if (!confirm(`Correct ${oldCall} to ${newCall}? The original will be unchecked and the corrected callsign will be logged.`))
            return false;
        await lookupQrz(newCall);
        const qrzDetails = detailsFor(newCall);
        const oldRaw = local.details[oldCall] || {};
        const succeededUndo = await runCommand(`ui ${oldCall}`);
        if (!succeededUndo)
            return false;
        const newCommand = station?.checkedState === false ? `io ${newCall}` : `i ${newCall}`;
        const succeededAdd = await runCommand(newCommand);
        if (!succeededAdd) {
            const rollbackCommand = station?.checkedState === false ? `io ${oldCall}` : `i ${oldCall}`;
            await runCommand(rollbackCommand);
            setStatus(`Couldn’t add ${newCall}; ${oldCall} was restored.`, "error");
            return false;
        }
        let roleRestored = true;
        if (station?.role === "netlogger")
            roleRestored = await runCommand(`l ${newCall}`);
        if (station?.role === "netrelay")
            roleRestored = await runCommand(`r ${newCall}`);
        const correctedNameOverride = editedDetails.nameChanged ? Boolean(editedDetails.name) : Boolean(oldRaw.nameOverride);
        local.details[newCall] = {
            ...qrzDetails,
            ...oldRaw,
            name: editedDetails.nameChanged ? editedDetails.name : (qrzDetails.name || editedDetails.name),
            nameOverride: correctedNameOverride,
            location: editedDetails.locationChanged ? editedDetails.location : (qrzDetails.location || editedDetails.location),
            locationOverride: editedDetails.locationChanged ? Boolean(editedDetails.location) : Boolean(oldRaw.locationOverride),
            qrzPhoto: qrzDetails.qrzPhoto,
            qrzPhotoChecked: Boolean((local.details[newCall] || {}).qrzPhotoChecked),
            qrzNameVersion: 2,
            note: String(editedDetails.note || oldRaw.note || "").slice(0, NOTE_MAX)
        };
        const correctedManualProfile = {};
        if (editedDetails.nameChanged)
            Object.assign(correctedManualProfile, {
                name: local.details[newCall].nameOverride ? formatName(local.details[newCall].name) : "",
                nameOverride: Boolean(local.details[newCall].nameOverride), nameOrigin: "manual"
            });
        if (editedDetails.locationChanged)
            Object.assign(correctedManualProfile, {
                location: local.details[newCall].locationOverride ? formatLocation(local.details[newCall].location) : "",
                locationOverride: Boolean(local.details[newCall].locationOverride), locationOrigin: "manual"
            });
        const correctedAuthorityTime = Date.now();
        const correctedAuthority = Object.keys(correctedManualProfile).length
            ? applyProfileCandidate(newCall, correctedManualProfile, currentUserRole, correctedAuthorityTime, `local-correction-${correctedAuthorityTime}`)
            : { accepted: {} };
        delete sharedProfiles[oldCall];
        storeSharedProfiles();
        delete local.details[oldCall];
        replaceCallInLocalLists(oldCall, newCall);
        markIo(newCall, station?.checkedState === false);
        storageSet();
        publishSharedTags(newCall);
        publishSharedProfile(newCall, correctedAuthority.accepted);
        closeEditModal();
        renderQueue();
        setStatus(roleRestored
            ? `Callsign corrected from ${oldCall} to ${newCall}.`
            : `${newCall} was corrected, but its prior role could not be restored.`, roleRestored ? "success" : "warning");
        return true;
    }
    async function saveEditModal() {
        if (!canManageStations())
            return setStatus("Station editing is not available in this helper mode.", "warning");
        const modal = panel.querySelector("[data-role='edit-modal']");
        const oldCall = normalizeCall(modal.dataset.originalCall);
        const call = normalizeCall(modal.querySelector("[data-modal='callsign']").value);
        const current = detailsFor(oldCall);
        const station = latestStations.find(item => normalizeCall(item.callSign) === oldCall);
        if (!call)
            return setStatus("Enter a callsign.", "warning");
        const editedDetails = {
            ...current,
            name: formatName(modal.querySelector("[data-modal='name']").value),
            qrzNameVersion: 2,
            location: formatLocation(modal.querySelector("[data-modal='location']").value),
            nameChanged: formatName(modal.querySelector("[data-modal='name']").value) !== current.name,
            locationChanged: formatLocation(modal.querySelector("[data-modal='location']").value) !== current.location
        };
        editedDetails.nameOverride = editedDetails.nameChanged ? Boolean(editedDetails.name) : current.nameOverride;
        editedDetails.locationOverride = editedDetails.locationChanged ? Boolean(editedDetails.location) : current.locationOverride;
        if (call !== oldCall) {
            await correctCallsign(oldCall, call, station, editedDetails);
            return;
        }
        const { nameChanged, locationChanged, ...savedDetails } = editedDetails;
        const manualProfile = {};
        if (nameChanged)
            Object.assign(manualProfile, {
                name: savedDetails.nameOverride ? savedDetails.name : "", nameOverride: Boolean(savedDetails.nameOverride), nameOrigin: "manual"
            });
        if (locationChanged)
            Object.assign(manualProfile, {
                location: savedDetails.locationOverride ? savedDetails.location : "", locationOverride: Boolean(savedDetails.locationOverride), locationOrigin: "manual"
            });
        const authorityTime = Date.now();
        const authorityResult = Object.keys(manualProfile).length
            ? applyProfileCandidate(call, manualProfile, currentUserRole, authorityTime, `local-manual-${authorityTime}`)
            : { accepted: {}, rejected: [] };
        for (const field of authorityResult.rejected) {
            savedDetails[field] = current[field];
            savedDetails[`${field}Override`] = current[`${field}Override`];
        }
        local.details[call] = { ...local.details[call], ...savedDetails };
        storageSet();
        publishSharedProfile(call, authorityResult.accepted);
        closeEditModal();
        renderQueue();
        setStatus(authorityResult.rejected.length
            ? `${call} kept the NCO-authoritative ${authorityResult.rejected.join(" and ")}.`
            : `${call} information saved.`, authorityResult.rejected.length ? "warning" : "success");
    }
    function ordered(stations, key) {
        const calls = stations.map(station => normalizeCall(station.callSign));
        local[key] = local[key].filter(call => calls.includes(call) || hiddenCalls.has(call));
        calls.forEach(call => { if (!local[key].includes(call))
            local[key].push(call); });
        return [...stations].sort((a, b) => local[key].indexOf(normalizeCall(a.callSign)) - local[key].indexOf(normalizeCall(b.callSign)));
    }
    function markIo(callSign, state) {
        const call = normalizeCall(callSign);
        local.ioCalls = local.ioCalls.filter(item => item !== call);
        if (state)
            local.ioCalls.push(call);
        storageSet();
    }
    function setRecheck(callSign, state, persist = true) {
        const call = normalizeCall(callSign);
        local.recheckCalls = Array.isArray(local.recheckCalls) ? local.recheckCalls.filter(item => item !== call) : [];
        if (state)
            local.recheckCalls.push(call);
        if (persist)
            storageSet();
    }
    function clearCheckoutAlerts(callSign) {
        const call = normalizeCall(callSign);
        const current = detailsFor(call);
        local.details[call] = { ...current, notResponding: false, neededNext: false, skipped: false };
        setRecheck(call, false, false);
        storageSet();
    }
    function restoreHiddenCall(callSign, publish = true) {
        const call = normalizeCall(callSign);
        if (!hiddenCalls.has(call))
            return false;
        hiddenCalls.delete(call);
        hiddenAwayCalls.delete(call);
        local.hiddenCalls = [...hiddenCalls];
        storageSet();
        if (publish)
            publishSharedVisibility(call, false);
        return true;
    }
    async function changeStationRole(callSign, desiredRole) {
        if (!canManageStations())
            return false;
        const call = normalizeCall(callSign);
        const station = latestStations.find(item => normalizeCall(item.callSign) === call);
        if (!station || !["netuser", "netrelay", "netlogger", "netcontrol"].includes(desiredRole))
            return false;
        if (!isNcoUser() && !["netuser", "netrelay"].includes(desiredRole)) {
            setStatus("Only the NCO can assign Logger or transfer NCO control.", "warning");
            return false;
        }
        if (!isNcoUser() && station.role === "netlogger") {
            setStatus("Only the NCO can change another Logger's role.", "warning");
            return false;
        }
        if (station.checkedState !== true) {
            const current = detailsFor(call);
            local.details[call] = { ...current, pendingRole: desiredRole };
            storageSet();
            renderQueue();
            setStatus(`${call} will be assigned ${desiredRole === "netuser" ? "Viewer" : desiredRole.replace(/^net/, "")} after check-in.`, "success");
            return true;
        }
        const currentRole = station.role || "netuser";
        if (currentRole === desiredRole)
            return true;
        if (currentRole === "netcontrol" && call === selfCall()) {
            setStatus("Use NCO handoff on another active station to leave the NCO role.", "warning");
            return false;
        }
        let command = "";
        if (desiredRole === "netlogger")
            command = `l ${call}`;
        if (desiredRole === "netrelay")
            command = `r ${call}`;
        if (desiredRole === "netcontrol") {
            if (!confirm(`Make ${call} the NCO? This transfers net control to ${call} and makes you the Logger.`))
                return false;
            command = `handoff ${call}`;
        }
        if (desiredRole === "netuser") {
            if (currentRole === "netlogger")
                command = `l ${call}`;
            if (currentRole === "netrelay")
                command = `r ${call}`;
            if (currentRole === "netuser")
                return true;
        }
        if (!command || !await runCommand(command))
            return false;
        local.details[call] = { ...detailsFor(call), pendingRole: "" };
        storageSet();
        if (desiredRole === "netcontrol") {
            closedAfterHandoff = true;
            stopSync();
            restoreNativeChat();
            unlockBackgroundScroll();
            panel?.remove();
            panel = null;
        }
        return true;
    }
    async function applyPendingRole(callSign) {
        const call = normalizeCall(callSign);
        const pendingRole = detailsFor(call).pendingRole;
        if (!pendingRole || pendingRole === "netuser") {
            if (pendingRole) {
                local.details[call] = { ...detailsFor(call), pendingRole: "" };
                storageSet();
            }
            return true;
        }
        await refresh();
        return changeStationRole(call, pendingRole);
    }
    async function setRowTag(callSign, tag) {
        if (!canManageStations())
            return false;
        const call = normalizeCall(callSign);
        const station = latestStations.find(item => normalizeCall(item.callSign) === call);
        const current = detailsFor(call);
        if (!station)
            return false;
        if (tag === "inOut") {
            const active = local.ioCalls.includes(call);
            if (active)
                markIo(call, false);
            else if (station.checkedState === true) {
                if (!await runCommand(`o ${call}`))
                    return false;
                clearCheckoutAlerts(call);
                markIo(call, true);
            }
            else if (station.checkedState === null) {
                await lookupAndCheckIn(call, null, "io");
            }
            else
                markIo(call, true);
        }
        else if (tag === "recheck") {
            if (station.checkedState !== true)
                return false;
            setRecheck(call, !current.recheck);
        }
        else {
            local.details[call] = { ...current, [tag]: !Boolean(current[tag]) };
            storageSet();
        }
        publishSharedTags(call);
        renderQueue();
        return true;
    }
    function setSpecialGuest(callSign, state) {
        if (!canManageStations())
            return false;
        const call = normalizeCall(callSign);
        const station = latestStations.find(item => normalizeCall(item.callSign) === call);
        if (!station)
            return false;
        const current = detailsFor(call);
        const nextState = typeof state === "boolean" ? state : !current.specialGuest;
        if (Boolean(current.specialGuest) === nextState)
            return false;
        local.details[call] = { ...current, specialGuest: nextState };
        storageSet();
        publishSharedTags(call);
        renderQueue();
        setStatus(`${call} ${nextState ? "assigned as" : "removed from"} Special Guest.`, "success");
        return true;
    }
    function clearLocalStationTags(callSign, tags) {
        const call = normalizeCall(callSign);
        const current = detailsFor(call);
        const next = { ...current };
        let changed = false;
        for (const tag of tags) {
            if (tag === "recheck") {
                if (!current.recheck)
                    continue;
                setRecheck(call, false, false);
            }
            else if (tag === "inOut") {
                if (!local.ioCalls.includes(call))
                    continue;
                local.ioCalls = local.ioCalls.filter(item => item !== call);
            }
            else {
                if (!next[tag])
                    continue;
                next[tag] = false;
            }
            changed = true;
        }
        if (!changed)
            return false;
        local.details[call] = next;
        storageSet();
        publishSharedTags(call);
        renderQueue();
        return true;
    }
    async function clearRowTag(callSign, tag) {
        if (!canManageStations())
            return false;
        const call = normalizeCall(callSign);
        const station = latestStations.find(item => normalizeCall(item.callSign) === call);
        if (!station)
            return false;
        if (tag === "highlight")
            return station.highlight
                ? setStationInteraction(call, "highlight", false)
                : false;
        if (tag === "specialGuest") {
            return setSpecialGuest(call, false);
        }
        return clearLocalStationTags(call, [tag]);
    }
    function hasClearableStationTags(callSign) {
        if (!canManageStations())
            return false;
        const call = normalizeCall(callSign);
        const station = latestStations.find(item => normalizeCall(item.callSign) === call);
        if (!station?.checkedState)
            return false;
        const details = detailsFor(call);
        return Boolean(station.highlight || local.ioCalls.includes(call) ||
            details.recheck || details.mobile || details.shortTime || details.portable ||
            details.notResponding || details.neededNext || details.skipped || details.specialGuest);
    }
    async function clearStationTags(callSign) {
        const call = normalizeCall(callSign);
        if (!hasClearableStationTags(call))
            return false;
        const station = latestStations.find(item => normalizeCall(item.callSign) === call);
        let changed = station?.highlight ? await setStationInteraction(call, "highlight", false) : false;
        changed = clearLocalStationTags(call, [
            "inOut", "recheck", "mobile", "shortTime", "portable",
            "notResponding", "neededNext", "skipped", "specialGuest"
        ]) || changed;
        if (changed)
            setStatus(`Tags cleared for ${call}.`, "success");
        return changed;
    }
    async function lookupAndCheckIn(callSign, quickTag = null, command = "i") {
        const call = normalizeCall(callSign);
        if (!call)
            return setStatus("Enter a callsign first.", "error");
        const stationBefore = latestStations.find(item => normalizeCall(item.callSign) === call);
        loadEditor(call);
        if (quickTag) {
            ["mobile", "portable", "shortTime"].forEach(tag => quickTagState(tag, tag === quickTag));
            saveEditor();
        }
        saveEditor();
        const succeeded = await runCommand(`${command} ${call}`);
        if (succeeded) {
            restoreHiddenCall(call);
            markIo(call, command === "io");
            if (command === "i") {
                setRecheck(call, stationBefore?.checkedState === false);
                publishSharedTags(call);
                await applyPendingRole(call);
            }
        }
        renderQueue();
        if (succeeded)
            clearEditor();
        return Boolean(succeeded);
    }
    function statusTag(call, key, label, className, removable = canManageStations()) {
        const content = `${escapeHtml(label)}${removable ? '<span aria-hidden="true">×</span>' : ""}`;
        return removable
            ? `<button class="nch-tag ${className}" data-clear-tag="${escapeHtml(key)}" title="Remove ${escapeHtml(label)}" aria-label="Remove ${escapeHtml(label)} from ${escapeHtml(call)}">${content}</button>`
            : `<span class="nch-tag ${className}">${content}</span>`;
    }
    function roleBadge(station, details, call) {
        const role = details.specialGuest ? "specialGuest" : station.role || "netuser";
        if (station.checkedState !== true || role === "netuser")
            return "";
        const labels = { netcontrol: "NCO", netlogger: "LOGGER", netrelay: "RELAY", netuser: "VIEWER", specialGuest: "SPECIAL GUEST" };
        const label = labels[role] || "VIEWER";
        const removable = canManageStations() && role !== "netcontrol" &&
            (isNcoUser() || role === "netrelay" || role === "specialGuest");
        const data = role === "specialGuest"
            ? `data-special-guest="${escapeHtml(call)}"`
            : 'data-set-role="netuser"';
        return removable
            ? `<button class="nch-role-badge nch-role-badge-${escapeHtml(role)}" ${data} title="Remove ${escapeHtml(label)}" aria-label="Remove ${escapeHtml(label)} from ${escapeHtml(call)}">${escapeHtml(label)} <span aria-hidden="true">×</span></button>`
            : `<span class="nch-role-badge nch-role-badge-${escapeHtml(role)}">${escapeHtml(label)}</span>`;
    }
    function tagBadges(call, station, details) {
        if (station.checkedState === false)
            return "";
        const tags = [];
        if (station.highlight && station.checkedState === true)
            tags.push(statusTag(call, "highlight", "!", "nch-tag-highlight"));
        if (details.mobile)
            tags.push(statusTag(call, "mobile", "Mobile", "nch-tag-mobile"));
        if (details.shortTime)
            tags.push(statusTag(call, "shortTime", "Short Time", "nch-tag-short-time"));
        if (details.portable)
            tags.push(statusTag(call, "portable", "Portable", "nch-tag-portable"));
        if (station.checkedState === false && local.ioCalls.includes(call))
            tags.push(statusTag(call, "inOut", "I/O", "nch-tag-io"));
        if (station.checkedState === true && details.recheck)
            tags.push(statusTag(call, "recheck", "RECHECK", "nch-tag-recheck"));
        if (station.checkedState === true && details.notResponding)
            tags.push(statusTag(call, "notResponding", "NO REPLY", "nch-tag-no-reply"));
        if (station.checkedState === true && details.neededNext)
            tags.push(statusTag(call, "neededNext", "NEEDED NEXT", "nch-tag-needed"));
        if (station.checkedState === true && details.skipped)
            tags.push(statusTag(call, "skipped", "SKIP", "nch-tag-skip"));
        return tags.join("");
    }
    function noteHtml(call, details) {
        if (editingNoteCall === call) {
            const draft = noteDrafts.has(call) ? noteDrafts.get(call) : details.note;
            return `<span class="nch-note-editor">
        <input data-note-input="${escapeHtml(call)}" maxlength="${NOTE_MAX}" value="${escapeHtml(draft)}" aria-label="Note for ${escapeHtml(call)}">
        <button data-save-note="${escapeHtml(call)}" title="Save note" aria-label="Save note">✓</button>
        <button data-cancel-note="${escapeHtml(call)}" title="Cancel note" aria-label="Cancel note">×</button>
      </span>`;
        }
        return details.note
            ? `<button class="nch-note-preview" data-edit-note="${escapeHtml(call)}" title="Edit note: ${escapeHtml(details.note)}">📝 ${escapeHtml(details.note)}</button>`
            : "";
    }
    const shortcutHint = key => /Mac|iPhone|iPad|iPod/i.test(String(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "")) ? `⌥${key}` : `Alt+${key}`;
    const trayButton = (label, attributes, className = "", active = false, shortcutKey = "") => {
        const shortcutAttributes = shortcutKey
            ? ` aria-keyshortcuts="Alt+${escapeHtml(shortcutKey)}" title="${escapeHtml(label)}"`
            : ` title="${escapeHtml(label)}"`;
        return `<button class="${className}${active ? " is-active" : ""}" ${attributes}${shortcutAttributes} aria-pressed="${active ? "true" : "false"}">${escapeHtml(label)}</button>`;
    };
    function inlineRowActions(station, call, busy) {
        if (!canManageStations())
            return "";
        if (station.checkedState === false) {
            const specialRole = ["netcontrol", "netlogger", "netrelay"].includes(station.role || "");
            const buttons = [
                trayButton("Check In", `data-row-checkin="${escapeHtml(call)}"`, "nch-checkin-btn"),
                !specialRole ? trayButton("Delete", `data-delete="${escapeHtml(call)}"`, "nch-delete-btn") : ""
            ].filter(Boolean).join("");
            return `<span class="nch-inline-actions" aria-label="Checked out actions for ${escapeHtml(call)}">${buttons}</span>`;
        }
        if (station.checkedState === null) {
            return `<span class="nch-inline-actions" aria-label="Lurker actions for ${escapeHtml(call)}">${trayButton(busy ? "Checking In…" : "Check In", `data-add-lurker="${escapeHtml(call)}"${busy ? " disabled" : ""}`, "nch-add-lurker")}</span>`;
        }
        return "";
    }
    function stationActionTray(station, details, call, busy) {
        const manager = canManageStations();
        const active = station.checkedState === true;
        const checkedOut = station.checkedState === false;
        const lurker = station.checkedState === null;
        const isNco = station.role === "netcontrol";
        const specialRole = ["netcontrol", "netlogger", "netrelay"].includes(station.role);
        const alerts = [];
        const status = [];
        const roles = [];
        const manage = [];
        if (manager && active) {
            alerts.push(trayButton("!", `data-toggle-highlight="${escapeHtml(call)}" data-state="${station.highlight ? "true" : "false"}"`, "nch-highlight-toggle", station.highlight, "A"));
            alerts.push(trayButton("Needed Next", `data-needed-next="${escapeHtml(call)}"`, "nch-needed-next", details.neededNext, "N"));
            alerts.push(trayButton("No Reply", `data-no-reply="${escapeHtml(call)}"`, "nch-no-reply-btn", details.notResponding, "R"));
            alerts.push(trayButton("Skip", `data-skip="${escapeHtml(call)}"`, "nch-skip-toggle", details.skipped, "S"));
        }
        if (manager && active) {
            [["mobile", "Mobile", "nch-mobile-toggle"], ["shortTime", "Short Time", "nch-short-time-toggle"], ["portable", "Portable", "nch-portable-toggle"]]
                .forEach(([key, label, className]) => status.push(trayButton(label, `data-set-tag="${key}"`, className, Boolean(details[key]))));
            if (!isNco)
                status.push(trayButton("In & Out", 'data-set-tag="inOut"', "nch-inout-toggle", local.ioCalls.includes(call)));
            if (active)
                status.push(trayButton("Recheck", 'data-set-tag="recheck"', "nch-recheck-toggle", details.recheck));
            if (!specialRole || details.specialGuest)
                status.push(trayButton("Special Guest", `data-special-guest="${escapeHtml(call)}"`, "nch-guest-toggle", details.specialGuest, "G"));
            const roleChoices = [
                ["netuser", "Viewer"], ["netrelay", "Relay"], ["netlogger", "Logger"], ["netcontrol", "NCO"]
            ];
            roleChoices.forEach(([role, label]) => {
                const selected = (details.pendingRole || station.role || "netuser") === role;
                const allowed = isNcoUser() || role === "netrelay" || (role === "netuser" && station.role !== "netlogger");
                if (allowed)
                    roles.push(trayButton(label, `data-set-role="${role}"`, `nch-role-choice nch-role-choice-${role}`, selected));
            });
        }
        manage.push(trayButton("Note", `data-edit-note="${escapeHtml(call)}"`, "nch-note-action", false, "T"));
        if (manager)
            manage.push(trayButton("Edit Station", `data-edit="${escapeHtml(call)}"`, "nch-edit-btn", false, "E"));
        if (manager && active && call !== selfCall() && (isNcoUser() || station.role !== "netcontrol")) {
            manage.push(trayButton("Check Out", `data-row-checkout="${escapeHtml(call)}"`, "nch-checkout-btn", false, "O"));
        }
        if (manager && checkedOut)
            manage.push(trayButton("Check In", `data-row-checkin="${escapeHtml(call)}"`, "nch-checkin-btn"));
        if (manager && lurker)
            manage.push(trayButton(busy ? "Checking In…" : "Check In", `data-add-lurker="${escapeHtml(call)}"${busy ? " disabled" : ""}`, "nch-add-lurker"));
        if (manager && !specialRole)
            manage.push(trayButton("Delete", `data-delete="${escapeHtml(call)}"`, "nch-delete-btn"));
        if (!active)
            return "";
        const group = (label, className, buttons) => buttons.length
            ? `<span class="nch-tray-group ${className}" role="group" aria-label="${escapeHtml(label)}"><small>${escapeHtml(label)}</small><span>${buttons.join("")}</span></span>`
            : "";
        const attentionGroup = group("Attention", "nch-attention-actions", alerts);
        const statusGroup = group("Station status", "nch-status-actions", status);
        const roleGroup = group("Role", "nch-role-actions", roles);
        const managementGroup = group("Management", "nch-management-actions", manage);
        const orderedGroups = active
            ? [managementGroup, statusGroup, attentionGroup, roleGroup]
            : [managementGroup];
        return `<span class="nch-row-actions nch-active-actions" aria-label="Controls for ${escapeHtml(call)}">
      <strong class="nch-tray-title"><span>Controls for ${escapeHtml(call)}</span><button class="nch-tray-help" data-role="commands-help" aria-label="Commands and shortcuts" title="Commands and shortcuts">?</button></strong>
      ${orderedGroups.join("")}
    </span>`;
    }
    const HOTKEY_ACTIONS = Object.freeze({
        KeyO: ".nch-checkout-btn",
        KeyN: ".nch-needed-next",
        KeyR: ".nch-no-reply-btn",
        KeyS: ".nch-skip-toggle",
        KeyA: ".nch-highlight-toggle",
        KeyE: ".nch-edit-btn",
        KeyT: ".nch-note-action",
        KeyG: ".nch-guest-toggle"
    });
    function hotkeyTypingContext(event) {
        const candidates = [...(event.composedPath?.() || [event.target]), document.activeElement].filter(Boolean);
        if (candidates.some(node => {
            if (!(node instanceof Element))
                return false;
            return node.isContentEditable || node.matches("input, textarea, select, form, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='dialog'], [role='alertdialog'], hl-chat");
        }))
            return true;
        return Boolean(panel && [...panel.querySelectorAll("[role='dialog'], [role='alertdialog']")]
            .some(dialog => dialog.getClientRects().length));
    }
    function selectedHotkeyRow() {
        const call = normalizeCall(selectedNextCall);
        if (!call || !panel)
            return null;
        const station = latestStations.find(item => normalizeCall(item.callSign) === call);
        if (station?.checkedState !== true)
            return null;
        const row = panel.querySelector(`[data-role='active'] .nch-row[data-call='${CSS.escape(call)}']`);
        return row ? { call, station, row } : null;
    }
    function moveSelectedHotkey(direction) {
        if (!panel || !canManageStations())
            return false;
        const calls = [...panel.querySelectorAll("[data-role='active'] .nch-row[data-call]")]
            .map(row => normalizeCall(row.dataset.call))
            .filter(call => {
            const station = latestStations.find(item => normalizeCall(item.callSign) === call);
            return station?.checkedState === true && station.role !== "netcontrol";
        });
        if (!calls.length)
            return false;
        const currentIndex = calls.indexOf(normalizeCall(selectedNextCall));
        const nextIndex = currentIndex < 0
            ? (direction > 0 ? 0 : calls.length - 1)
            : currentIndex + direction;
        if (nextIndex < 0 || nextIndex >= calls.length)
            return false;
        const nextCall = calls[nextIndex];
        selectedNextCall = nextCall;
        publishSharedSelection();
        renderQueue();
        setStatus(`${nextCall} selected as the next station.`, "success");
        requestAnimationFrame(() => panel?.querySelector(`[data-role='active'] .nch-row[data-call='${CSS.escape(nextCall)}']`)?.scrollIntoView({ block: "nearest" }));
        return true;
    }
    async function handleActionHotkey(event) {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing)
            return;
        const selector = HOTKEY_ACTIONS[event.code];
        const clearTags = event.code === "KeyC";
        const moveDirection = event.code === "ArrowDown" ? 1 : event.code === "ArrowUp" ? -1 : 0;
        if (!selector && !clearTags && !moveDirection)
            return;
        if (hotkeyTypingContext(event))
            return;
        if (moveDirection) {
            if (!moveSelectedHotkey(moveDirection))
                return;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const selected = selectedHotkeyRow();
        if (!selected)
            return;
        if (clearTags) {
            if (!hasClearableStationTags(selected.call))
                return;
            event.preventDefault();
            event.stopPropagation();
            await clearStationTags(selected.call);
            return;
        }
        const button = selected.row.querySelector(selector);
        if (!button || button.disabled)
            return;
        event.preventDefault();
        event.stopPropagation();
        button.click();
    }
    const slashComposer = () => nativeChat()?.querySelector(".chat-text-input, .chat-message-input, .chat-input, textarea[placeholder^='Message'], input[placeholder^='Message'], [contenteditable='true'][role='textbox']");
    function setSlashComposerText(value) {
        const input = slashComposer();
        if (!input)
            return;
        if ("value" in input)
            input.value = value;
        else
            input.textContent = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const slashNothingSent = message => setStatus(`${message} Nothing was sent.`, "warning");
    const slashDenied = () => slashNothingSent(`That command is not available in ${helperModeLabel()}.`);
    const validCall = call => /^[A-Z0-9/-]{2,15}$/.test(call);
    function slashTarget(rawCall, selectedFallback = true) {
        const explicit = normalizeCall(rawCall);
        const call = explicit || (selectedFallback ? normalizeCall(selectedNextCall) : "");
        if (!call || !validCall(call))
            return null;
        const station = latestStations.find(item => normalizeCall(item.callSign) === call);
        if (!station)
            return null;
        const row = panel?.querySelector(`.nch-row[data-call='${CSS.escape(call)}']`) || null;
        if (!explicit && (station.checkedState !== true || !row?.closest("[data-role='active']")))
            return null;
        return { call, station, row, explicit: Boolean(explicit) };
    }
    function slashHelpHtml() {
        const groups = [
            ["Common", ["help", "note", "edit", "w"]],
            ["Station status", ["next", "nr", "skip", "attn", "clear", "guest"]],
            ["Check-in / net", ["in", "out", "hi", "li", "f"]]
        ];
        const cardFor = command => `<li data-h-command="${escapeHtml(command.name)}">
      <code>${escapeHtml(command.usage)}</code>
      <span>${escapeHtml(command.description)}</span>
      ${command.aliases.length ? `<small>Aliases: ${command.aliases.map(alias => `<kbd>${escapeHtml(alias)}</kbd>`).join(" ")}</small>` : ""}
    </li>`;
        const commandCards = groups.map(([label, names]) => `<section class="nch-command-section">
      <h4>${escapeHtml(label)}</h4>
      <ul class="nch-slash-command-list">${names.map(name => cardFor(SLASH_COMMANDS.find(command => command.name === name))).join("")}</ul>
    </section>`).join("");
        const navigationHotkeys = `<span class="nch-hotkey-navigation"><kbd>${escapeHtml(shortcutHint("↑"))}</kbd> / <kbd>${escapeHtml(shortcutHint("↓"))}</kbd> Previous / next selected station</span>`;
        const hotkeys = navigationHotkeys + [
            ["O", "Check Out"], ["N", "Needed Next"], ["R", "No Reply"], ["S", "Skip"],
            ["A", "Attention"], ["C", "Clear Tags"], ["E", "Edit Station"], ["T", "Note"], ["G", "Special Guest"]
        ].map(([key, label]) => `<span><kbd>${escapeHtml(shortcutHint(key))}</kbd> ${escapeHtml(label)}</span>`).join("");
        return `<h3>Commands and keyboard shortcuts</h3>
      <p class="nch-slash-banner">${escapeHtml(SLASH_HELP_BANNER)}</p>
      <div class="nch-command-sections">${commandCards}</div>
      <h4>Hotkeys</h4>
      <div class="nch-hotkey-grid">${hotkeys}</div>`;
    }
    function showSlashHelp() {
        const help = panel?.querySelector("[data-role='commands-modal']");
        const section = help?.querySelector("[data-role='commands-modal-content']");
        if (section)
            section.innerHTML = slashHelpHtml();
        if (help)
            help.hidden = false;
        syncNativeChatVisibility();
        setStatus("Commands and shortcuts opened.", "success");
    }
    function slashRowButton(target, selector) {
        return target?.row?.querySelector(selector) || null;
    }
    async function runSlashCommand(rawText) {
        const trimmed = String(rawText || "").trim();
        if (trimmed === "/") {
            slashNothingSent("Type /h for NCO Helper commands.");
            return;
        }
        const tokens = trimmed.split(/\s+/);
        if (tokens[0]?.toLocaleLowerCase() !== "/h") {
            slashNothingSent(`Unknown NCO Helper command “${tokens[0] || "/"}”. Type /h for help.`);
            return;
        }
        const actionToken = String(tokens[1] || "help").toLocaleLowerCase();
        const command = SLASH_COMMAND_BY_TOKEN.get(actionToken);
        if (!command) {
            slashNothingSent(`Unknown NCO Helper command “${tokens.slice(0, 2).join(" ")}”. Type /h for help.`);
            return;
        }
        const args = tokens.slice(2);
        const usage = () => slashNothingSent(`Usage: ${command.usage}.`);
        if (command.name === "help") {
            if (args.length)
                return usage();
            showSlashHelp();
            setSlashComposerText("");
            return;
        }
        if (["in", "hi"].includes(command.name)) {
            if (args.length !== 1 || !validCall(normalizeCall(args[0])))
                return usage();
            if (!canManageStations())
                return slashDenied();
            const call = normalizeCall(args[0]);
            setSlashComposerText("");
            const succeeded = await lookupAndCheckIn(call);
            if (succeeded && command.name === "hi")
                await setStationInteraction(call, "highlight", true);
            return;
        }
        if (command.name === "li") {
            if (args.length)
                return usage();
            if (!canManageStations())
                return slashDenied();
            const calls = latestStations.filter(station => station.checkedState === null)
                .map(station => normalizeCall(station.callSign))
                .filter(call => !hiddenCalls.has(call) && panel?.querySelector(`[data-role='lurkers'] [data-call='${CSS.escape(call)}']`));
            if (!calls.length) {
                setStatus("No visible lurkers are available to check in.", "success");
                setSlashComposerText("");
                return;
            }
            if (!confirm(`Check in all ${calls.length} currently visible lurker${calls.length === 1 ? "" : "s"}?`)) {
                slashNothingSent("Lurker check-in cancelled.");
                return;
            }
            setSlashComposerText("");
            let affected = 0;
            for (const call of calls) {
                const current = latestStations.find(station => normalizeCall(station.callSign) === call);
                if (current?.checkedState !== null || hiddenCalls.has(call))
                    continue;
                if (await lookupAndCheckIn(call))
                    affected += 1;
            }
            setStatus(`${affected} visible lurker${affected === 1 ? "" : "s"} checked in.`, "success");
            return;
        }
        if (command.name === "f") {
            if (args.length > 1)
                return usage();
            if (!args.length) {
                setStatus(`Current frequency: ${latestNetFrequency || "not specified"}.`, "success");
                setSlashComposerText("");
                return;
            }
            if (!isNcoUser())
                return slashDenied();
            const frequency = String(args[0] || "").trim();
            if (!frequency || frequency.length > 40 || /[\u0000-\u001f/]/.test(frequency))
                return usage();
            if (!confirm(`Change net frequency from ${latestNetFrequency || "not specified"} to ${frequency}?`)) {
                slashNothingSent("Frequency change cancelled.");
                return;
            }
            setSlashComposerText("");
            await runCommand(`f ${frequency}`);
            return;
        }
        if (command.name === "w") {
            if (args.length > 1)
                return usage();
            const target = slashTarget(args[0], true);
            if (!target)
                return usage();
            const succeeded = await runReadCommand(`w ${target.call}`);
            if (succeeded)
                setSlashComposerText("");
            return;
        }
        if (args.length > 1 || (args[0] && !validCall(normalizeCall(args[0]))))
            return usage();
        const target = slashTarget(args[0], true);
        if (!target)
            return usage();
        if (command.name === "note") {
            const button = slashRowButton(target, ".nch-note-action");
            if (!button)
                return slashDenied();
            setSlashComposerText("");
            button.click();
            return;
        }
        if (!canManageStations())
            return slashDenied();
        if (command.name === "clear") {
            if (!hasClearableStationTags(target.call)) {
                slashNothingSent(`${target.call} has no clearable tags.`);
                return;
            }
            setSlashComposerText("");
            await clearStationTags(target.call);
            return;
        }
        const selectors = {
            out: ".nch-checkout-btn", next: ".nch-needed-next", nr: ".nch-no-reply-btn",
            skip: ".nch-skip-toggle", attn: ".nch-highlight-toggle",
            edit: ".nch-edit-btn", guest: ".nch-guest-toggle"
        };
        const button = slashRowButton(target, selectors[command.name]);
        if (!button || button.disabled)
            return slashDenied();
        setSlashComposerText("");
        button.click();
    }
    function handleSlashBridgeEvent(event) {
        if (!panel || !nativeChat()?.classList.contains("nch-helper-slash-owned"))
            return;
        let payload;
        try {
            payload = JSON.parse(String(event.detail || "{}"));
        }
        catch {
            return;
        }
        const text = String(payload.text || "");
        if (!text.trimStart().startsWith("/"))
            return;
        runSlashCommand(text).catch(error => setStatus(error.message || String(error), "error"));
    }
    function registerSlashBridgeHandler() {
        if (slashBridgeHandlerRegistered)
            return;
        document.addEventListener("nch-helper-slash-command", handleSlashBridgeEvent);
        slashBridgeHandlerRegistered = true;
    }
    function unregisterSlashBridgeHandler() {
        if (!slashBridgeHandlerRegistered)
            return;
        document.removeEventListener("nch-helper-slash-command", handleSlashBridgeEvent);
        slashBridgeHandlerRegistered = false;
    }
    function stationRow(station, group) {
        const call = normalizeCall(station.callSign);
        const details = detailsFor(call);
        const isNco = station.role === "netcontrol";
        const manager = canManageStations();
        const busy = busyCalls.has(call);
        const roleClass = ` nch-role-${details.specialGuest ? "specialGuest" : station.role || "netuser"}${station.checkedState === true && call === selectedNextCall ? " nch-selected-next" : ""}${pinnedActionCall === call ? " nch-actions-pinned" : ""}`;
        const avatarTitle = details.qrzPhoto
            ? `QRZ photo for ${call}`
            : details.qrzPhotoChecked
                ? `QRZ returned no photo for ${call}; using the default avatar`
                : `Default avatar until QRZ lookup completes for ${call}`;
        const resolvedPhoto = details.qrzPhoto ? resolvedAvatarDataUrls.get(details.qrzPhoto) || "" : "";
        const avatarImage = `<img class="nch-avatar${resolvedPhoto ? " nch-avatar-qrz" : ""}" src="${escapeHtml(resolvedPhoto || DEFAULT_AVATAR)}"${details.qrzPhoto ? ` data-qrz-photo="${escapeHtml(details.qrzPhoto)}"` : ""} alt="${escapeHtml(call)} profile" title="${escapeHtml(avatarTitle)}">`;
        const avatar = `<button class="nch-avatar-button" data-view-photo="${escapeHtml(call)}" title="View larger photo for ${escapeHtml(call)}">${avatarImage}</button>`;
        const canChangeHand = manager || call === selfCall();
        const hand = canChangeHand
            ? `<button class="nch-hand-toggle${station.hand ? " is-active" : ""}" data-toggle-hand="${escapeHtml(call)}" data-state="${station.hand ? "true" : "false"}" title="${station.hand ? "Lower" : "Raise"} ${escapeHtml(call)}'s hand" aria-label="${station.hand ? "Lower" : "Raise"} ${escapeHtml(call)}'s hand">✋</button>`
            : station.hand
                ? '<span class="nch-hand" title="Hand raised" aria-label="Hand raised">✋</span>'
                : "";
        const pinned = station.checkedState === true && (isNco || ["netlogger", "netrelay"].includes(station.role) || details.specialGuest);
        const rowDraggable = manager && !pinned;
        const dragHandle = rowDraggable
            ? `<span class="nch-drag" title="Drag this row to reorder" aria-label="Drag ${escapeHtml(call)} to reorder">⋮⋮</span>`
            : `<span class="nch-drag nch-drag-locked" title="${pinned ? "Pinned station" : "Read-only order"}">•</span>`;
        const pulse = pulsePresentation(call);
        return `
      <div class="nch-row nch-has-actions${station.checkedState === null ? " nch-lurker-row" : ""}${station.checkedState === false ? " nch-checked-out" : ""}${station.checkedState === true && station.highlight ? " nch-highlighted" : ""}${station.checkedState === true && details.notResponding ? " nch-not-responding" : ""}${station.checkedState === true && details.neededNext ? " nch-needed-next-row" : ""}${station.checkedState === true && details.skipped ? " nch-skip-row" : ""}${details.specialGuest ? " nch-special-guest-row" : ""}${isNco ? " nch-nco-row" : ""}${roleClass}${pulse.className}" data-call="${escapeHtml(call)}" data-group="${group}" data-pinned="${pinned ? "true" : "false"}" tabindex="0" aria-label="${escapeHtml(call)} station row"${rowDraggable ? ' draggable="true"' : ""}${pulse.style}>
        ${dragHandle}
        <div class="nch-station">${avatar}<span class="nch-call-block"><span class="nch-call-line${call.length > 10 ? " nch-call-extra-long" : call.length > 6 ? " nch-call-long" : ""}">${escapeHtml(call)}</span></span><span class="nch-hand-slot">${hand}</span></div>
        <span class="nch-row-info"><span class="nch-row-text"><span class="nch-meta"><span class="nch-detail-line"><span class="nch-detail" title="${escapeHtml([details.name, details.location].filter(Boolean).join(" — "))}">${escapeHtml([details.name, details.location].filter(Boolean).join(" — "))}</span></span>${noteHtml(call, details)}</span><span class="nch-status-tags" aria-label="Station status">${roleBadge(station, details, call)}${tagBadges(call, station, details)}</span></span>${inlineRowActions(station, call, busy)}</span>
        ${stationActionTray(station, details, call, busy)}
      </div>`;
    }
    function renderQueue() {
        if (!panel)
            return;
        const focusedNote = document.activeElement?.matches?.("[data-note-input]")
            ? {
                call: normalizeCall(document.activeElement.dataset.noteInput),
                value: document.activeElement.value,
                start: document.activeElement.selectionStart,
                end: document.activeElement.selectionEnd
            }
            : null;
        if (focusedNote)
            noteDrafts.set(focusedNote.call, focusedNote.value);
        const visibleStations = latestStations.filter(s => !hiddenCalls.has(normalizeCall(s.callSign)));
        if (pinnedActionCall && !visibleStations.some(s => normalizeCall(s.callSign) === pinnedActionCall))
            pinnedActionCall = "";
        panel.classList.toggle("nch-has-pinned-actions", Boolean(pinnedActionCall));
        const checkedOut = ordered(visibleStations.filter(s => s.checkedState === false), "checkedOutOrder");
        const activeRaw = visibleStations.filter(s => s.checkedState === true);
        const lurkers = ordered(visibleStations.filter(s => s.checkedState === null), "lurkerOrder");
        activeRaw.forEach(station => {
            local.ioCalls = local.ioCalls.filter(call => call !== normalizeCall(station.callSign));
        });
        const activeOrdered = ordered(activeRaw, "order");
        const ncos = activeOrdered.filter(s => s.role === "netcontrol");
        const loggers = activeOrdered.filter(s => s.role === "netlogger");
        const relays = activeOrdered.filter(s => s.role === "netrelay");
        const guests = activeOrdered.filter(s => !["netcontrol", "netlogger", "netrelay"].includes(s.role) && detailsFor(s.callSign).specialGuest);
        const active = activeOrdered.filter(s => !ncos.includes(s) && !loggers.includes(s) && !relays.includes(s) && !guests.includes(s));
        panel.querySelector("[data-role='checked-out']").innerHTML =
            checkedOut.map(s => stationRow(s, "checkedOutOrder")).join("") || `<p class="nch-empty">None</p>`;
        const displayedActive = [...ncos, ...loggers, ...relays, ...guests, ...active];
        const activeList = panel.querySelector("[data-role='active']");
        activeList.innerHTML =
            displayedActive.map(s => stationRow(s, "order")).join("") || `<p class="nch-empty">None</p>`;
        if (scrollActiveAfterRender) {
            scrollActiveAfterRender = false;
            requestAnimationFrame(() => { activeList.scrollTop = activeList.scrollHeight; });
        }
        const activeHeadingNote = panel.querySelector("[data-role='active-order-note']");
        if (activeHeadingNote)
            activeHeadingNote.textContent = canManageStations()
                ? "NCO, Logger, Relay, and Special Guest are fixed; drag other stations to reorder"
                : "Read-only order managed by the NCO or Logger";
        const checkedOutHeadingNote = panel.querySelector("[data-role='checked-out-order-note']");
        if (checkedOutHeadingNote)
            checkedOutHeadingNote.textContent = canManageStations() ? "drag to reorder" : "read only";
        panel.querySelector("[data-role='lurkers']").innerHTML =
            lurkers.map(s => stationRow(s, "lurkerOrder")).join("") || `<p class="nch-empty">None</p>`;
        const loggedCount = visibleStations.filter(station => typeof station.checkedState === "boolean").length;
        const activeCount = visibleStations.filter(station => station.checkedState === true).length;
        const checkedOutCount = visibleStations.filter(station => station.checkedState === false).length;
        const recheckCount = visibleStations.filter(station => station.checkedState === true && detailsFor(station.callSign).recheck).length;
        panel.querySelector("[data-role='logged-count']").textContent = String(loggedCount);
        panel.querySelector("[data-role='active-count']").textContent = String(activeCount);
        panel.querySelector("[data-role='checked-out-count']").textContent = String(checkedOutCount);
        panel.querySelector("[data-role='recheck-count']").textContent = String(recheckCount);
        storageSet();
        hydrateAvatars();
        queueMissingQrzPhotos();
        renderHelperChatUi();
        if (focusedNote && editingNoteCall === focusedNote.call) {
            const input = panel.querySelector(`[data-note-input='${CSS.escape(focusedNote.call)}']`);
            input?.focus();
            input?.setSelectionRange(focusedNote.start, focusedNote.end);
        }
        else if (editingNoteCall && (!document.activeElement || document.activeElement === document.body)) {
            const input = panel.querySelector(`[data-note-input='${CSS.escape(editingNoteCall)}']`);
            input?.focus();
            input?.setSelectionRange(input.value.length, input.value.length);
        }
        requestAnimationFrame(() => {
            const targetRow = pinnedActionCall
                ? panel.querySelector(`[data-call='${CSS.escape(pinnedActionCall)}']`)
                : panel.querySelector(".nch-row:hover, .nch-row:focus-within");
            orientRowActions(targetRow);
        });
        syncViewer();
    }
    function orientRowActions(row) {
        if (!panel || !(row instanceof Element) || !row.classList.contains("nch-row"))
            return;
        const tray = row.querySelector(":scope > .nch-row-actions");
        if (!(tray instanceof Element))
            return;
        row.classList.remove("nch-actions-above");
        const trayStyle = tray.style;
        const previous = {
            display: trayStyle.display,
            visibility: trayStyle.visibility,
            pointerEvents: trayStyle.pointerEvents
        };
        const hidden = getComputedStyle(tray).display === "none";
        if (hidden) {
            trayStyle.display = "grid";
            trayStyle.visibility = "hidden";
            trayStyle.pointerEvents = "none";
        }
        const rowBox = row.getBoundingClientRect();
        const trayBox = tray.getBoundingClientRect();
        const scrollerBox = row.closest(".nch-module-content")?.getBoundingClientRect();
        const panelBox = panel.getBoundingClientRect();
        const bottomLimit = Math.min(window.innerHeight, panelBox.bottom, scrollerBox?.bottom ?? panelBox.bottom);
        const topLimit = Math.max(0, panelBox.top, scrollerBox?.top ?? panelBox.top);
        const belowSpace = bottomLimit - rowBox.bottom;
        const aboveSpace = rowBox.top - topLimit;
        const wouldClipBelow = rowBox.bottom + trayBox.height > bottomLimit - 6;
        const canFitAbove = rowBox.top - trayBox.height >= topLimit - 2;
        if (wouldClipBelow && (canFitAbove || aboveSpace >= belowSpace))
            row.classList.add("nch-actions-above");
        if (hidden) {
            trayStyle.display = previous.display;
            trayStyle.visibility = previous.visibility;
            trayStyle.pointerEvents = previous.pointerEvents;
        }
    }
    function clearActionOrientationRows() {
        panel?.querySelectorAll(".nch-actions-above").forEach(row => row.classList.remove("nch-actions-above"));
    }
    function clearDropIndicators() {
        panel?.querySelectorAll(".nch-drop-before, .nch-drop-after").forEach(row => row.classList.remove("nch-drop-before", "nch-drop-after"));
    }
    function moveDragged(targetCall, targetGroup, after = false) {
        if (!canManageStations()) {
            setStatus("Only the NCO or Logger can reorder the log.", "warning");
            return;
        }
        if (!dragging || dragging.group !== targetGroup || dragging.call === targetCall)
            return;
        if (targetGroup === "order") {
            const pinnedCall = call => {
                const station = latestStations.find(item => normalizeCall(item.callSign) === normalizeCall(call));
                return station?.checkedState === true && (["netcontrol", "netlogger", "netrelay"].includes(station.role) || detailsFor(call).specialGuest);
            };
            if (pinnedCall(dragging.call)) {
                setStatus("NCO, Logger, Relay, and Special Guest positions are fixed.", "warning");
                return;
            }
            if (pinnedCall(targetCall)) {
                const displayedCalls = [...(panel?.querySelectorAll("[data-role='active'] .nch-row[data-call]") || [])]
                    .map(row => normalizeCall(row.dataset.call))
                    .filter(call => call && call !== dragging.call);
                targetCall = displayedCalls.find(call => !pinnedCall(call)) || "";
                after = false;
                if (!targetCall) {
                    local[targetGroup] = local[targetGroup].filter(call => call !== dragging.call);
                    local[targetGroup].push(dragging.call);
                    local.manualOrder = true;
                    storageSet();
                    publishSharedMove(targetGroup);
                    renderQueue();
                    setStatus(`${dragging.call} moved after the fixed-role stations.`, "success");
                    return;
                }
            }
        }
        const list = local[targetGroup];
        const from = list.indexOf(dragging.call);
        let to = list.indexOf(targetCall);
        if (from < 0 || to < 0)
            return;
        list.splice(from, 1);
        to = list.indexOf(targetCall) + (after ? 1 : 0);
        list.splice(to, 0, dragging.call);
        if (targetGroup === "order")
            local.manualOrder = true;
        storageSet();
        publishSharedMove(targetGroup);
        renderQueue();
        setStatus(`${dragging.call} moved ${after ? "after" : "before"} ${targetCall}.`, "success");
    }
    function revisionHash(value) {
        const text = String(value || "");
        let hash = 2166136261;
        for (let index = 0; index < text.length; index += 1)
            hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
        return (hash >>> 0).toString(36);
    }
    function stationRevision(station) {
        return revisionHash(JSON.stringify({
            station: {
                callSign: normalizeCall(station.callSign), checkedState: station.checkedState,
                role: station.role, hand: Boolean(station.hand), highlight: Boolean(station.highlight)
            },
            details: detailsFor(station.callSign)
        }));
    }
    function remoteRenderSignature(stations, netTitle, role) {
        return JSON.stringify({
            netTitle: String(netTitle || "").trim(),
            role: String(role || "netuser"),
            stations: stations.map(station => ({
                callSign: normalizeCall(station.callSign),
                checkedState: station.checkedState,
                role: station.role || "netuser",
                hand: Boolean(station.hand),
                highlight: Boolean(station.highlight),
                displayName: String(station.displayName || ""),
                location: String(station.location || "")
            }))
        });
    }
    function viewerItems() {
        return latestStations.filter(station => !hiddenCalls.has(normalizeCall(station.callSign))).map(station => {
            const call = normalizeCall(station.callSign);
            const details = detailsFor(call);
            const status = station.checkedState === true ? "active" : station.checkedState === false ? "checked-out" : "lurker";
            const actions = [];
            if (canManageStations() && (isNcoUser() || !["netcontrol", "netlogger"].includes(station.role))) {
                actions.push({ action_id: "edit_station", label: "Edit Station", owner_mode: modeId(), enabled: true });
            }
            if (call === selfCall())
                actions.push({ action_id: "toggle_own_hand", label: station.hand ? "Lower own hand" : "Raise own hand", owner_mode: modeId(), enabled: true });
            return {
                id: `station:${call}`, title: call, entity_type: "station", source: "NetControl.live",
                revision: stationRevision(station), modified_at: new Date().toISOString(), status,
                preview: [call, details.name, details.location, details.note].filter(Boolean).join(" · "),
                metadata: { name: details.name, location: details.location, role: station.role, checked_state: station.checkedState, hand: Boolean(station.hand), highlight: Boolean(station.highlight), tags: { mobile: details.mobile, portable: details.portable, shortTime: details.shortTime, neededNext: details.neededNext, notResponding: details.notResponding, skipped: details.skipped, specialGuest: details.specialGuest, inOut: local.ioCalls.includes(call) } },
                permissions: { read: true, mutate: false }, available_actions: actions,
                warnings: [], errors: [], related_items: [`net:${npid}`],
                ownership: { source_mode: modeId(), callsign: call }, provenance: { site: "NetControl.live", helper_version: VERSION }
            };
        });
    }
    function ensureViewer() {
        if (viewer || !globalThis.NCOHelperViewer)
            return viewer;
        viewer = globalThis.NCOHelperViewer.create({ entity_id: `net:${npid}`, entity_type: "net", source_mode: modeId(), active_mode: "viewer" });
        [
            { mode_id: "viewer", display_name: "Viewer", purpose: "Read-only inspection and coordination", accepted_entity_types: ["net", "station", "notice", "handoff"], provides: ["preview", "history", "coordination"], handoff_actions: [], viewer_panels: ["navigator", "preview", "coordination", "history"], capabilities: ["inspect", "search", "compare", "handoff"], permissions: { read: true, mutate: false }, status: "active" },
            { mode_id: "nco", display_name: "NCO", purpose: "Owns net and station administration", accepted_entity_types: ["net", "station"], provides: ["station state", "net state"], handoff_actions: ["edit_station"], viewer_panels: ["station actions"], capabilities: ["manage stations", "close net", "assign roles"], permissions: { read: true, mutate: true }, status: currentUserRole === "netcontrol" ? "available" : "limited" },
            { mode_id: "logger", display_name: "Logger", purpose: "Owns Logger-authorized station actions", accepted_entity_types: ["station"], provides: ["station state", "notes", "ordering"], handoff_actions: ["edit_station"], viewer_panels: ["station actions"], capabilities: ["manage stations", "assign relay"], permissions: { read: true, mutate: currentUserRole === "netlogger" }, status: currentUserRole === "netlogger" ? "available" : "limited" },
            { mode_id: "relay", display_name: "Relay", purpose: "Read-only relay log with self hand control", accepted_entity_types: ["station"], provides: ["station state", "shared operational tags", "shared ordering"], handoff_actions: ["toggle_own_hand"], viewer_panels: ["station preview"], capabilities: ["inspect", "own hand"], permissions: { read: true, mutate: false }, status: currentUserRole === "netrelay" ? "available" : "limited" }
        ].forEach(definition => viewer.register_mode(definition));
        globalThis.NCOHelperViewerAPI = viewer;
        return viewer;
    }
    function syncViewer() {
        const api = ensureViewer();
        if (!api)
            return;
        const stationItems = viewerItems();
        const relatedItems = stationItems.map(item => item.id);
        const netRevision = revisionHash(JSON.stringify({
            title: latestNetTitle,
            stations: stationItems.map(item => [item.id, item.revision])
        }));
        const items = [{
                id: `net:${npid}`, title: latestNetTitle || "Active net", entity_type: "net", source: "NetControl.live",
                revision: netRevision, modified_at: new Date().toISOString(), status: "active",
                preview: `${latestNetTitle}\n${stationItems.length} visible stations`, metadata: { net_id: npid, station_count: stationItems.length },
                permissions: { read: true, mutate: false }, available_actions: [], warnings: [], errors: [],
                related_items: relatedItems, ownership: { source_mode: modeId() }, provenance: { site: "NetControl.live" }
            }, ...stationItems];
        api.sync({
            context: {
                entity_id: `net:${npid}`, entity_type: "net", source_mode: modeId(), active_mode: "viewer",
                status: "ready", progress: 100, revision: items[0].revision, freshness: "fresh", updated_at: new Date().toISOString(),
                permissions: { read: true, mutate: false }, available_capabilities: ["inspect", "search", "compare", "handoff"],
                warnings: [], validation_results: [], conflicts: [], errors: [], related_items: items.slice(1).map(item => item.id),
                dependencies: ["NetControl.live", "NCO Helper"], provenance: { source: "NetControl.live and extension-local helper state" },
                ownership: { last_mode: modeId(), viewer_read_only: true }
            }, items
        });
    }
    function sharedTags(call) {
        const details = detailsFor(call);
        return {
            specialGuest: details.specialGuest, neededNext: details.neededNext, notResponding: details.notResponding, skipped: details.skipped,
            mobile: details.mobile, portable: details.portable, shortTime: details.shortTime, inOut: local.ioCalls.includes(normalizeCall(call)),
            recheck: details.recheck
        };
    }
    const PROFILE_FIELDS = ["name", "location"];
    const profileFieldPresent = (profile, field) => Object.prototype.hasOwnProperty.call(profile || {}, `${field}Override`);
    const profileAuthorityRank = (role, origin) => {
        if (role === "netcontrol")
            return origin === "manual" ? 40 : 30;
        if (role === "netlogger")
            return origin === "manual" ? 20 : 10;
        return 0;
    };
    const profileCandidateWins = (saved, field, role, origin, timestamp, messageId) => {
        const currentRole = String(saved?.[`${field}AuthorityRole`] || "");
        if (!currentRole)
            return true;
        const currentTime = Number(saved?.[`${field}UpdatedAt`] || saved?.updatedAt || 0);
        const currentId = String(saved?.[`${field}MessageId`] || "");
        if (saved?.[`${field}Cleared`]) {
            if (Number(timestamp) !== currentTime)
                return Number(timestamp) > currentTime;
            return String(messageId || "").localeCompare(currentId) > 0;
        }
        const currentRank = profileAuthorityRank(currentRole, saved?.[`${field}Origin`] || "manual");
        const candidateRank = profileAuthorityRank(role, origin);
        if (candidateRank !== currentRank)
            return candidateRank > currentRank;
        if (Number(timestamp) !== currentTime)
            return Number(timestamp) > currentTime;
        return String(messageId || "").localeCompare(currentId) > 0;
    };
    function applyProfileCandidate(callSign, profile, role, timestamp = Date.now(), messageId = "") {
        const call = normalizeCall(callSign);
        if (!call || !["netcontrol", "netlogger"].includes(role))
            return { accepted: {}, rejected: [...PROFILE_FIELDS] };
        const saved = sharedProfiles[call] && typeof sharedProfiles[call] === "object" ? { ...sharedProfiles[call] } : {};
        const accepted = {};
        const rejected = [];
        for (const field of PROFILE_FIELDS) {
            if (!profileFieldPresent(profile, field))
                continue;
            const origin = profile[`${field}Origin`] === "lookup" ? "lookup" : "manual";
            const enabled = Boolean(profile[`${field}Override`]);
            if (origin === "lookup" && !enabled)
                continue;
            if (!profileCandidateWins(saved, field, role, origin, timestamp, messageId)) {
                rejected.push(field);
                continue;
            }
            const value = field === "name" ? formatName(profile[field]) : formatLocation(profile[field]);
            if (enabled && !value)
                continue;
            saved[field] = enabled ? value : "";
            saved[`${field}Override`] = enabled;
            saved[`${field}Origin`] = origin;
            saved[`${field}AuthorityRole`] = role;
            saved[`${field}UpdatedAt`] = Number(timestamp) || Date.now();
            saved[`${field}MessageId`] = String(messageId || "");
            saved[`${field}Cleared`] = origin === "manual" && !enabled;
            accepted[field] = saved[field];
            accepted[`${field}Override`] = enabled;
            accepted[`${field}Origin`] = origin;
        }
        if (!Object.keys(accepted).length)
            return { accepted, rejected };
        saved.updatedAt = Math.max(Number(saved.nameUpdatedAt) || 0, Number(saved.locationUpdatedAt) || 0);
        sharedProfiles[call] = saved;
        const current = local.details[call] || {};
        const next = { ...current };
        for (const field of PROFILE_FIELDS) {
            if (!profileFieldPresent(accepted, field))
                continue;
            next[field] = accepted[field];
            next[`${field}Override`] = accepted[`${field}Override`];
            if (field === "name")
                next.qrzNameVersion = accepted.nameOverride ? 2 : 0;
        }
        local.details[call] = next;
        storeSharedProfiles();
        return { accepted, rejected };
    }
    function sharedProfile(call) {
        const saved = sharedProfiles[normalizeCall(call)];
        if (!saved || typeof saved !== "object")
            return null;
        const profile = {};
        for (const field of PROFILE_FIELDS) {
            if (!saved[`${field}AuthorityRole`])
                continue;
            profile[field] = saved[`${field}Override`] ? saved[field] : "";
            profile[`${field}Override`] = Boolean(saved[`${field}Override`]);
            profile[`${field}Origin`] = saved[`${field}Origin`] === "lookup" ? "lookup" : "manual";
            profile[`${field}OwnerRole`] = saved[`${field}AuthorityRole`];
            profile[`${field}ChangedAt`] = Number(saved[`${field}UpdatedAt`] || saved.updatedAt) || Date.now();
            const changeId = String(saved[`${field}MessageId`] || "");
            profile[`${field}ChangeId`] = /^[A-Za-z0-9-]{12,80}$/.test(changeId)
                ? changeId : `legacy-${normalizeCall(call).replace(/[^A-Z0-9-]/g, "-")}-${field}`.slice(0, 80).padEnd(12, "0");
            profile[`${field}Released`] = Boolean(saved[`${field}Cleared`]);
        }
        return Object.keys(profile).length ? profile : null;
    }
    function snapshotProfile(call) {
        const full = sharedProfile(call);
        if (!full)
            return null;
        const compact = {};
        for (const field of PROFILE_FIELDS) {
            if (!profileFieldPresent(full, field))
                continue;
            compact[field] = full[field];
            compact[`${field}Override`] = full[`${field}Override`];
            compact[`${field}Origin`] = full[`${field}Origin`];
            compact[`${field}ChangedAt`] = full[`${field}ChangedAt`];
            if (full[`${field}OwnerRole`] && full[`${field}OwnerRole`] !== currentUserRole) {
                compact[`${field}OwnerRole`] = full[`${field}OwnerRole`];
            }
        }
        return Object.keys(compact).length ? compact : null;
    }
    function sharedSnapshot() {
        const details = {};
        latestStations.forEach(station => {
            const call = normalizeCall(station.callSign);
            const tags = sharedTags(call);
            const profile = snapshotProfile(call);
            if (Object.values(tags).some(Boolean) || profile)
                details[call] = { tags, ...(profile ? { profile } : {}) };
        });
        const updatedAt = Number(local.sharedUpdatedAt) || Date.now();
        if (!local.sharedUpdatedAt)
            local.sharedUpdatedAt = updatedAt;
        return {
            revision: String(updatedAt), updated_at: updatedAt,
            order: [...local.order], checkedOutOrder: [...local.checkedOutOrder], lurkerOrder: [...local.lurkerOrder],
            manualOrder: Boolean(local.manualOrder), hiddenCalls: [...hiddenCalls], details,
            selectedNextCall: selectedNextCall || ""
        };
    }
    function applySnapshotProfiles(payload, update) {
        Object.entries(payload.details || {}).forEach(([rawCall, value]) => {
            const call = normalizeCall(rawCall);
            if (!call || !value?.profile || typeof value.profile !== "object")
                return;
            for (const field of PROFILE_FIELDS) {
                if (!profileFieldPresent(value.profile, field))
                    continue;
                const senderRole = update.sender?.role || "";
                const claimedRole = value.profile[`${field}OwnerRole`];
                const role = senderRole === "netcontrol" && ["netcontrol", "netlogger"].includes(claimedRole)
                    ? claimedRole : senderRole;
                applyProfileCandidate(call, {
                    [field]: value.profile[field],
                    [`${field}Override`]: value.profile[`${field}Override`],
                    [`${field}Origin`]: value.profile[`${field}Origin`] || "manual"
                }, role, Number(value.profile[`${field}ChangedAt`]) || Number(payload.updated_at) || Date.now(), value.profile[`${field}ChangeId`] || `snapshot-${update.envelope?.message_id || "state"}`);
            }
        });
    }
    function applySharedUpdate(update) {
        const { action, payload } = update;
        if (action === "tags") {
            const call = normalizeCall(String(payload.entity_id).replace(/^station:/, ""));
            const current = detailsFor(call);
            local.details[call] = { ...current, ...payload.tags };
            markIo(call, Boolean(payload.tags.inOut));
            setRecheck(call, Boolean(payload.tags.recheck), false);
        }
        else if (action === "profile") {
            const call = normalizeCall(String(payload.entity_id).replace(/^station:/, ""));
            for (const field of PROFILE_FIELDS) {
                if (!profileFieldPresent(payload.profile || {}, field))
                    continue;
                const senderRole = update.sender?.role || "";
                const claimedRole = payload.profile[`${field}OwnerRole`];
                const role = senderRole === "netcontrol" && claimedRole === "netlogger" ? "netlogger" : senderRole;
                applyProfileCandidate(call, {
                    [field]: payload.profile[field],
                    [`${field}Override`]: payload.profile[`${field}Override`],
                    [`${field}Origin`]: payload.profile[`${field}Origin`] || "manual"
                }, role, Number(update.envelope?.timestamp) || Date.now(), update.envelope?.message_id || "");
            }
        }
        else if (action === "move") {
            local[payload.group] = [...payload.order];
            if (payload.group === "order")
                local.manualOrder = Boolean(payload.manual_order);
        }
        else if (action === "visibility") {
            const call = normalizeCall(String(payload.entity_id).replace(/^station:/, ""));
            if (payload.hidden)
                hiddenCalls.add(call);
            else
                hiddenCalls.delete(call);
            local.hiddenCalls = [...hiddenCalls];
        }
        else if (action === "selection") {
            const selected = normalizeCall(payload.selected_call || "");
            selectedNextCall = selected && latestStations.some(station => normalizeCall(station.callSign) === selected && station.checkedState === true)
                ? selected : "";
        }
        else if (action === "snapshot_profiles") {
            applySnapshotProfiles(payload, update);
        }
        else if (action === "snapshot") {
            ["order", "checkedOutOrder", "lurkerOrder"].forEach(key => { if (Array.isArray(payload[key]))
                local[key] = payload[key].map(normalizeCall); });
            local.manualOrder = Boolean(payload.manualOrder);
            const selected = normalizeCall(payload.selectedNextCall || "");
            selectedNextCall = selected && latestStations.some(station => normalizeCall(station.callSign) === selected && station.checkedState === true)
                ? selected : "";
            hiddenCalls.clear();
            (payload.hiddenCalls || []).forEach(call => hiddenCalls.add(normalizeCall(call)));
            local.hiddenCalls = [...hiddenCalls];
            latestStations.forEach(station => {
                const call = normalizeCall(station.callSign);
                const current = detailsFor(call);
                local.details[call] = {
                    ...current, specialGuest: false, neededNext: false, notResponding: false, skipped: false,
                    mobile: false, portable: false, shortTime: false
                };
                markIo(call, false);
                setRecheck(call, false, false);
            });
            Object.entries(payload.details || {}).forEach(([rawCall, value]) => {
                const call = normalizeCall(rawCall);
                if (!call || !value || typeof value !== "object")
                    return;
                local.details[call] = { ...detailsFor(call), ...(value.tags || {}) };
                markIo(call, Boolean(value.tags?.inOut));
                setRecheck(call, Boolean(value.tags?.recheck), false);
            });
            applySnapshotProfiles(payload, update);
            storeSharedProfiles();
        }
        local.sharedUpdatedAt = Math.max(Number(local.sharedUpdatedAt) || 0, Number(update.envelope?.timestamp || payload.updated_at) || Date.now());
        storageSet();
        renderQueue();
    }
    const publishSharedTags = call => {
        if (!canManageStations())
            return;
        local.sharedUpdatedAt = Date.now();
        publishSharedSnapshotSafely();
    };
    const publishSharedProfile = (call, profile) => {
        if (!canManageStations() || !profile || !Object.keys(profile).length)
            return;
        local.sharedUpdatedAt = Date.now();
        publishSharedSnapshotSafely();
    };
    const publishSharedMove = group => {
        if (!canManageStations())
            return;
        local.sharedUpdatedAt = Date.now();
        publishSharedSnapshotSafely();
    };
    const publishSharedVisibility = (call, hidden) => {
        if (!canManageStations())
            return;
        local.sharedUpdatedAt = Date.now();
        publishSharedSnapshotSafely();
    };
    const publishSharedSelection = () => {
        if (!canManageStations())
            return;
        local.sharedUpdatedAt = Date.now();
        publishSharedSnapshotSafely();
    };
    async function sendSyncText(message) {
        if (!relayClient || typeof message !== "string")
            return false;
        try {
            const envelope = syncEngine?.decode(message);
            if (!envelope?.message_id)
                return false;
            return relayClient.publish({ text: message }, envelope.message_id);
        }
        catch {
            return false;
        }
    }
    function stopSync() {
        if (syncSnapshotRequestTimer)
            window.clearTimeout(syncSnapshotRequestTimer);
        syncSnapshotRequestTimer = null;
        relayClient?.stop();
        relayClient = null;
        syncEngine = null;
        syncStartedForRole = "";
        syncStartedForIdentity = "";
    }
    function scheduleRelaySnapshotRequest() {
        if (syncSnapshotRequestTimer)
            window.clearTimeout(syncSnapshotRequestTimer);
        syncSnapshotRequestTimer = window.setTimeout(() => {
            syncSnapshotRequestTimer = null;
            syncEngine?.publish("snapshot_request", { since_revision: String(local.sharedUpdatedAt || "") });
        }, 500);
    }
    async function receiveRelayFrame(frame) {
        const text = frame?.payload?.text;
        if (typeof text !== "string")
            return;
        const helperPrivate = decodeHelperPrivate(text);
        if (helperPrivate) {
            receiveHelperPrivate(frame, helperPrivate);
            return;
        }
        await syncEngine?.receiveServerMessage({
            id: String(frame.id || ""),
            text,
            callSign: String(frame.sender?.callsign || ""),
            userId: String(frame.sender?.user_id || ""),
            createdAt: String(frame.received_at || "")
        });
    }
    function startSync() {
        if (!globalThis.NCOHelperSync || !globalThis.NCOHelperRelay) {
            stopSync();
            updateRelayStatus("unavailable", "Relay transport is unavailable; local helper operation continues.");
            return;
        }
        const identity = currentRelayIdentity();
        const identityKey = relayIdentityKey(identity);
        if (syncEngine && syncStartedForRole === currentUserRole && syncStartedForIdentity === identityKey) {
            refreshRelaySetup();
            return;
        }
        stopSync();
        syncStartedForRole = currentUserRole;
        syncStartedForIdentity = identityKey;
        syncEngine = globalThis.NCOHelperSync.createEngine({
            netId: npid, send: sendSyncText, selfRole: () => currentUserRole,
            authorizeSender(call, userId) {
                const station = latestStations.find(item => normalizeCall(item.callSign) === normalizeCall(call));
                if (!station)
                    return "";
                const stationUserId = station.userProfile || station.userId || station.userID || station.user_id || "";
                return { role: station.role || "", callSign: normalizeCall(station.callSign), ...(stationUserId ? { userId: String(stationUserId) } : {}) };
            },
            onApply: applySharedUpdate,
            onSnapshotRequest: async ({ publishSnapshot }) => canManageStations() ? publishSnapshot(sharedSnapshot()) : null,
            acknowledgments: false,
            allowReadOnlySnapshotRequests: true,
            onNotice: notice => setStatus(notice.message, notice.status === "error" ? "error" : "warning")
        });
        if (!identity) {
            updateRelayStatus("unavailable", "The current NetControl.live callsign and user ID could not be determined; local helper operation continues.");
            refreshRelaySetup();
            return;
        }
        if (!globalThis.NCOHelperRelay.validToken(relayToken)) {
            updateRelayStatus("setup_required", "Open Menu → Relay Setup to add your relay token.");
            refreshRelaySetup();
            return;
        }
        relayClient = globalThis.NCOHelperRelay.createClient({
            netId: identity.netId,
            token: relayToken,
            onState({ state }) {
                updateRelayStatus(state, state === "connected"
                    ? `Connected for ${identity.callSign} on Net ${identity.netId}.`
                    : state === "connecting"
                        ? `Connecting for ${identity.callSign} on Net ${identity.netId}.`
                        : state === "authentication_failed"
                            ? "Relay authentication failed. Open Menu → Relay Setup to verify the saved relay token."
                            : "The relay is unavailable; local helper operation continues.");
                if (state === "connected")
                    publishHelperPresence();
            },
            onReady() {
                scheduleRelaySnapshotRequest();
                publishHelperPresence();
            },
            onMessage: receiveRelayFrame,
            onNotice(notice) {
                setStatus(String(notice?.message || "The relay rejected a synchronization message."), "warning");
            }
        });
        relayClient.start();
        refreshRelaySetup();
    }
    function applyRoleUi() {
        if (!panel)
            return;
        panel.dataset.userRole = currentUserRole;
        panel.querySelector("[data-role='helper-title']").textContent = "WVARC NCO Logger";
        panel.querySelector("[data-role='helper-byline']").textContent = "UI by KE7WIL";
        const mode = panel.querySelector("[data-role='helper-mode']");
        if (mode) {
            mode.textContent = helperModeLabel();
            mode.dataset.short = helperModeShortLabel();
        }
        panel.querySelectorAll(".nch-admin-only").forEach(element => { element.hidden = !canManageStations(); });
        const closeButton = panel.querySelector("[data-role='close-net']");
        if (closeButton)
            closeButton.hidden = !isNcoUser();
    }
    function normalizeModuleLayout(source = local.moduleLayout) {
        const candidate = source && typeof source === "object" ? source : {};
        const migratedCollapsed = {
            controls: Boolean(local.collapsedSections?.entry), chat: Boolean(local.collapsedSections?.chat),
            checkedOut: Boolean(local.collapsedSections?.checkedOut), active: Boolean(local.collapsedSections?.active),
            lurkers: Boolean(local.collapsedSections?.lurkers)
        };
        const suppliedCollapsed = candidate.collapsed && typeof candidate.collapsed === "object" ? candidate.collapsed : migratedCollapsed;
        const hasCurrentGrid = candidate.gridVersion === LAYOUT_GRID_VERSION && candidate.items && typeof candidate.items === "object";
        const hasV3Grid = candidate.gridVersion === 3 && candidate.items && typeof candidate.items === "object";
        const hasV2Grid = candidate.gridVersion === 2 && candidate.items && typeof candidate.items === "object";
        const hasLegacy = !hasCurrentGrid && !hasV3Grid && !hasV2Grid && (Array.isArray(candidate.order) || (candidate.spans && typeof candidate.spans === "object") || (candidate.heights && typeof candidate.heights === "object"));
        const migratedItems = {};
        if (!hasCurrentGrid && !hasV2Grid && hasLegacy) {
            const legacyOrder = [...new Set([...(Array.isArray(candidate.order) ? candidate.order : []), "controls", "checkedOut", "chat", "active", "status", "lurkers"])]
                .filter(id => MODULE_IDS.includes(id));
            let x = 0;
            let y = 0;
            let rowHeight = 0;
            legacyOrder.forEach(id => {
                const fallback = DEFAULT_MODULE_LAYOUT.items[id];
                const legacySpan = Number(candidate.spans?.[id]);
                const w = Math.min(GRID_COLUMNS, Math.max(MIN_MODULE_COLUMNS, legacySpan ? Math.round(legacySpan * GRID_COLUMNS / LEGACY_GRID_COLUMNS) : fallback.w));
                const h = Math.min(60, Math.max(MIN_MODULE_ROWS[id], Math.round(((Number(candidate.heights?.[id]) || (fallback.h * GRID_ROW_HEIGHT)) + GRID_GAP) / (GRID_ROW_HEIGHT + GRID_GAP))));
                if (x && x + w > GRID_COLUMNS) {
                    x = 0;
                    y += rowHeight;
                    rowHeight = 0;
                }
                migratedItems[id] = { x, y, w, h };
                x += w;
                rowHeight = Math.max(rowHeight, h);
            });
        }
        const items = {};
        const collapsed = {};
        MODULE_IDS.forEach(id => {
            const fallback = DEFAULT_MODULE_LAYOUT.items[id];
            let supplied = migratedItems[id] || fallback;
            if (hasCurrentGrid && candidate.items[id] && typeof candidate.items[id] === "object")
                supplied = candidate.items[id];
            if (hasV3Grid && candidate.items[id] && typeof candidate.items[id] === "object") {
                supplied = { ...candidate.items[id] };
                const oldDefault = id === "lurkers"
                    ? { x: 0, y: 0, w: 10, h: 2 }
                    : id === "checkedOut" ? { x: 14, y: 0, w: 10, h: 2 } : null;
                if (oldDefault && ["x", "y", "w", "h"].every(key => Number(supplied[key]) === oldDefault[key]))
                    supplied.h = 4;
            }
            if (hasV2Grid && candidate.items[id] && typeof candidate.items[id] === "object") {
                const legacyItem = candidate.items[id];
                const legacyX = Math.round(Number(legacyItem.x) || 0);
                const legacyW = Math.max(1, Math.round(Number(legacyItem.w) || (fallback.w / 2)));
                supplied = { ...legacyItem, x: legacyX * 2, w: legacyW * 2 };
            }
            const w = Math.min(GRID_COLUMNS, Math.max(MIN_MODULE_COLUMNS, Math.round(Number(supplied.w) || fallback.w)));
            const h = Math.min(GRID_ROWS, Math.max(MIN_MODULE_ROWS[id], Math.round(Number(supplied.h) || fallback.h)));
            items[id] = {
                x: Math.min(GRID_COLUMNS - w, Math.max(0, Math.round(Number(supplied.x) || 0))),
                y: Math.min(GRID_ROWS - h, Math.max(0, Math.round(Number(supplied.y) || 0))),
                w,
                h
            };
            collapsed[id] = Boolean(suppliedCollapsed[id]);
        });
        return { gridVersion: LAYOUT_GRID_VERSION, items, collapsed };
    }
    const gridRectsOverlap = (left, right) => left.x < right.x + right.w && left.x + left.w > right.x && left.y < right.y + right.h && left.y + left.h > right.y;
    function tryResolveGridLayout(source, fixedId = "", nudgeFixed = false) {
        const layout = normalizeModuleLayout(source);
        const visible = MODULE_IDS.filter(id => moduleAvailable(id) && !layout.collapsed[id]);
        visible.sort((left, right) => {
            if (left === fixedId)
                return -1;
            if (right === fixedId)
                return 1;
            const a = layout.items[left];
            const b = layout.items[right];
            const areaDifference = (b.w * b.h) - (a.w * a.h);
            return areaDifference || a.y - b.y || a.x - b.x || MODULE_IDS.indexOf(left) - MODULE_IDS.indexOf(right);
        });
        const placed = [];
        let attempts = 0;
        const candidatesFor = (item, allowEveryCell = false) => {
            const maxX = GRID_COLUMNS - item.w;
            const maxY = GRID_ROWS - item.h;
            const xs = new Set([item.x, 0, maxX]);
            const ys = new Set([item.y, 0, maxY]);
            placed.forEach(other => {
                [other.x, other.x + other.w, other.x - item.w, other.x + other.w - item.w].forEach(value => xs.add(value));
                [other.y, other.y + other.h, other.y - item.h, other.y + other.h - item.h].forEach(value => ys.add(value));
            });
            if (allowEveryCell) {
                for (let x = 0; x <= maxX; x += 1)
                    xs.add(x);
                for (let y = 0; y <= maxY; y += 1)
                    ys.add(y);
            }
            const results = [];
            xs.forEach(x => ys.forEach(y => {
                if (x < 0 || y < 0 || x > maxX || y > maxY)
                    return;
                const candidate = { ...item, x, y };
                if (placed.some(other => gridRectsOverlap(candidate, other)))
                    return;
                results.push(candidate);
            }));
            return results.sort((left, right) => {
                const leftScore = Math.abs(left.y - item.y) * GRID_COLUMNS + Math.abs(left.x - item.x);
                const rightScore = Math.abs(right.y - item.y) * GRID_COLUMNS + Math.abs(right.x - item.x);
                return leftScore - rightScore || left.y - right.y || left.x - right.x;
            });
        };
        const placeNext = index => {
            if (index >= visible.length)
                return true;
            if (attempts > 24000)
                return false;
            const id = visible[index];
            const item = { ...layout.items[id] };
            const candidates = id === fixedId && !nudgeFixed ? [item] : candidatesFor(item, id === fixedId && nudgeFixed);
            for (const candidate of candidates) {
                attempts += 1;
                if (candidate.x < 0 || candidate.y < 0 || candidate.x + candidate.w > GRID_COLUMNS || candidate.y + candidate.h > GRID_ROWS)
                    continue;
                if (placed.some(other => gridRectsOverlap(candidate, other)))
                    continue;
                placed.push({ id, ...candidate });
                layout.items[id] = { x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h };
                if (placeNext(index + 1))
                    return true;
                placed.pop();
            }
            return false;
        };
        return placeNext(0) ? layout : null;
    }
    function resolveGridLayout(source, fixedId = "") {
        const normalized = normalizeModuleLayout(source);
        const resolved = tryResolveGridLayout(normalized, fixedId);
        if (resolved)
            return resolved;
        const fallback = normalizeModuleLayout(DEFAULT_MODULE_LAYOUT);
        fallback.collapsed = { ...normalized.collapsed };
        return tryResolveGridLayout(fallback) || fallback;
    }
    function canonicalizeReadOnlyTop(layout, force = false) {
        const normalized = normalizeModuleLayout(layout);
        if (moduleAvailable("controls"))
            return normalized;
        const lurkers = normalized.items.lurkers;
        const checkedOut = normalized.items.checkedOut;
        if (!force && (lurkers.y !== 0 || checkedOut.y !== 0))
            return normalized;
        normalized.items.lurkers = { x: 0, y: 0, w: 12, h: 4 };
        normalized.items.checkedOut = { x: 12, y: 0, w: 12, h: 4 };
        return normalized;
    }
    function defaultModuleLayoutForMode() {
        return canonicalizeReadOnlyTop(DEFAULT_MODULE_LAYOUT, true);
    }
    function hasCanonicalReadOnlyTop(layout) {
        const normalized = normalizeModuleLayout(layout);
        const lurkers = normalized.items.lurkers;
        const checkedOut = normalized.items.checkedOut;
        return lurkers.x === 0 && lurkers.y === 0 && lurkers.w === 12 && lurkers.h === 4
            && checkedOut.x === 12 && checkedOut.y === 0 && checkedOut.w === 12 && checkedOut.h === 4;
    }
    function renderGridLayout(layout, draggingId = "") {
        const dashboard = panel?.querySelector("[data-role='dashboard']");
        if (!dashboard)
            return;
        MODULE_IDS.forEach(id => {
            const module = dashboard.querySelector(`[data-module='${id}']`);
            if (!module)
                return;
            const item = layout.items[id];
            module.style.gridColumn = `${item.x + 1} / span ${item.w}`;
            module.style.gridRow = `${item.y + 1} / span ${item.h}`;
            module.style.setProperty("--nch-module-columns", String(item.w));
            module.hidden = !moduleAvailable(id) || layout.collapsed[id];
            module.classList.toggle("nch-grid-source", id === draggingId);
            module.classList.toggle("nch-read-only-top", !moduleAvailable("controls") && (id === "lurkers" || id === "checkedOut") && item.y === 0);
        });
        dashboard.style.setProperty("--nch-grid-rows", String(GRID_ROWS));
        dashboard.style.setProperty("--nch-grid-gap", `${GRID_GAP}px`);
        window.requestAnimationFrame(positionNativeChat);
    }
    function applyModuleLayout() {
        if (!panel)
            return;
        if (modulePointerDrag?.started) {
            renderGridLayout(modulePointerDrag.previewLayout || modulePointerDrag.originalLayout, modulePointerDrag.moduleId);
            return;
        }
        const focusedNote = document.activeElement?.matches?.("[data-note-input]")
            ? { element: document.activeElement, call: normalizeCall(document.activeElement.dataset.noteInput), value: document.activeElement.value,
                start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
            : null;
        if (focusedNote)
            noteDrafts.set(focusedNote.call, focusedNote.value);
        local.moduleLayout = resolveGridLayout(canonicalizeReadOnlyTop(local.moduleLayout));
        if (!panel.querySelector("[data-role='dashboard']"))
            return;
        renderGridLayout(local.moduleLayout);
        panel.querySelectorAll("[data-toggle-module]").forEach(button => {
            const id = button.dataset.toggleModule;
            const available = MODULE_IDS.includes(id) && moduleAvailable(id);
            const visible = available && !local.moduleLayout.collapsed[id];
            button.disabled = !available;
            button.title = available ? "" : "Unavailable in the current helper mode";
            button.setAttribute("aria-pressed", String(visible));
            button.classList.toggle("is-active", visible);
            const state = button.querySelector("[data-module-state]");
            if (state)
                state.textContent = !available ? "Unavailable" : visible ? "On" : "Off";
        });
        syncNativeChatVisibility();
        window.requestAnimationFrame(positionNativeChat);
        if (focusedNote) {
            const input = focusedNote.element.isConnected ? focusedNote.element : panel.querySelector(`[data-note-input='${CSS.escape(focusedNote.call)}']`);
            input?.focus();
            input?.setSelectionRange(focusedNote.start, focusedNote.end);
        }
    }
    function setModuleCollapsed(id, collapsed) {
        if (!MODULE_IDS.includes(id))
            return;
        local.moduleLayout = normalizeModuleLayout();
        local.moduleLayout.collapsed[id] = collapsed;
        if (!collapsed)
            local.moduleLayout = resolveGridLayout(local.moduleLayout, id);
        applyModuleLayout();
        storageSet();
    }
    function resizeModuleBy(id, widthDelta, heightDelta) {
        if (!MODULE_IDS.includes(id))
            return;
        const layout = normalizeModuleLayout();
        const item = layout.items[id];
        item.w = Math.min(GRID_COLUMNS, Math.max(MIN_MODULE_COLUMNS, item.w + widthDelta));
        item.x = Math.min(item.x, GRID_COLUMNS - item.w);
        item.h = Math.min(GRID_ROWS - item.y, Math.max(MIN_MODULE_ROWS[id], item.h + heightDelta));
        const resolved = tryResolveGridLayout(layout, id);
        if (!resolved)
            return;
        local.moduleLayout = resolved;
        storageSet();
        applyModuleLayout();
    }
    function clearModuleDrag() {
        panel?.querySelectorAll(".nch-module-dragging, .nch-grid-source").forEach(item => {
            item.classList.remove("nch-module-dragging", "nch-grid-source");
            ["position", "left", "top", "width", "height", "z-index", "pointer-events"].forEach(property => item.style.removeProperty(property));
        });
        panel?.querySelector(".nch-module-drop-preview")?.remove();
        panel?.querySelector("[data-role='dashboard']")?.classList.remove("nch-dashboard-dragging");
        document.body.classList.remove("nch-moving-module");
    }
    function moveModuleByGrid(id, xDelta, yDelta) {
        if (!MODULE_IDS.includes(id))
            return;
        const layout = normalizeModuleLayout();
        const item = layout.items[id];
        item.x = Math.min(GRID_COLUMNS - item.w, Math.max(0, item.x + xDelta));
        item.y = Math.min(GRID_ROWS - item.h, Math.max(0, item.y + yDelta));
        const resolved = tryResolveGridLayout(layout, id);
        if (!resolved)
            return;
        local.moduleLayout = resolved;
        storageSet();
        applyModuleLayout();
    }
    function gridMetrics(dashboard) {
        const style = getComputedStyle(dashboard);
        const gap = Math.max(0, parseFloat(style.rowGap) || GRID_GAP);
        const rows = Math.max(1, Number(style.getPropertyValue("--nch-grid-rows")) || GRID_ROWS);
        const columnWidth = Math.max(1, (dashboard.clientWidth - gap * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
        const rowHeight = Math.max(1, (dashboard.clientHeight - gap * (rows - 1)) / rows);
        return { columnWidth, columnStep: columnWidth + gap, rowStep: rowHeight + gap, rows };
    }
    function snapModulePosition(layout, id, requestedX, requestedY) {
        const item = layout.items[id];
        const xCandidates = [0, GRID_COLUMNS - item.w];
        const yCandidates = [0];
        MODULE_IDS.filter(otherId => otherId !== id && !layout.collapsed[otherId]).forEach(otherId => {
            const other = layout.items[otherId];
            xCandidates.push(other.x, other.x + other.w, other.x - item.w, other.x + other.w - item.w);
            yCandidates.push(other.y, other.y + other.h, other.y - item.h, other.y + other.h - item.h);
        });
        const snap = (value, candidates, minimum, maximum, tolerance) => {
            const allowed = candidates.map(candidate => Math.min(maximum, Math.max(minimum, candidate)));
            const closest = allowed.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best, value);
            return Math.abs(closest - value) <= tolerance ? closest : value;
        };
        return {
            x: snap(requestedX, xCandidates, 0, GRID_COLUMNS - item.w, 2),
            y: snap(requestedY, yCandidates, 0, GRID_ROWS - item.h, 1)
        };
    }
    function previewModuleGrid(clientX, clientY) {
        if (!modulePointerDrag?.started)
            return;
        const { dashboard, moduleId, offsetX, offsetY } = modulePointerDrag;
        const box = dashboard.getBoundingClientRect();
        const metrics = gridMetrics(dashboard);
        const originalItem = modulePointerDrag.originalLayout.items[moduleId];
        const requestedX = Math.min(GRID_COLUMNS - originalItem.w, Math.max(0, Math.round((clientX - box.left - offsetX) / metrics.columnStep)));
        const requestedY = Math.min(Math.max(0, metrics.rows - originalItem.h), Math.max(0, Math.round((clientY - box.top - offsetY) / metrics.rowStep)));
        const candidate = normalizeModuleLayout(modulePointerDrag.originalLayout);
        const snapped = snapModulePosition(candidate, moduleId, requestedX, requestedY);
        candidate.items[moduleId] = { ...candidate.items[moduleId], ...snapped };
        modulePointerDrag.previewLayout = tryResolveGridLayout(candidate, moduleId, true);
        if (!modulePointerDrag.previewLayout)
            return;
        renderGridLayout(modulePointerDrag.previewLayout, moduleId);
        const item = modulePointerDrag.previewLayout.items[moduleId];
        modulePointerDrag.preview.style.gridColumn = `${item.x + 1} / span ${item.w}`;
        modulePointerDrag.preview.style.gridRow = `${item.y + 1} / span ${item.h}`;
    }
    function updateModulePointerDrag(event) {
        if (!modulePointerDrag || event.pointerId !== modulePointerDrag.pointerId)
            return;
        const distance = Math.hypot(event.clientX - modulePointerDrag.startX, event.clientY - modulePointerDrag.startY);
        if (!modulePointerDrag.started && distance < 6)
            return;
        if (!modulePointerDrag.started) {
            modulePointerDrag.started = true;
            modulePointerDrag.module.classList.add("nch-module-dragging");
            document.body.classList.add("nch-moving-module");
            const box = modulePointerDrag.module.getBoundingClientRect();
            modulePointerDrag.offsetX = modulePointerDrag.startX - box.left;
            modulePointerDrag.offsetY = modulePointerDrag.startY - box.top;
            Object.assign(modulePointerDrag.module.style, {
                position: "fixed", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
                zIndex: "2147483647", pointerEvents: "none"
            });
            const preview = document.createElement("div");
            preview.className = "nch-module-drop-preview";
            preview.setAttribute("aria-hidden", "true");
            modulePointerDrag.dashboard.appendChild(preview);
            modulePointerDrag.preview = preview;
            modulePointerDrag.dashboard.classList.add("nch-dashboard-dragging");
        }
        event.preventDefault();
        const dashboardBox = modulePointerDrag.dashboard.getBoundingClientRect();
        const moduleBox = modulePointerDrag.module.getBoundingClientRect();
        const left = Math.min(dashboardBox.right - moduleBox.width, Math.max(dashboardBox.left, event.clientX - modulePointerDrag.offsetX));
        const top = Math.min(dashboardBox.bottom - Math.min(moduleBox.height, dashboardBox.height), Math.max(dashboardBox.top, event.clientY - modulePointerDrag.offsetY));
        modulePointerDrag.module.style.left = `${Math.round(left)}px`;
        modulePointerDrag.module.style.top = `${Math.round(top)}px`;
        modulePointerDrag.clientX = event.clientX;
        modulePointerDrag.clientY = event.clientY;
        previewModuleGrid(event.clientX, event.clientY);
    }
    function stopModulePointerDrag(event) {
        if (!modulePointerDrag || event.pointerId !== modulePointerDrag.pointerId)
            return;
        const finished = modulePointerDrag;
        modulePointerDrag = null;
        if (finished.started && finished.previewLayout)
            local.moduleLayout = finished.previewLayout;
        clearModuleDrag();
        applyModuleLayout();
        if (finished.started)
            storageSet();
    }
    function cancelModulePointerDrag(event) {
        if (!modulePointerDrag || event.pointerId !== modulePointerDrag.pointerId)
            return;
        const originalLayout = modulePointerDrag.originalLayout;
        modulePointerDrag = null;
        clearModuleDrag();
        local.moduleLayout = originalLayout;
        applyModuleLayout();
    }
    function resizeFromPointer(event) {
        if (!resizing?.moduleId || event.pointerId !== resizing.pointerId)
            return;
        const dashboard = panel?.querySelector("[data-role='dashboard']");
        if (!dashboard)
            return;
        const metrics = gridMetrics(dashboard);
        const layout = normalizeModuleLayout(resizing.originalLayout);
        const item = layout.items[resizing.moduleId];
        const columnDelta = Math.round((event.clientX - resizing.startX) / metrics.columnStep);
        const rowDelta = Math.round((event.clientY - resizing.startY) / metrics.rowStep);
        if (resizing.edge.includes("w")) {
            const rightEdge = resizing.startItem.x + resizing.startItem.w;
            item.w = Math.min(rightEdge, Math.max(MIN_MODULE_COLUMNS, resizing.startItem.w - columnDelta));
            item.x = rightEdge - item.w;
        }
        else if (resizing.edge.includes("e")) {
            item.w = Math.min(GRID_COLUMNS - item.x, Math.max(MIN_MODULE_COLUMNS, resizing.startItem.w + columnDelta));
        }
        if (resizing.edge.includes("n")) {
            const bottomEdge = resizing.startItem.y + resizing.startItem.h;
            item.h = Math.min(bottomEdge, Math.max(MIN_MODULE_ROWS[resizing.moduleId], resizing.startItem.h - rowDelta));
            item.y = bottomEdge - item.h;
        }
        else if (resizing.edge.includes("s")) {
            item.h = Math.min(GRID_ROWS - item.y, Math.max(MIN_MODULE_ROWS[resizing.moduleId], resizing.startItem.h + rowDelta));
        }
        const resolved = tryResolveGridLayout(layout, resizing.moduleId);
        if (!resolved)
            return;
        local.moduleLayout = resolved;
        renderGridLayout(local.moduleLayout);
    }
    function stopResizing(event, cancelled = false) {
        if (!resizing || (event && event.pointerId !== resizing.pointerId))
            return;
        if (cancelled)
            local.moduleLayout = resizing.originalLayout;
        resizing = null;
        document.body.classList.remove("nch-resizing");
        delete document.body.dataset.nchResizeEdge;
        applyModuleLayout();
        storageSet();
    }
    function moduleResizeZones(id) {
        return ["n", "e", "s", "w", "ne", "nw", "se", "sw"].map(edge => `<span class="nch-resize-zone nch-resize-${edge}" data-resize-module="${id}" data-resize-edge="${edge}"${edge === "se" ? ` role="separator" tabindex="0" aria-label="Resize ${escapeHtml(MODULE_LABELS[id])}"` : ' aria-hidden="true"'}></span>`).join("");
    }
    function addPanel() {
        if (panel?.dataset.renderedRole === currentUserRole)
            return;
        if (panel) {
            restoreNativeChat();
            panel.remove();
            panel = null;
            viewer = null;
        }
        panel = document.createElement("aside");
        panel.id = "netcontrol-ncs-helper";
        panel.dataset.renderedRole = currentUserRole;
        panel.innerHTML = `
      <header>
        <a class="nch-helper-brand" href="/views/dashboard" aria-label="Return to the live nets page" title="Back to Live Nets">
          <span class="nch-helper-title-line"><span data-role="helper-title">WVARC NCO Logger</span> <span class="nch-helper-byline" data-role="helper-byline">UI by KE7WIL</span></span>
          <small data-role="helper-version">Version ${escapeHtml(VERSION)}</small>
        </a>
        <div class="nch-net-title" data-role="net-title">
          <a href="/views/dashboard" aria-label="Return to the live nets page" title="Back to Live Nets">${escapeHtml(latestNetTitle)}</a>
        </div>
        <span class="nch-header-actions">
          <details class="nch-header-menu" data-role="header-menu">
            <summary aria-label="Open helper menu">Menu</summary>
            <div class="nch-header-menu-popover">
              <details class="nch-modules-menu" data-role="menu-modules">
                <summary>Modules</summary>
                <div class="nch-modules-menu-panel" aria-label="Visible modules">
                  ${MODULE_IDS.map(id => `<button data-toggle-module="${id}" aria-pressed="true"><span>${escapeHtml(MODULE_LABELS[id])}</span><small data-module-state>On</small></button>`).join("")}
                  <div class="nch-font-setting" data-role="helper-font-controls" aria-label="Logger text size">
                    <span>Logger text</span>
                    <span class="nch-font-buttons">
                      <button data-helper-font="small" aria-label="Small plugin text" title="Small plugin text">A−</button>
                      <button data-helper-font="normal" aria-label="Standard plugin text" title="Standard plugin text">A</button>
                      <button data-helper-font="large" aria-label="Large plugin text" title="Large plugin text">A+</button>
                    </span>
                  </div>
                  <div class="nch-font-setting" data-role="chat-font-controls" aria-label="Chat text size">
                    <span>Chat text</span>
                    <span class="nch-font-buttons">
                      <button data-chat-font="small" aria-label="Small chat text" title="Small chat text">A−</button>
                      <button data-chat-font="normal" aria-label="Normal chat text" title="Normal chat text">A</button>
                      <button data-chat-font="large" aria-label="Large chat text" title="Large chat text">A+</button>
                    </span>
                  </div>
                  <button class="nch-menu-reset" data-role="menu-reset" title="Restore the original module arrangement">Reset Layout</button>
                </div>
              </details>
              <button data-role="menu-commands">Commands &amp; Shortcuts</button>
              <button data-role="menu-help">Help</button>
              <a data-role="report-bug" href="${escapeHtml(BUG_REPORT_URL)}">Report a Bug</a>
            </div>
          </details>
        </span>
      </header>
      <div class="nch-body">
        <div class="nch-dashboard" data-role="dashboard">
          <section class="nch-module nch-controls-pane" data-module="controls">
            <h3 class="nch-module-header" data-module-drag="controls" tabindex="0" aria-label="Move Station Controls"><span>Station Controls</span></h3>
            <div class="nch-module-content nch-entry-controls">
            <input class="nch-callsign-input nch-admin-only" data-role="callsign" aria-label="Callsign" autocomplete="off" maxlength="15" placeholder="Enter callsign">
            <small class="nch-call-hint nch-admin-only" title="Press ENTER after entering the callsign." aria-label="Press ENTER after entering the callsign.">Press ENTER after entering the callsign.</small>
            <div class="nch-quick-checkin nch-admin-only" aria-label="Check in with station status">
              <button data-quick-tag="mobile" data-short="M" aria-pressed="false" title="Mark Mobile, look up QRZ, and check in">Mobile</button>
              <button data-quick-tag="shortTime" data-short="ST" aria-pressed="false" title="Mark Short Time, look up QRZ, and check in">Short Time</button>
              <button data-quick-tag="portable" data-short="P" aria-pressed="false" title="Mark Portable, look up QRZ, and check in">Portable</button>
              <button class="nch-quick-io" data-quick-command="io" data-short="I/O" title="Look up QRZ, check in, and immediately check out">In &amp; Out</button>
            </div>
            <div class="nch-net-actions nch-admin-only">
              <button class="nch-undo-top" data-editor-command="ui" data-short="Undo" title="Remove the entered callsign from the native net log and return it to Lurkers">Undo Check-in</button>
              <button class="nch-close-net" data-role="close-net" data-short="Close">Close Net</button>
            </div>
            <input type="hidden" data-role="name">
            <input type="hidden" data-role="location">
            </div>
            ${moduleResizeZones("controls")}
          </section>
          <section class="nch-module nch-chat-section" data-module="chat">
            <h3 class="nch-module-header" data-module-drag="chat" tabindex="0" aria-label="Move Chat"><span>Chat</span></h3>
            <div class="nch-module-content nch-chat-module-body">
              <div class="nch-native-chat-slot" data-role="chat-slot">Waiting for net chat to load…</div>
            </div>
            ${moduleResizeZones("chat")}
          </section>
          <section class="nch-module nch-checked-out-section" data-module="checkedOut">
            <h3 class="nch-module-header" data-module-drag="checkedOut" tabindex="0" aria-label="Move Checked Out"><span>Checked Out <small data-role="checked-out-order-note">drag stations to reorder</small></span></h3>
            <div class="nch-module-content" data-role="checked-out"></div>
            ${moduleResizeZones("checkedOut")}
          </section>
          <section class="nch-module nch-active-section" data-module="active">
            <h3 class="nch-module-header" data-module-drag="active" tabindex="0" aria-label="Move Active Log"><span>Active Log <small data-role="active-order-note">fixed roles stay pinned</small></span></h3>
            <div class="nch-module-content" data-role="active"></div>
            ${moduleResizeZones("active")}
          </section>
          <section class="nch-module nch-lurkers-fixed" data-module="lurkers">
            <h3 class="nch-module-header" data-module-drag="lurkers" tabindex="0" aria-label="Move Lurkers"><span>Lurkers <small>visible to NetControl.live</small></span></h3>
            <div class="nch-module-content" data-role="lurkers"></div>
            ${moduleResizeZones("lurkers")}
          </section>
        </div>
        <div class="nch-fixed-status-bar">
          <div class="nch-status" data-role="status" aria-live="polite"></div>
          <div class="nch-footer-mode" data-role="helper-mode" data-short="${escapeHtml(helperModeShortLabel())}">${escapeHtml(helperModeLabel())}</div>
          <div class="nch-count-card" aria-label="Net check-in totals">
            <span><strong data-role="logged-count">0</strong><small>In Log</small></span>
            <span><strong data-role="active-count">0</strong><small>Active</small></span>
            <span><strong data-role="checked-out-count">0</strong><small>Checked Out</small></span>
            <span><strong data-role="recheck-count">0</strong><small>Rechecks</small></span>
          </div>
        </div>
        <div class="nch-edit-modal" data-role="edit-modal" hidden>
          <div class="nch-edit-card">
            <h3>Edit Station Information</h3>
            <label>Callsign <input data-modal="callsign" maxlength="15" autocomplete="off"></label>
            <label>Name <input data-modal="name" maxlength="40"></label>
            <label>Location <input data-modal="location" maxlength="40"></label>
            <small>Roles, station statuses, and notes are managed from the row’s hover menu.</small>
            <div class="nch-modal-actions">
              <button data-role="save-edit">Save</button>
              <button data-role="cancel-edit">Cancel</button>
            </div>
          </div>
        </div>
        <div class="nch-edit-modal nch-close-confirm" data-role="close-confirm" hidden>
          <div class="nch-edit-card" role="alertdialog" aria-modal="true" aria-labelledby="nch-close-title">
            <h3 id="nch-close-title">Close This Net?</h3>
            <p>This will end the active NetControl.live session for everyone. Are you sure?</p>
            <div class="nch-modal-actions">
              <button class="nch-confirm-close" data-role="confirm-close">Yes, Close Net</button>
              <button data-role="cancel-close">Cancel</button>
            </div>
          </div>
        </div>
        <div class="nch-help-modal" data-role="help-modal" hidden>
          <article class="nch-help-card" role="dialog" aria-modal="true" aria-labelledby="nch-help-title">
            <header class="nch-help-heading">
              <div><h2 id="nch-help-title">NCO Helper User Guide</h2><small>Version ${escapeHtml(VERSION)}</small></div>
              <div class="nch-help-actions">
                <div class="nch-font-setting" data-role="help-font-controls" aria-label="Help text size">
                  <span class="nch-font-buttons">
                    <button data-help-font="small" aria-label="Small help text" title="Small help text">A−</button>
                    <button data-help-font="normal" aria-label="Normal help text" title="Normal help text">A</button>
                    <button data-help-font="large" aria-label="Large help text" title="Large help text">A+</button>
                  </span>
                </div>
                <button data-role="close-help" aria-label="Close Help">Close</button>
              </div>
            </header>
            <div class="nch-help-content">
              <section><h3>Getting started</h3><p>Open an active WVARC net. The logger detects your current role and opens in NCO, Logger, Relay, or Viewer Mode.</p></section>
              <section><h3>Interface modules</h3><p>Station Controls handles callsign entry and permitted net actions. Chat docks the native conversation. Active Log shows connected stations. Checked Out shows completed contacts. Lurkers shows visible visitors who are not yet logged. QRZ Setup is available from Menu.</p></section>
              <section><h3>Modes and permissions</h3><ul><li><strong>NCO:</strong> full permitted check-in, checkout, editing, role, handoff, ordering, and confirmed Close Net controls.</li><li><strong>Logger:</strong> permitted station management, Undo Check-in for non-NCO stations, and Relay assignment, without NCO-only Close Net, undoing the NCO, Logger assignment, or NCO handoff.</li><li><strong>Relay and Viewer:</strong> read-only station lists, chat, private notes, layout controls, and the operator's own hand control.</li></ul></section>
              <section><h3>Checking stations in</h3><p>Enter a callsign and press Enter. Mobile, Short Time, Portable, and In &amp; Out perform the same QRZ lookup and real check-in while adding the selected status. Undo Check-in removes the callsign currently entered in Station Controls from the native net log and returns that station to Lurkers if they are still watching. Logger may use Undo Check-in except against the NCO. Close Net remains NCO-only and sends nothing until the confirmation button is selected.</p></section>
              <section><h3>QRZ and photos</h3><p>New-station check-ins use the server's configured QRZ integration. Profile photos use the returned station image and fall back to the bundled default avatar.</p></section>
              <section><h3>Station rows</h3><p>Move the pointer anywhere over a station row, or focus it with the keyboard, to change the row color and open its available controls without making the row taller. Active Log controls use about half of the row width and float over the right side of following rows. Right-click a row to pin or unpin its controls; Shift-right-click keeps the browser menu. Checked Out and Lurker rows use small inline controls that temporarily replace the row text instead of covering other stations. Active tags and role tags are labeled and color matched; select a tag’s × to clear it. There are no colored edge tabs.</p></section>
              <section data-role="slash-command-help">${slashHelpHtml()}</section>
              <section><h3>Notes, names, and locations</h3><p>Use Note in an Active Log row’s hover tray to edit a private one-line note; saved notes remain visible. Notes are not synchronized. Edit Station changes only callsign, name, and location; Enter saves and Escape cancels. Name and location overrides saved by the authenticated NCO or Logger persist across nets and sessions and are shared with every installed helper, including Relay and Viewer, while remaining helper-only. Names, suffixes, and locations are formatted consistently.</p></section>
              <section><h3>Ordering and alerts</h3><p>NCO and Logger users can drag ordinary station rows to reorder them. Fixed-role rows cannot be moved. A new lurker pulses three times when it first appears after the helper has loaded. An active row pulses three times when that station newly raises a hand. Routine polling and lowering a hand do not restart the alert.</p></section>
              <section><h3>Modules and layout</h3><p>Drag a module by its thin title bar. Resize from any edge or corner. Modules snap to a fine grid and neighboring edges, never overlap, and keep long content scrolling inside the module. Use Menu → Modules to turn each module on or off, choose the Plugin text size for everything inside NCO Helper, adjust Chat text separately when useful, or reset the layout. Reset Layout restores the designed arrangement with all five modules visible without deleting station data, notes, QRZ credentials, font choices, or synchronized state.</p></section>
              <section><h3>Chat</h3><p>The app's authenticated group chat is docked inside the Chat module. Emoji, image upload, Send, pins, duplicate suppression, and image viewing remain available.</p></section>
              <section><h3>Status and counts</h3><p>The fixed bottom bar shows the current action, operator mode, and visible In Log, Active, Checked Out, and Recheck totals.</p></section>
              <section><h3>Synchronization and safety</h3><p>Authorized NCO and Logger users save operational tags, shared name/location overrides, visibility, selection, and station ordering directly to this live net. Private notes and personal module layout stay in this browser. Cancel and close controls never mutate the net until their explicit confirmation action is selected.</p></section>
              <section><h3>Report a problem</h3><p>Use Menu → Report a Bug to open a prepared email to KE7WIL. Your email program will let you review and send it; the helper never sends email automatically.</p></section>
            </div>
          </article>
        </div>
        <div class="nch-help-modal nch-commands-modal" data-role="commands-modal" hidden>
          <article class="nch-help-card nch-commands-card" role="dialog" aria-modal="true" aria-labelledby="nch-commands-title">
            <header class="nch-help-heading">
              <div><h2 id="nch-commands-title">Commands &amp; Shortcuts</h2><small>Version ${escapeHtml(VERSION)}</small></div>
              <button data-role="close-commands" aria-label="Close Commands and Shortcuts">Close</button>
            </header>
            <div class="nch-help-content nch-commands-content" data-role="commands-modal-content">${slashHelpHtml()}</div>
          </article>
        </div>
        <div class="nch-update-modal" data-role="update-modal" hidden>
          <article class="nch-update-card" role="alertdialog" aria-modal="true" aria-labelledby="nch-update-title">
            <h2 id="nch-update-title">NCO Helper Update Available</h2>
            <p>Version <strong data-role="available-version"></strong> is available. Your installed version is ${escapeHtml(VERSION)}.</p>
            <p>The desktop updater verifies the approved package, backs up this extension folder, installs in place, and automatically restores the previous files if installation fails. Chrome’s extension storage and relay settings stay associated with this unpacked extension.</p>
            <p data-role="updater-fallback" hidden>If the updater does not open, install NCO Helper Updater or <a href="mailto:ke7wil@gmail.com?subject=NCO%20Helper%20Updater">contact KE7WIL</a>.</p>
            <div class="nch-update-actions">
              <button data-role="launch-updater">Open NCO Helper Updater</button>
              <button data-role="close-update">Not Now</button>
            </div>
          </article>
        </div>
        <div class="nch-photo-viewer" data-role="photo-viewer" hidden>
          <div class="nch-photo-card" role="dialog" aria-modal="true" aria-labelledby="nch-photo-title">
            <button class="nch-photo-close" data-role="close-photo" aria-label="Close enlarged photo">×</button>
            <button class="nch-photo-download" data-role="download-photo" aria-label="Download chat image" title="Download chat image" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14"/></svg></button>
            <h3 id="nch-photo-title" data-role="photo-title">Station photo</h3>
            <img data-role="photo-image" src="${escapeHtml(DEFAULT_AVATAR)}" alt="Enlarged station profile">
          </div>
        </div>
        <div class="nch-viewer-host" data-role="viewer-host" hidden></div>
      </div>`;
        if (!canManageStations()) {
            panel.querySelectorAll(".nch-admin-only, [data-role='edit-modal'], [data-role='close-confirm']").forEach(element => element.remove());
        }
        else if (!isNcoUser()) {
            panel.querySelectorAll("[data-role='close-net'], [data-role='close-confirm']").forEach(element => element.remove());
        }
        const mount = document.getElementById("nco-logger-root");
        if (!mount)
            throw new Error("NCO Logger page root is missing.");
        mount.replaceChildren(panel);
        setStatus("");
        lockBackgroundScroll();
        dockNativeChat();
        panel.addEventListener("click", async (event) => {
            if (event.target.matches?.("[data-role='photo-viewer']")) {
                closePhotoViewer();
                return;
            }
            if (event.target.matches?.("[data-role='help-modal']")) {
                event.target.hidden = true;
                syncNativeChatVisibility();
                return;
            }
            if (event.target.matches?.("[data-role='commands-modal']")) {
                event.target.hidden = true;
                syncNativeChatVisibility();
                return;
            }
            if (event.target.matches?.("[data-role='update-modal']")) {
                event.target.hidden = true;
                updatePromptDismissed = true;
                syncNativeChatVisibility();
                return;
            }
            const clickedRow = event.target.closest?.(".nch-row[data-call]");
            const clickedInteractive = event.target.closest?.("button, input, textarea, select, a, [contenteditable='true'], .nch-drag, .nch-row-actions");
            if (clickedRow && !clickedInteractive && canManageStations()) {
                const call = normalizeCall(clickedRow.dataset.call);
                if (pinnedActionCall && pinnedActionCall !== call)
                    pinnedActionCall = "";
                const station = latestStations.find(item => normalizeCall(item.callSign) === call);
                if (station?.checkedState === true && station.role !== "netcontrol") {
                    selectedNextCall = selectedNextCall === call ? "" : call;
                    publishSharedSelection();
                    renderQueue();
                    setStatus(selectedNextCall ? `${call} selected as the next station.` : `${call} next-station selection cleared.`, "success");
                    return;
                }
            }
            const target = event.target.closest("button");
            if (!target)
                return;
            if (target.disabled)
                return;
            if (target.dataset.toggleModule) {
                const id = target.dataset.toggleModule;
                const layout = normalizeModuleLayout();
                setModuleCollapsed(id, !layout.collapsed[id]);
                return;
            }
            if (target.dataset.helperFont) {
                local.helperFontPreset = normalizeFontPreset(target.dataset.helperFont);
                storageSet();
                applyDisplayPreferences();
                return;
            }
            if (target.dataset.chatFont) {
                local.chatFontPreset = normalizeFontPreset(target.dataset.chatFont);
                storageSet();
                applyDisplayPreferences();
                return;
            }
            if (target.dataset.role === "private-send") {
                await sendPrivateChatMessage();
                return;
            }
            if (target.dataset.helpFont) {
                local.helpFontPreset = normalizeFontPreset(target.dataset.helpFont);
                storageSet();
                applyDisplayPreferences();
                return;
            }
            const stationAdminAction = target.dataset.command || target.dataset.delete || target.dataset.specialGuest ||
                target.dataset.noReply || target.dataset.neededNext || target.dataset.skip || target.dataset.addLurker || target.dataset.quickTag ||
                target.dataset.quickCommand || target.dataset.editorCommand || target.dataset.edit || target.dataset.setTag || target.dataset.setRole ||
                target.dataset.rowCheckout || target.dataset.rowCheckin || target.dataset.clearTag ||
                ["save-edit", "cancel-edit"].includes(target.dataset.role);
            if (stationAdminAction && !canManageStations()) {
                setStatus("That station-management action is not available in this helper mode.", "warning");
                return;
            }
            if (target.dataset.viewPhoto) {
                const call = normalizeCall(target.dataset.viewPhoto);
                const source = target.querySelector("img.nch-avatar")?.src || DEFAULT_AVATAR;
                openPhotoViewer(source, `${call} QRZ photo`, `${call} enlarged QRZ profile`, target);
            }
            if (target.dataset.role === "close-photo") {
                closePhotoViewer();
            }
            if (target.dataset.role === "download-photo") {
                await downloadChatImage(target.dataset.imageUrl);
            }
            if (target.dataset.command) {
                const commandLine = target.dataset.command;
                const succeeded = await runCommand(commandLine);
                const [verb, call] = commandLine.split(/\s+/);
                if (succeeded && call && ["i", "o"].includes(verb)) {
                    markIo(call, false);
                    renderQueue();
                }
            }
            if (target.dataset.rowCheckout) {
                const call = normalizeCall(target.dataset.rowCheckout);
                const station = latestStations.find(item => normalizeCall(item.callSign) === call);
                if (!station || call === selfCall() || (!isNcoUser() && station.role === "netcontrol")) {
                    setStatus("That station cannot be checked out in the current helper mode.", "warning");
                    return;
                }
                const succeeded = await runCommand(`o ${call}`);
                if (succeeded) {
                    clearCheckoutAlerts(call);
                    markIo(call, false);
                    if (station.highlight)
                        setStationInteraction(call, "highlight", false);
                    publishSharedTags(call);
                    renderQueue();
                }
            }
            if (target.dataset.rowCheckin)
                await lookupAndCheckIn(target.dataset.rowCheckin);
            if (target.dataset.edit)
                openEditModal(target.dataset.edit);
            if (target.dataset.delete) {
                const call = normalizeCall(target.dataset.delete);
                const station = latestStations.find(item => normalizeCall(item.callSign) === call);
                if (["netcontrol", "netlogger", "netrelay"].includes(station?.role || "")) {
                    setStatus("Special-role stations cannot be deleted from the helper log.", "warning");
                    return;
                }
                if (confirm(`Are you sure you want to delete ${call} from the helper log? The official NetControl.live record will remain.`)) {
                    hiddenCalls.add(call);
                    local.hiddenCalls = [...hiddenCalls];
                    storageSet();
                    publishSharedVisibility(call, true);
                    renderQueue();
                    setStatus(`${call} removed from every connected helper display. The official NetControl.live record was not changed.`, "success");
                }
            }
            if (target.dataset.editNote) {
                editingNoteCall = normalizeCall(target.dataset.editNote);
                noteDrafts.set(editingNoteCall, detailsFor(editingNoteCall).note);
                renderQueue();
                panel.querySelector(`[data-note-input='${CSS.escape(editingNoteCall)}']`)?.focus();
            }
            if (target.dataset.cancelNote) {
                noteDrafts.delete(normalizeCall(target.dataset.cancelNote));
                editingNoteCall = "";
                renderQueue();
            }
            if (target.dataset.saveNote) {
                const call = normalizeCall(target.dataset.saveNote);
                const input = panel.querySelector(`[data-note-input='${CSS.escape(call)}']`);
                const current = detailsFor(call);
                const draft = input?.value ?? noteDrafts.get(call) ?? "";
                local.details[call] = { ...current, note: String(draft).trim().slice(0, NOTE_MAX) };
                noteDrafts.delete(call);
                editingNoteCall = "";
                storageSet();
                renderQueue();
                setStatus(`Note saved for ${call}.`, "success");
            }
            if (target.dataset.specialGuest) {
                const call = normalizeCall(target.dataset.specialGuest);
                setSpecialGuest(call);
            }
            const rowCall = normalizeCall(target.dataset.call || target.closest(".nch-row")?.dataset.call);
            if (target.dataset.setTag)
                await setRowTag(rowCall, target.dataset.setTag);
            if (target.dataset.setRole)
                await changeStationRole(rowCall, target.dataset.setRole);
            if (target.dataset.clearTag) {
                await clearRowTag(rowCall, target.dataset.clearTag);
            }
            if (target.dataset.role === "save-edit")
                await saveEditModal();
            if (target.dataset.role === "cancel-edit")
                closeEditModal();
            if (["open-viewer", "menu-viewer"].includes(target.dataset.role)) {
                const host = panel.querySelector("[data-role='viewer-host']");
                if (host)
                    host.hidden = false;
                const menu = panel.querySelector("[data-role='header-menu']");
                if (menu)
                    menu.open = false;
                syncNativeChatVisibility();
            }
            if (target.dataset.role === "menu-help") {
                const help = panel.querySelector("[data-role='help-modal']");
                if (help)
                    help.hidden = false;
                const menu = panel.querySelector("[data-role='header-menu']");
                if (menu)
                    menu.open = false;
                syncNativeChatVisibility();
            }
            if (target.dataset.role === "close-help") {
                const help = panel.querySelector("[data-role='help-modal']");
                if (help)
                    help.hidden = true;
                syncNativeChatVisibility();
            }
            if (target.dataset.role === "menu-commands" || target.dataset.role === "commands-help") {
                showSlashHelp();
                const menu = panel.querySelector("[data-role='header-menu']");
                if (target.dataset.role === "menu-commands" && menu)
                    menu.open = false;
            }
            if (target.dataset.role === "close-commands") {
                const commands = panel.querySelector("[data-role='commands-modal']");
                if (commands)
                    commands.hidden = true;
                syncNativeChatVisibility();
            }
            if (target.dataset.role === "show-update") {
                const update = panel.querySelector("[data-role='update-modal']");
                if (update)
                    update.hidden = false;
                updatePromptDismissed = false;
                syncNativeChatVisibility();
            }
            if (target.dataset.role === "launch-updater") {
                launchUpdater();
            }
            if (target.dataset.role === "close-update") {
                const update = panel.querySelector("[data-role='update-modal']");
                if (update)
                    update.hidden = true;
                updatePromptDismissed = true;
                syncNativeChatVisibility();
            }
            if (target.dataset.role === "close-net") {
                const modal = panel.querySelector("[data-role='close-confirm']");
                if (isNcoUser() && modal)
                    modal.hidden = false;
                syncNativeChatVisibility();
            }
            if (target.dataset.role === "cancel-close") {
                const modal = panel.querySelector("[data-role='close-confirm']");
                if (modal)
                    modal.hidden = true;
                syncNativeChatVisibility();
            }
            if (target.dataset.role === "confirm-close") {
                const modal = panel.querySelector("[data-role='close-confirm']");
                if (modal)
                    modal.hidden = true;
                syncNativeChatVisibility();
                if (isNcoUser())
                    await runCommand("close");
            }
            if (target.dataset.role === "relay-save") {
                const input = panel.querySelector("[data-role='relay-token']");
                const candidate = String(input?.value || "").trim();
                if (!globalThis.NCOHelperRelay?.validToken(candidate)) {
                    setStatus("Enter the valid relay token issued for this callsign.", "error");
                    return;
                }
                relayToken = candidate;
                storeRelayToken();
                input.value = "";
                stopSync();
                startSync();
                const relayMenu = panel.querySelector("details.nch-relay-menu");
                if (relayMenu)
                    relayMenu.open = false;
                refreshRelaySetup();
                setStatus("Relay token saved locally. Connection started.", "success");
            }
            if (target.dataset.role === "relay-forget") {
                relayToken = "";
                const input = panel.querySelector("[data-role='relay-token']");
                if (input)
                    input.value = "";
                browserStorage.remove(relayTokenKey);
                stopSync();
                startSync();
                refreshRelaySetup();
                setStatus("Saved relay token removed. Local helper operation continues.", "success");
            }
            if (target.dataset.role === "qrz-login") {
                setStatus("Signing in to QRZ…", "working");
                try {
                    await qrzLogin();
                    setStatus("QRZ login saved and ready.", "success");
                    const qrzMenu = panel.querySelector("details.nch-qrz");
                    if (qrzMenu)
                        qrzMenu.open = false;
                    qrzAttemptedCalls.clear();
                    latestStations.forEach(station => {
                        const call = normalizeCall(station.callSign);
                        const current = detailsFor(call);
                        local.details[call] = { ...current, qrzPhotoChecked: false, qrzCheckedAt: 0 };
                    });
                    storageSet();
                    queueMissingQrzPhotos();
                }
                catch (error) {
                    setStatus(error.message || String(error), "error");
                }
            }
            if (target.dataset.role === "forget-qrz") {
                qrzPassword = "";
                qrzSessionKey = "";
                browserStorage.remove(qrzAuthKey);
                panel.querySelector("[data-role='qrz-password']").value = "";
                refreshQrzPasswordHint();
                setStatus("Saved QRZ login removed.", "success");
            }
            if (target.dataset.quickTag) {
                await lookupAndCheckIn(panel.querySelector("[data-role='callsign']").value, target.dataset.quickTag);
            }
            if (target.dataset.quickCommand === "io") {
                await lookupAndCheckIn(panel.querySelector("[data-role='callsign']").value, null, "io");
            }
            if (target.dataset.addLurker) {
                const call = normalizeCall(target.dataset.addLurker);
                if (busyCalls.has(call))
                    return;
                busyCalls.add(call);
                renderQueue();
                try {
                    await lookupAndCheckIn(call);
                }
                finally {
                    busyCalls.delete(call);
                    renderQueue();
                }
            }
            if (target.dataset.noReply) {
                const call = normalizeCall(target.dataset.noReply);
                const current = detailsFor(call);
                local.details[call] = { ...current, notResponding: !current.notResponding };
                storageSet();
                publishSharedTags(call);
                if (normalizeCall(panel.querySelector("[data-role='callsign']").value) === call)
                    loadEditor(call);
                renderQueue();
            }
            if (target.dataset.neededNext) {
                const call = normalizeCall(target.dataset.neededNext);
                const current = detailsFor(call);
                local.details[call] = { ...current, neededNext: !current.neededNext };
                storageSet();
                publishSharedTags(call);
                if (normalizeCall(panel.querySelector("[data-role='callsign']").value) === call)
                    loadEditor(call);
                renderQueue();
            }
            if (target.dataset.skip) {
                const call = normalizeCall(target.dataset.skip);
                const current = detailsFor(call);
                local.details[call] = { ...current, skipped: !current.skipped };
                storageSet();
                publishSharedTags(call);
                renderQueue();
                setStatus(`${call} ${current.skipped ? "removed from" : "marked to skip for"} this round.`, "success");
            }
            if (target.dataset.toggleHighlight) {
                await setStationInteraction(normalizeCall(target.dataset.toggleHighlight), "highlight", target.dataset.state !== "true");
            }
            if (target.dataset.toggleHand) {
                await setStationInteraction(normalizeCall(target.dataset.toggleHand), "hand", target.dataset.state !== "true");
            }
            if (target.dataset.editorCommand) {
                const call = saveEditor();
                if (!call)
                    return setStatus("Enter a callsign first.", "error");
                const command = target.dataset.editorCommand;
                const succeeded = await runCommand(`${command} ${call}`);
                if (succeeded)
                    markIo(call, command === "io");
                renderQueue();
                if (succeeded && ["i", "hi", "io"].includes(command))
                    clearEditor();
            }
            if (target.dataset.role === "reset" && confirm("Reset this net's private helper order, locations, and tags?")) {
                local = {
                    order: [], checkedOutOrder: [], lurkerOrder: [], ioCalls: [], recheckCalls: [], details: {}, hiddenCalls: [],
                    paneSizes: { ...local.paneSizes }, collapsedSections: { ...local.collapsedSections },
                    moduleLayout: normalizeModuleLayout(),
                    helperFontPreset: normalizeFontPreset(local.helperFontPreset),
                    chatFontPreset: normalizeFontPreset(local.chatFontPreset),
                    helpFontPreset: normalizeFontPreset(local.helpFontPreset),
                    manualOrder: false, sharedUpdatedAt: 0
                };
                hiddenCalls.clear();
                if (canManageStations())
                    local.sharedUpdatedAt = Date.now();
                storageSet();
                loadEditor("");
                applyModuleLayout();
                renderQueue();
                publishSharedSnapshotSafely();
            }
        });
        panel.addEventListener("contextmenu", event => {
            const row = event.target.closest?.(".nch-row[data-call]");
            if (!row || event.shiftKey || event.target.closest?.("button, input, textarea, select, a, [contenteditable='true']"))
                return;
            event.preventDefault();
            const call = normalizeCall(row.dataset.call);
            pinnedActionCall = pinnedActionCall === call ? "" : call;
            clearActionOrientationRows();
            renderQueue();
            setStatus(pinnedActionCall ? `${call} controls pinned. Right-click the row again to close them.` : `${call} controls unpinned.`, "success");
        });
        panel.addEventListener("pointerover", event => {
            const row = event.target.closest?.(".nch-row[data-call]");
            if (row && !pinnedActionCall)
                orientRowActions(row);
        });
        panel.addEventListener("focusin", event => {
            const row = event.target.closest?.(".nch-row[data-call]");
            if (row && !pinnedActionCall)
                orientRowActions(row);
        });
        panel.addEventListener("pointerleave", clearActionOrientationRows);
        window.addEventListener("resize", () => {
            if (!pinnedActionCall || !panel)
                return;
            orientRowActions(panel.querySelector(`[data-call='${CSS.escape(pinnedActionCall)}']`));
        });
        panel.querySelector("[data-role='header-menu']")?.addEventListener("toggle", syncNativeChatVisibility);
        panel.querySelector("[data-role='callsign']")?.addEventListener("keydown", async (event) => {
            if (event.key !== "Enter" || event.repeat)
                return;
            event.preventDefault();
            await lookupAndCheckIn(event.target.value);
        });
        panel.querySelector("[data-role='callsign']")?.addEventListener("change", event => {
            const call = normalizeCall(event.target.value);
            loadEditor(call);
        });
        panel.querySelector("[data-role='location']")?.addEventListener("change", () => { saveEditor(); renderQueue(); });
        panel.querySelector("[data-role='name']")?.addEventListener("change", () => { saveEditor(); renderQueue(); });
        panel.querySelectorAll("[data-tag]").forEach(input => input.addEventListener("change", () => { saveEditor(); renderQueue(); }));
        panel.querySelector("[data-role='private-selector']")?.addEventListener("toggle", () => syncNativeChatVisibility());
        panel.querySelector("[data-role='private-options']")?.addEventListener("click", event => {
            const choice = event.target.closest?.("[data-private-choice]");
            if (!choice || choice.disabled)
                return;
            event.stopPropagation();
            privateChatTarget = normalizeCall(choice.dataset.privateChoice);
            const selector = panel.querySelector("[data-role='private-selector']");
            if (selector)
                selector.open = false;
            renderHelperChatUi();
            syncNativeChatVisibility();
        });
        panel.addEventListener("input", event => {
            const noteInput = event.target.closest("[data-note-input]");
            if (noteInput)
                noteDrafts.set(normalizeCall(noteInput.dataset.noteInput), noteInput.value);
        });
        panel.addEventListener("focusout", event => {
            const noteInput = event.target.closest("[data-note-input]");
            if (!noteInput)
                return;
            const call = normalizeCall(noteInput.dataset.noteInput);
            noteDrafts.set(call, noteInput.value);
            const start = noteInput.selectionStart;
            const end = noteInput.selectionEnd;
            window.requestAnimationFrame(() => {
                if (noteInput.isConnected || editingNoteCall !== call)
                    return;
                const replacement = panel?.querySelector(`[data-note-input='${CSS.escape(call)}']`);
                replacement?.focus();
                replacement?.setSelectionRange(start, end);
            });
        });
        panel.addEventListener("keydown", async (event) => {
            const editModal = event.target.closest?.("[data-role='edit-modal']");
            if (editModal && !editModal.hidden && ["Enter", "Escape"].includes(event.key) && !event.isComposing && !event.repeat) {
                event.preventDefault();
                if (event.key === "Enter")
                    await saveEditModal();
                else
                    closeEditModal();
                return;
            }
            if (event.key === "Escape" && !panel.querySelector("[data-role='photo-viewer']")?.hidden) {
                closePhotoViewer();
                return;
            }
            if (event.key === "Escape" && !panel.querySelector("[data-role='help-modal']")?.hidden) {
                panel.querySelector("[data-role='help-modal']").hidden = true;
                syncNativeChatVisibility();
                return;
            }
            if (event.key === "Escape" && !panel.querySelector("[data-role='commands-modal']")?.hidden) {
                panel.querySelector("[data-role='commands-modal']").hidden = true;
                syncNativeChatVisibility();
                return;
            }
            if (event.key === "Escape" && pinnedActionCall) {
                pinnedActionCall = "";
                renderQueue();
                return;
            }
            if (event.key === "Escape" && !panel.querySelector("[data-role='update-modal']")?.hidden) {
                panel.querySelector("[data-role='update-modal']").hidden = true;
                updatePromptDismissed = true;
                syncNativeChatVisibility();
                return;
            }
            const privateInput = event.target.closest("[data-role='private-input']");
            if (privateInput && event.key === "Enter" && !event.shiftKey && !event.isComposing && !event.repeat) {
                event.preventDefault();
                await sendPrivateChatMessage();
                return;
            }
            const noteInput = event.target.closest("[data-note-input]");
            if (noteInput && ["Enter", "Escape"].includes(event.key)) {
                event.preventDefault();
                const call = normalizeCall(noteInput.dataset.noteInput);
                if (event.key === "Enter") {
                    const current = detailsFor(call);
                    local.details[call] = { ...current, note: noteInput.value.trim().slice(0, NOTE_MAX) };
                    storageSet();
                    setStatus(`Note saved for ${call}.`, "success");
                }
                noteDrafts.delete(call);
                editingNoteCall = "";
                renderQueue();
            }
            const moduleResizer = event.target.closest("[data-resize-module]");
            if (moduleResizer && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
                event.preventDefault();
                const id = moduleResizer.dataset.resizeModule;
                resizeModuleBy(id, event.key === "ArrowLeft" ? -1 : 1, 0);
            }
            if (moduleResizer && ["ArrowUp", "ArrowDown"].includes(event.key)) {
                event.preventDefault();
                const id = moduleResizer.dataset.resizeModule;
                resizeModuleBy(id, 0, event.key === "ArrowUp" ? -1 : 1);
            }
            const moduleHandle = event.target.closest("[data-module-drag]");
            if (moduleHandle && event.altKey && ["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(event.key)) {
                event.preventDefault();
                const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
                moveModuleByGrid(moduleHandle.dataset.moduleDrag, ...deltas[event.key]);
            }
        });
        panel.addEventListener("dragstart", event => {
            if (!canManageStations())
                return event.preventDefault();
            const row = event.target.closest(".nch-row[draggable='true']");
            if (!row || event.target.closest("button, input, select, textarea, a"))
                return event.preventDefault();
            dragging = { call: row.dataset.call, group: row.dataset.group };
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", row.dataset.call);
            event.dataTransfer.setDragImage(row, 24, Math.min(24, row.offsetHeight / 2));
            row.classList.add("nch-dragging");
        });
        panel.addEventListener("dragover", event => {
            const row = event.target.closest(".nch-row");
            if (!row || !dragging || row.dataset.group !== dragging.group || row.dataset.call === dragging.call)
                return;
            event.preventDefault();
            clearDropIndicators();
            const after = row.dataset.pinned === "true" || event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
            row.classList.add(after ? "nch-drop-after" : "nch-drop-before");
            dragging.after = after;
            const scroller = row.closest("[data-role='checked-out'], [data-role='active'], [data-role='lurkers']");
            const box = scroller?.getBoundingClientRect();
            if (box && event.clientY < box.top + 36)
                scroller.scrollTop -= 20;
            if (box && event.clientY > box.bottom - 36)
                scroller.scrollTop += 20;
        });
        panel.addEventListener("drop", event => {
            if (!canManageStations())
                return;
            const row = event.target.closest(".nch-row");
            if (!row)
                return;
            event.preventDefault();
            moveDragged(row.dataset.call, row.dataset.group, Boolean(dragging?.after));
            clearDropIndicators();
        });
        panel.addEventListener("dragend", () => {
            panel.querySelectorAll(".nch-dragging").forEach(row => row.classList.remove("nch-dragging"));
            clearDropIndicators();
            dragging = null;
        });
        panel.addEventListener("pointerdown", event => {
            const moduleResizer = event.target.closest("[data-resize-module]");
            if (moduleResizer) {
                event.preventDefault();
                const moduleId = moduleResizer.dataset.resizeModule;
                const layout = normalizeModuleLayout();
                resizing = {
                    moduleId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
                    startItem: { ...layout.items[moduleId] }, originalLayout: layout,
                    edge: moduleResizer.dataset.resizeEdge || "se"
                };
                moduleResizer.setPointerCapture?.(event.pointerId);
                document.body.classList.add("nch-resizing");
                document.body.dataset.nchResizeEdge = resizing.edge;
                return;
            }
            const moduleHandle = event.target.closest("[data-module-drag]");
            if (!moduleHandle || event.target.closest("button, input, select, textarea, a") || event.button !== 0)
                return;
            const module = moduleHandle.closest("[data-module]");
            const dashboard = panel.querySelector("[data-role='dashboard']");
            if (!module || !dashboard)
                return;
            event.preventDefault();
            modulePointerDrag = {
                moduleId: module.dataset.module, module, dashboard, pointerId: event.pointerId,
                startX: event.clientX, startY: event.clientY, started: false,
                originalLayout: resolveGridLayout(local.moduleLayout)
            };
            moduleHandle.setPointerCapture?.(event.pointerId);
        });
        panel.addEventListener("pointermove", event => {
            if (resizing)
                resizeFromPointer(event);
            else
                updateModulePointerDrag(event);
        });
        panel.addEventListener("pointerup", event => {
            if (resizing)
                stopResizing(event);
            else
                stopModulePointerDrag(event);
        });
        panel.addEventListener("pointercancel", event => {
            if (resizing)
                stopResizing(event, true);
            else
                cancelModulePointerDrag(event);
        });
        panel.addEventListener("lostpointercapture", event => {
            if (resizing?.pointerId === event.pointerId)
                stopResizing(event, true);
            else if (modulePointerDrag?.pointerId === event.pointerId)
                cancelModulePointerDrag(event);
        });
        panel.addEventListener("dblclick", event => {
            const moduleResizer = event.target.closest("[data-resize-module]");
            const id = moduleResizer?.dataset.resizeModule;
            if (!id)
                return;
            const layout = normalizeModuleLayout();
            layout.items[id] = { ...defaultModuleLayoutForMode().items[id] };
            local.moduleLayout = resolveGridLayout(layout, id);
            applyModuleLayout();
            storageSet();
        });
        panel.querySelector("[data-role='menu-reset']")?.addEventListener("click", () => {
            local.moduleLayout = resolveGridLayout(defaultModuleLayoutForMode());
            storageSet();
            applyModuleLayout();
            const menu = panel.querySelector("[data-role='header-menu']");
            if (menu)
                menu.open = false;
            setStatus("Module layout reset.", "success");
        });
        applyRoleUi();
        applyDisplayPreferences();
        applyModuleLayout();
        const viewerHost = panel.querySelector("[data-role='viewer-host']");
        ensureViewer()?.attach(viewerHost, {
            onClose() { viewerHost.hidden = true; syncNativeChatVisibility(); },
            async onHandoff(handoff) {
                const call = normalizeCall(String(handoff.entity_id || "").replace(/^station:/, ""));
                viewerHost.hidden = true;
                syncNativeChatVisibility();
                if (handoff.requested_intent === "edit_station" && canManageStations()) {
                    openEditModal(call);
                    return { ok: true, status: "handed_to_owner" };
                }
                if (handoff.requested_intent === "toggle_own_hand" && call === selfCall()) {
                    const station = latestStations.find(item => normalizeCall(item.callSign) === call);
                    const ok = await setStationInteraction(call, "hand", !station?.hand);
                    return { ok, status: ok ? "completed" : "failed" };
                }
                return { ok: false, status: "permission_denied", retryable: false };
            }
        });
        syncViewer();
    }
    async function refresh() {
        const requestSequence = ++refreshRequestSequence;
        try {
            const data = await fetchNet();
            if (requestSequence < refreshAppliedSequence)
                return;
            refreshAppliedSequence = requestSequence;
            const nextStations = Array.isArray(data.stations) ? data.stations : [];
            observeStationTransitions(nextStations);
            latestStations = nextStations;
            latestNetTitle = String(data.net?.title || "").trim();
            latestNetFrequency = String(data.net?.frequency || "").trim();
            if (closedAfterHandoff)
                return;
            const me = latestStations.find(station => normalizeCall(station.callSign) === selfCall());
            if (!me) {
                restoreNativeChat();
                unlockBackgroundScroll();
                panel?.remove();
                panel = null;
                return;
            }
            const focusedNote = document.activeElement?.matches?.("[data-note-input]")
                ? {
                    call: normalizeCall(document.activeElement.dataset.noteInput),
                    value: document.activeElement.value,
                    start: document.activeElement.selectionStart,
                    end: document.activeElement.selectionEnd
                }
                : null;
            if (focusedNote)
                noteDrafts.set(focusedNote.call, focusedNote.value);
            const previousRole = currentUserRole;
            currentUserRole = me.role || "netuser";
            const serverLoggerState = data.loggerState;
            if (serverLoggerState && Number(serverLoggerState.updated_at) > lastServerLoggerRevision) {
                lastServerLoggerRevision = Number(serverLoggerState.updated_at);
                applySharedUpdate({
                    action: "snapshot",
                    payload: serverLoggerState,
                    sender: { role: "netcontrol" },
                    envelope: { timestamp: Number(serverLoggerState.updated_at) }
                });
            }
            const nextRenderSignature = remoteRenderSignature(latestStations, latestNetTitle, currentUserRole);
            const remoteUiChanged = nextRenderSignature !== lastRemoteRenderSignature;
            lastRemoteRenderSignature = nextRenderSignature;
            if (!["netcontrol", "netlogger"].includes(previousRole) && canManageStations()) {
                local.moduleLayout = hasCanonicalReadOnlyTop(local.moduleLayout)
                    ? normalizeModuleLayout(DEFAULT_MODULE_LAYOUT)
                    : normalizeModuleLayout(local.moduleLayout);
                local.moduleLayout.collapsed.controls = false;
                local.moduleLayout = resolveGridLayout(local.moduleLayout, "controls");
                storageSet();
            }
            const panelWasMissing = !panel;
            addPanel();
            const netTitle = panel.querySelector("[data-role='net-title'] a");
            if (netTitle)
                netTitle.textContent = latestNetTitle;
            applyRoleUi();
            applyModuleLayout();
            dockNativeChat();
            customizeNativeChat();
            if (panelWasMissing || remoteUiChanged)
                renderQueue();
            else
                syncViewer();
            if (focusedNote && editingNoteCall === focusedNote.call) {
                const input = panel.querySelector(`[data-note-input='${CSS.escape(focusedNote.call)}']`);
                input?.focus();
                input?.setSelectionRange(focusedNote.start, focusedNote.end);
            }
            startSync();
        }
        catch (error) {
            if (panel)
                setStatus(error.message || String(error), "error");
        }
    }
    const qrzStorageGet = () => new Promise(resolve => browserStorage.get([qrzUserKey, qrzAuthKey], resolve));
    const relayStorageGet = () => new Promise(resolve => browserStorage.get([relayTokenKey], resolve));
    window.addEventListener("resize", handleWindowResize);
    window.addEventListener("keydown", handleActionHotkey, true);
    Promise.all([qrzStorageGet(), relayStorageGet(), storageGet()]).then(async ([qrzData, relayData, saved]) => {
        const savedAuth = qrzData[qrzAuthKey] || {};
        qrzUsername = normalizeCall(savedAuth.username || qrzData[qrzUserKey] || selfCall());
        qrzPassword = typeof savedAuth.password === "string" ? savedAuth.password : "";
        relayToken = globalThis.NCOHelperRelay?.validToken(relayData[relayTokenKey]) ? relayData[relayTokenKey] : "";
        qrzSessionKey = "";
        sharedProfiles = Object.fromEntries(Object.entries(saved.sharedProfiles || {}).flatMap(([rawCall, value]) => {
            const call = normalizeCall(rawCall);
            if (!/^[A-Z0-9/-]{2,15}$/.test(call) || !value || typeof value !== "object")
                return [];
            const migrated = { updatedAt: Number(value.updatedAt) || 0 };
            for (const field of PROFILE_FIELDS) {
                if (!Object.prototype.hasOwnProperty.call(value, `${field}Override`) && !value[`${field}AuthorityRole`])
                    continue;
                const enabled = Boolean(value[`${field}Override`]);
                migrated[field] = enabled
                    ? (field === "name" ? formatName(value[field]) : formatLocation(value[field]))
                    : "";
                migrated[`${field}Override`] = enabled;
                migrated[`${field}Origin`] = value[`${field}Origin`] === "lookup" ? "lookup" : "manual";
                migrated[`${field}AuthorityRole`] = ["netcontrol", "netlogger"].includes(value[`${field}AuthorityRole`])
                    ? value[`${field}AuthorityRole`] : "netlogger";
                migrated[`${field}UpdatedAt`] = Number(value[`${field}UpdatedAt`] || value.updatedAt) || 0;
                migrated[`${field}MessageId`] = String(value[`${field}MessageId`] || "legacy");
                migrated[`${field}Cleared`] = Boolean(value[`${field}Cleared`]);
            }
            return [[call, migrated]];
        }));
        local = {
            order: Array.isArray(saved.order) ? saved.order : [],
            checkedOutOrder: Array.isArray(saved.checkedOutOrder) ? saved.checkedOutOrder : [],
            lurkerOrder: Array.isArray(saved.lurkerOrder) ? saved.lurkerOrder : [],
            ioCalls: Array.isArray(saved.ioCalls) ? saved.ioCalls.map(normalizeCall) : [],
            recheckCalls: Array.isArray(saved.recheckCalls) ? saved.recheckCalls.map(normalizeCall) : [],
            details: saved.details && typeof saved.details === "object" ? saved.details : {},
            hiddenCalls: Array.isArray(saved.hiddenCalls) ? saved.hiddenCalls.map(normalizeCall) : [],
            paneSizes: saved.paneSizes && typeof saved.paneSizes === "object" ? saved.paneSizes : {},
            collapsedSections: saved.collapsedSections && typeof saved.collapsedSections === "object" ? saved.collapsedSections : {},
            moduleLayout: saved.moduleLayout && typeof saved.moduleLayout === "object" ? saved.moduleLayout : {},
            helperFontPreset: normalizeFontPreset(saved.helperFontPreset),
            chatFontPreset: normalizeFontPreset(saved.chatFontPreset),
            helpFontPreset: normalizeFontPreset(saved.helpFontPreset),
            manualOrder: Boolean(saved.manualOrder),
            sharedUpdatedAt: Number(saved.sharedUpdatedAt) || 0
        };
        local.moduleLayout = normalizeModuleLayout(local.moduleLayout);
        storeSharedProfiles();
        storageSet();
        local.hiddenCalls.forEach(call => hiddenCalls.add(call));
        await refresh();
        window.setInterval(refresh, POLL_MS);
    });
    window.addEventListener("beforeunload", () => {
        if (statusTimer)
            clearTimeout(statusTimer);
        if (loggerStateSaveTimer)
            clearTimeout(loggerStateSaveTimer);
        window.removeEventListener("resize", handleWindowResize);
        window.removeEventListener("keydown", handleActionHotkey, true);
        stopSync();
        restoreNativeChat();
        unlockBackgroundScroll();
    });
})();
export {};
//# sourceMappingURL=ncoLogger.js.map