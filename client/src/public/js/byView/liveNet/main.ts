/* hamlive-oss — MIT License. See LICENSE. */

import { EndPointClient, getNpid, initAndLogError } from '#@client/lib/clientUtils.js';
import { LiveNetReactiveStore } from '#@client/lib/stores.js';
import { Presence } from '#@client/lib/presence.js';
import { ChatWidget } from '#@client/lib/chat.js';

const NPID = getNpid();
const { client } = new Presence(NPID);
const liveNetEndpoint = new EndPointClient('/api/data/livenets')
    .id(NPID.toString())
    .p('capturePresence', 'false');
const liveNetStore = new LiveNetReactiveStore(liveNetEndpoint, true);

void initAndLogError(() => liveNetStore.init(client));

const { level } = await client;
void initAndLogError(() => ChatWidget.init(liveNetStore, level));

// The logger is now first-party page code. The bridge only keeps slash commands
// out of group chat; all station mutations go to authenticated application APIs.
const LOGGER_ASSET_VERSION = '20260829-nco5';
await import(`./ncoLoggerChatBridge.js?v=${LOGGER_ASSET_VERSION}`);
await import(`./ncoLogger.js?v=${LOGGER_ASSET_VERSION}`);
