/* hamlive-oss — MIT License. See LICENSE. */

import { EndPointClient, getNpid, initAndLogError } from '#@client/lib/clientUtils.js';
import { LiveNetReactiveStore, FavoritesReactiveStore } from '#@client/lib/stores.js';
import { Presence } from '#@client/lib/presence.js';
import { SystemNotificationManager } from '#@client/lib/systemNotifications.js';
import { ChatWidget } from '#@client/lib/chat.js';

import {
    StateList,
    StateCount,
    StatsTable,
    NetDetails,
    NetNotes,
    NetStartProgress,
    NetControlUsage,
    NetControlForm,
    NetControlPanel,
    NetControlButton,
    StationTable,
    StationRow,
    AvatarCell,
    CallSignCell,
    NameCell,
    SigReportCell,
    FavoriteInsert,
    AutoScrollInsert,
    HandInsert,
    ButtonBar,
    NetworkStatus
} from '#@client/lib/widgets.js';

const NPID = getNpid();

// Start Presence Polling and extract client-specific data
const { client } = new Presence(NPID);

// Assign endpoints to stores:
const livenetEp = new EndPointClient('/api/data/livenets').id(NPID.toString()).p('capturePresence', 'false');
const liveNetStore = new LiveNetReactiveStore(livenetEp, true);
const favoritesEp = new EndPointClient('/api/data/follow');
const favoritesStore = new FavoritesReactiveStore(favoritesEp, false);

//Initialize Static Widgets
void initAndLogError(() => StatsTable.init());
void initAndLogError(() => NetworkStatus.init());
void initAndLogError(() => AutoScrollInsert.init());

// Initialize Dynamic Widgets
void initAndLogError(() => StateList.init(liveNetStore));
void initAndLogError(() => StateCount.init(liveNetStore));
void initAndLogError(() => NetNotes.init(liveNetStore));
void initAndLogError(() => NetDetails.init(liveNetStore));
void initAndLogError(() => NetStartProgress.init(liveNetStore));
void initAndLogError(() => NetControlForm.init(liveNetStore));
void initAndLogError(() => NetControlPanel.init(liveNetStore));
void initAndLogError(() => NetControlButton.init(liveNetStore));
void initAndLogError(() => FavoriteInsert.init(favoritesStore));
void initAndLogError(() => HandInsert.init(liveNetStore));
void initAndLogError(() => ButtonBar.init(liveNetStore));

// Initialize cell components in parallel
await Promise.all([
    initAndLogError(() => AvatarCell.init(liveNetStore)),
    initAndLogError(() => CallSignCell.init(liveNetStore)),
    initAndLogError(() => NameCell.init(liveNetStore)),
    initAndLogError(() => SigReportCell.init(liveNetStore))
]);

// Initialize row and table components sequentially
await initAndLogError(() => StationRow.init(liveNetStore));
void initAndLogError(() => StationTable.init(liveNetStore));

// Check for system notifications
void initAndLogError(async () => {
    const notificationManager = new SystemNotificationManager();
    await notificationManager.checkAndDisplayNotifications();
});

// Initialize liveNetStore
void initAndLogError(() => liveNetStore.init(client));
void initAndLogError(() => favoritesStore.init());

// Initialize Widgets that depend on
// my role (from Interaction document) on the backend.
const { level } = await client;
void initAndLogError(() => NetControlUsage.init(liveNetStore));

// Initialize local MongoDB/SSE chat widget.
void initAndLogError(() => ChatWidget.init(liveNetStore, level));
