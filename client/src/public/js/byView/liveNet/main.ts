/* hamlive-oss — MIT License. See LICENSE. */

import { EndPointClient, getNpid, initAndLogError } from '#@client/lib/clientUtils.js';
import { LoggerSessionReactiveStore } from '#@client/lib/loggerSessionStore.js';
import { Presence } from '#@client/lib/presence.js';
import { ChatWidget } from '#@client/lib/chat.js';

const NPID = getNpid();
const { client } = new Presence(NPID);
const liveNetEndpoint = new EndPointClient('/api/data/livenets')
    .id(NPID.toString())
    .p('capturePresence', 'false');
const liveNetStore = new LoggerSessionReactiveStore(liveNetEndpoint, NPID.toString());

void initAndLogError(() => liveNetStore.init(client));

const { level } = await client;
void initAndLogError(() => ChatWidget.init(liveNetStore, level));

// The logger is now first-party page code. The bridge only keeps slash commands
// out of group chat; all station mutations go to authenticated application APIs.
const LOGGER_ASSET_VERSION = new URL(import.meta.url).searchParams.get('v') || 'unversioned';
await liveNetStore.loggerReady;
await import(`./ncoLoggerChatBridge.js?v=${LOGGER_ASSET_VERSION}`);
await import(`./ncoLogger.js?v=${LOGGER_ASSET_VERSION}`);
