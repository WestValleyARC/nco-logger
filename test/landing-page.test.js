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
const landingCss = read('client/dist/public/css/app-shell.css');
const tower = read('client/dist/public/img/nco-logger-tower.svg');

test('landing hero uses the approved copy, actions, logo identity, and tower artwork', () => {
    assert.match(dashboard, /Run a net\./);
    assert.match(dashboard, /Find a net\./);
    assert.match(dashboard, /Join in\./);
    assert.match(dashboard, /A modern home for amateur radio nets — schedule, discover, follow, check in, and participate from anywhere\./);
    assert.match(dashboard, /START A NET/);
    assert.match(dashboard, /VIEW SCHEDULE/);
    assert.match(dashboard, /href="#net-schedule"/);
    assert.match(dashboard, /src="\/img\/nco-logger-tower\.svg" alt=""/);
    assert.match(navbar, /src="\/img\/nco-logger-logo\.svg"/);
    assert.match(navbar, /BY WVARC/);
    assert.match(tower, /^<svg/);
    assert.doesNotMatch(tower, /<script|<image|animate/i);
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
    assert.match(dashboard, /No scheduled nets to display yet\./);
    assert.match(dashboard, /Upcoming net scheduling is coming soon\./);
    assert.match(dashboardClient, /new HttpClient\('livenet', '\/api\/data\/livenets'\)/);
    assert.match(dashboardClient, /liveNet\.countdownTimer/);
    assert.match(dashboardClient, /liveNet\.permanent/);
    assert.match(dashboardClient, /favorites\.handler/);
    assert.match(dashboardClient, /refresh:\s*30000 \/ serverInfo\.requestRateFactor/);
});

test('landing-only navigation and footer expose approved destinations without fake WVARC links', () => {
    assert.match(dashboard, /include\('\.\/partials\/navbar', \{ user: user, landing: true \}\)/);
    assert.match(navbar, />\s*Live Nets\s*</);
    assert.match(navbar, />\s*Schedule\s*</);
    assert.match(navbar, />\s*Guide\s*</);
    assert.match(navbar, /'Log In'/);
    assert.match(navbar, />Sign Up</);
    assert.match(footer, /mailto:logger@westvalleyarc\.com/);
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
});
