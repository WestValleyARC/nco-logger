import { EndPointClient, initAndLogError } from '#@client/lib/clientUtils.js';
import { ScheduledOpeningStore } from './store.js';
import { ScheduledOpeningWidget } from './widget.js';

const endpoint = document.querySelector<HTMLElement>('hl-scheduled-opening')?.dataset['endpoint'];
if (!endpoint) throw new Error('Missing scheduled net endpoint');
const store = new ScheduledOpeningStore(
    new EndPointClient(`${endpoint}/opening`),
    new EndPointClient(`${endpoint}/prepare`)
);
await initAndLogError(() => ScheduledOpeningWidget.init(store));
void initAndLogError(() => store.init());
