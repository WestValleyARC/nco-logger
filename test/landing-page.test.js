/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const dashboard = read('server/dist/views/dashboard.ejs');
const navbar = read('server/dist/views/partials/navbar.ejs');
const footer = read('server/dist/views/partials/footer.ejs');
const dashboardClient = read('client/dist/public/js/byView/dashboard/main.js');
const favoriteWidgets = read('client/src/public/js/lib/widgets.ts');
const legacyFavoriteClient = read('client/dist/public/js/lib/old__clientUtils.js');
const waitingPage = read('server/dist/views/netNotRunning.ejs');
const liveNetController = read('server/dist/controllers/liveNetController.js');
const landingCss = read('client/dist/public/css/app-shell.css');
const heroPath = path.join(root, 'client/dist/public/img/nco-logger-hero-night.png');
const { getCheckInCounts } = require('../server/dist/controllers/liveNetController');

test('landing hero uses the approved copy, actions, logo identity, and tower artwork', () => {
    assert.match(dashboard, /Run a net\./);
    assert.match(dashboard, /Find a net\./);
    assert.match(dashboard, /Join in\./);
    assert.match(dashboard, /A modern home for amateur radio nets — schedule, discover, follow, check in, and participate from anywhere\./);
    assert.match(dashboard, /START A NET/);
    assert.match(dashboard, /VIEW SCHEDULE/);
    assert.match(dashboard, /href="#net-schedule"/);
    assert.match(landingCss, /background-image:\s*url\('\/img\/nco-logger-hero-panorama\.png'\)/);
    assert.match(navbar, /src="\/img\/NCO_Logger_Logo_navbar\.png"/);
    assert.match(navbar, /alt="NCO Logger by WVARC"/);
    assert.ok(fs.statSync(heroPath).size > 100000);
    assert.ok(fs.statSync(heroPath).size < 2500000);
    assert.match(landingCss, /\.landing-page \.landing-title-find\s*\{\s*color:\s*var\(--app-text\)/s);
    assert.match(landingCss, /\.landing-page \.landing-title-join\s*\{\s*color:\s*var\(--app-cyan\)/s);
});

test('landing page contains exactly the four approved feature cards', () => {
    assert.equal((dashboard.match(/class="landing-feature-card"/g) || []).length, 4);
    assert.match(dashboard, /Accurate Logging[\s\S]*Real-time check-ins and participant tracking\./);
    assert.match(dashboard, /Net Control Tools[\s\S]*Everything NCOs need to run a smooth, organized net\./);
    assert.match(dashboard, /Chat &amp; Community[\s\S]*Communicate with other participants during a live net\./);
    assert.match(dashboard, /Free to Use[\s\S]*Available to the amateur radio community at no cost\./);
    assert.match(dashboard, /landing-feature-icon-no-cost/);
    assert.doesNotMatch(dashboard, /Chat\. Connect\. Participate\.|Always Improving|Works Anywhere|Reliable &amp; Secure|Secure &amp; Private/);
});

test('net dashboard preserves live data hooks and honest schedule empty states', () => {
    assert.match(dashboard, /id="dashItemsContainer"/);
    assert.match(dashboard, /id="netTemplate"/);
    assert.match(dashboard, /Live Nets/);
    assert.match(dashboard, /Today's Nets/);
    assert.match(dashboard, /Upcoming Nets/);
    assert.match(dashboard, /No scheduled nets today\./);
    assert.match(dashboard, /No upcoming nets in the next 7 days\./);
    assert.match(dashboardClient, /new HttpClient\('livenet', '\/api\/data\/livenets'\)/);
    assert.match(dashboardClient, /loadScheduledOccurrences/);
    assert.match(dashboardClient, /activeNets\.slice\(0, 4\)/);
    assert.match(dashboardClient, /liveNet\.permanent/);
    assert.match(dashboardClient, /favorites\.handler/);
    assert.match(dashboardClient, /refresh:\s*30000 \/ serverInfo\.requestRateFactor/);
});

test('live net listings expose authoritative grouped check-in counts and render singular or plural labels', async () => {
    let aggregationPipeline;
    const checkInCounts = await getCheckInCounts(
        [
            {
                _id: 'live-net-one',
                lookupTable: { A: { stationInteraction: 'interaction-true' }, B: { stationInteraction: 'interaction-false' } }
            },
            { _id: 'live-net-two', lookupTable: { C: { stationInteraction: 'interaction-null' } } }
        ],
        {
            aggregate: async pipeline => {
                aggregationPipeline = pipeline;
                return [{ _id: 'live-net-one', checkInCount: 1 }];
            }
        }
    );

    assert.deepEqual(aggregationPipeline[0], {
        $match: {
            _id: { $in: ['interaction-true', 'interaction-false', 'interaction-null'] },
            checkedState: true
        }
    });
    assert.deepEqual(aggregationPipeline[1], {
        $group: { _id: '$liveNet', checkInCount: { $sum: 1 } }
    });
    assert.equal(checkInCounts.get('live-net-one'), 1);
    assert.equal(checkInCounts.has('live-net-two'), false);
    assert.match(liveNetController, /StationInteractionModel\.aggregate\(\[/);
    assert.match(liveNetController, /checkInCountsByLiveNet\.get\(item\._id\.toString\(\)\)\s*\|\|\s*0/);
    assert.match(dashboard, /id="checkInCount"/);
    assert.match(dashboardClient, /`\$\{liveNet\.checkInCount\} Check-In\$\{liveNet\.checkInCount === 1 \? '' : 's'\}`/);
});

test('landing-only navigation and footer expose approved destinations without fake WVARC links', () => {
    assert.match(dashboard, /include\('\.\/partials\/navbar', \{ user: user, landing: true \}\)/);
    assert.match(navbar, />\s*Live Nets\s*</);
    assert.match(navbar, /href="\/views\/livenets"[^>]*>[\s\S]*?Live Nets/);
    assert.match(navbar, /if \(user\.isLoggedIn\)[\s\S]*?href="\/views\/favorites"/);
    assert.match(navbar, />\s*Start a Net\s*</);
    assert.match(navbar, />\s*Guide\s*</);
    assert.match(navbar, />\s*Sign in\s*</);
    assert.match(dashboard, /favicon bi bi-heart/);
    assert.doesNotMatch(dashboard, /favicon bi bi-star/);
    assert.match(waitingPage, /favicon[^>]*bi-heart|bi-heart[^>]*favicon/);
    assert.match(favoriteWidgets, /bi-heart-fill.*bi-heart/);
    assert.match(favoriteWidgets, /Remove from Favorites.*Add to Favorites/);
    assert.match(legacyFavoriteClient, /bi-heart-fill/);
    assert.doesNotMatch(legacyFavoriteClient, /bi-star-fill/);
    assert.match(footer, /mailto:logger@westvalleyarc\.com/);
    assert.match(footer, /bi bi-envelope/);
    assert.match(footer, /\/views\/privacypolicy/);
    assert.match(footer, /\/views\/termsofuse/);
    assert.match(footer, /\/views\/cookiepolicy/);
    for (const label of ['About WVARC', 'Club Website', 'Join WVARC']) {
        assert.match(footer, new RegExp(`<span[^>]+aria-disabled="true"[^>]*>${label}<\\/span>`));
    }
    assert.doesNotMatch(footer, /href="#">(?:About WVARC|Club Website|Join WVARC)/);
});

test('landing layout includes responsive hero, feature, net, and footer grids', () => {
    assert.match(landingCss, /\.landing-hero-grid\s*\{/);
    assert.match(landingCss, /\.landing-feature-grid\s*\{/);
    assert.match(landingCss, /\.landing-net-grid\s*\{/);
    assert.match(landingCss, /\.landing-footer-grid\s*\{/);
    assert.match(landingCss, /@media \(max-width: 991\.98px\)[\s\S]*\.landing-net-grid/);
    assert.match(landingCss, /@media \(max-width: 767\.98px\)[\s\S]*\.landing-hero-grid/);
    assert.match(landingCss, /@media \(max-width: 575\.98px\)[\s\S]*\.landing-footer-grid/);
    assert.match(landingCss, /\.landing-feature-card\s*\{[\s\S]*border-right:/);
    assert.match(landingCss, /\.landing-page \.landing-hero::before/);
});
