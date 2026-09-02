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
const LOGGER_ASSET_VERSION = new URL(import.meta.url).searchParams.get('v') || 'unversioned';
await import(`./ncoLoggerChatBridge.js?v=${LOGGER_ASSET_VERSION}`);
await import(`./ncoLogger.js?v=${LOGGER_ASSET_VERSION}`);
//# sourceMappingURL=main.js.map