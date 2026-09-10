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
const myAccount = read('server/dist/views/myAccount.ejs');
const dashboardClient = read('client/dist/public/js/byView/dashboard/main.js');
const favoriteWidgets = read('client/src/public/js/lib/widgets.ts');
const legacyFavoriteClient = read('client/dist/public/js/lib/old__clientUtils.js');
const waitingPage = read('server/dist/views/netNotRunning.ejs');
const liveNetController = read('server/dist/controllers/liveNetController.js');
const landingCss = read('client/dist/public/css/app-shell.css');
const loggerLightCss = read('client/dist/public/css/nco-logger-light.css');
const appearanceClient = read('client/dist/public/js/lib/appearance.js');
const themeControlClient = read('client/src/public/js/lib/themeControl.js');
const mobileNavigationClient = read('client/src/public/js/lib/mobileNavigation.js');
const loggerClient = read('client/src/public/js/byView/liveNet/ncoLogger.js');
const heroTimeClient = read('client/dist/public/js/lib/heroTime.js');
const head = read('server/dist/views/partials/head.ejs');
const serverUtils = read('server/dist/lib/serverUtils.js');
const dayHeroPath = path.join(root, 'client/dist/public/img/nco-logger-hero-phoenix-day-final.png');
const nightHeroPath = path.join(root, 'client/dist/public/img/nco-logger-hero-phoenix-night-final.png');
const lightLogoPath = path.join(root, 'client/dist/public/img/NCO_Logger_Logo_Light_Mode.png');
const compactLightLogoPath = path.join(root, 'client/dist/public/img/NCO_Logger_Logo_compact_Light_Mode.png');
const { getCheckInCounts } = require('../server/dist/controllers/liveNetController');

test('landing hero uses the approved copy, actions, logo identity, and tower artwork', () => {
    assert.match(dashboard, /Run a net\./);
    assert.match(dashboard, /Find a net\./);
    assert.match(dashboard, /Join in\./);
    assert.match(dashboard, /A modern home for amateur radio nets — schedule, discover, follow, check in, and participate from anywhere\./);
    assert.match(dashboard, /START A NET/);
    assert.match(dashboard, /VIEW SCHEDULE/);
    assert.match(dashboard, /href="#net-schedule"/);
    assert.match(landingCss, /\.landing-page \.landing-hero\s*\{[\s\S]*background-image:\s*var\(--app-dashboard-hero-image\)/);
    assert.match(navbar, /src="\/img\/NCO_Logger_Logo_navbar\.png"/);
    assert.match(navbar, /src="\/img\/NCO_Logger_Logo_Light_Mode\.png"/);
    assert.match(navbar, /alt="NCO Logger by WVARC"/);
    assert.match(footer, /NCO_Logger_Logo\.png[\s\S]*NCO_Logger_Logo_Light_Mode\.png/);
    assert.match(loggerClient, /NCO_Logger_Logo_compact\.png[\s\S]*NCO_Logger_Logo_compact_Light_Mode\.png/);
    assert.ok(fs.statSync(lightLogoPath).size > 100000);
    assert.ok(fs.statSync(compactLightLogoPath).size > 100000);
    assert.ok(fs.statSync(dayHeroPath).size > 100000);
    assert.ok(fs.statSync(dayHeroPath).size < 5000000);
    assert.ok(fs.statSync(nightHeroPath).size > 100000);
    assert.ok(fs.statSync(nightHeroPath).size < 5000000);
    assert.match(landingCss, /\.landing-page \.landing-title-find\s*\{\s*color:\s*var\(--app-text\)/s);
    assert.match(landingCss, /\.landing-page \.landing-title-join\s*\{\s*color:\s*var\(--app-cyan\)/s);
});

test('landing hero follows local daytime boundaries independently of Appearance', () => {
    assert.match(
        landingCss,
        /:root\[data-hero-period='day'\]\s*\{\s*--app-dashboard-hero-image:\s*url\('\/img\/nco-logger-hero-phoenix-day-final\.png'\);\s*\}/
    );
    assert.match(
        landingCss,
        /:root\[data-hero-period='night'\]\s*\{\s*--app-dashboard-hero-image:\s*url\('\/img\/nco-logger-hero-phoenix-night-final\.png'\);\s*\}/
    );
    assert.match(heroTimeClient, /const DAY_START_HOUR = 6;/);
    assert.match(heroTimeClient, /const NIGHT_START_HOUR = 18;/);
    assert.match(heroTimeClient, /hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR \? 'day' : 'night'/);
    assert.match(heroTimeClient, /setTimeout\(applyPeriod, millisecondsUntilNextBoundary\(date\)\)/);
    assert.match(heroTimeClient, /visibilitychange/);
    assert.match(dashboard, /Resolve the local day\/night hero before its stylesheet can paint[\s\S]*heroTime\.js\?v=<%= server\.appAssetVersion %>/);
    assert.match(serverUtils, /'css\/app-shell\.css'/);
    assert.match(serverUtils, /nodeEnv === 'development' \? createAppAssetVersion\(\) : appAssetVersion/);
});

test('landing hero defaults to right-aligned, undistorted artwork', () => {
    assert.match(
        landingCss,
        /\.landing-page \.landing-hero\s*\{[^}]*background-position:\s*right center;[^}]*background-repeat:\s*no-repeat;[^}]*background-size:\s*contain;/
    );
});

test('daytime and nighttime heroes share identical composition rules at every breakpoint', () => {
    assert.match(
        landingCss,
        /@media \(max-width: 991\.98px\)[\s\S]*\.landing-page \.landing-hero\s*\{\s*background-position:\s*center;\s*\}/
    );
    assert.match(
        landingCss,
        /@media \(min-width: 992px\)[\s\S]*\.landing-page \.landing-hero\s*\{[^}]*min-height:\s*0;[^}]*aspect-ratio:\s*2560 \/ 859;[^}]*background-position:\s*center center;[^}]*background-size:\s*100% auto;[^}]*\}/
    );

    const periodCompositionRules = [...landingCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector, declarations]) =>
        selector.includes('data-hero-period') &&
        selector.includes('.landing-hero') &&
        /background-(?:position|size)/.test(declarations)
    );

    assert.equal(periodCompositionRules.length, 0);
});

test('Appearance remains responsible only for the application color theme', () => {
    assert.match(appearanceClient, /value === 'system' \? \(systemDarkMode\.matches \? 'dark' : 'light'\) : value/);
    assert.match(appearanceClient, /if \(appearance === 'system'\)\s+applyAppearance\(appearance\)/);
    assert.match(appearanceClient, /systemDarkMode\.addEventListener\('change', handleSystemChange\)/);
    assert.match(head, /Blocking by design:[\s\S]*<script src="\/js\/lib\/appearance\.js\?v=<%= server\.appAssetVersion %>"><\/script>/);
});

test('the shared navigation owns the single theme preference control', () => {
    assert.match(navbar, /type="checkbox" data-appearance-control role="switch"/);
    assert.doesNotMatch(navbar, /<select[^>]*data-appearance-control|<option value="system">/);
    assert.ok(navbar.indexOf('data-appearance-control') > navbar.indexOf('Log out'));
    assert.match(navbar, /themeControl\.js\?v=<%= server\.appAssetVersion %>/);
    assert.doesNotMatch(myAccount, /name="appearance"|id="appearance-settings"/);
    assert.match(themeControlClient, /window\.ncoLoggerAppearance/);
    assert.match(themeControlClient, /appearanceManager\.setAppearance\(control\.checked \? 'dark' : 'light'\)/);
    assert.match(themeControlClient, /appearance === 'system' \? ' from system preference' : ''/);
    assert.match(themeControlClient, /control\.setAttribute\('aria-label', `\$\{current\} theme active\$\{source\}\. Switch to \$\{target\} theme\.`\)/);
    assert.match(themeControlClient, /ncoLogger:appearancechange/);
    assert.doesNotMatch(navbar, /data-appearance-label|class="app-theme-state"/);
    assert.match(landingCss, /\.app-theme-logo-light\s*\{\s*display:\s*none !important/);
    assert.match(landingCss, /:root\[data-theme='light'\] \.app-theme-logo-dark\s*\{\s*display:\s*none !important/);
    assert.match(landingCss, /:root\[data-theme='light'\] \.app-theme-logo-light\s*\{\s*display:\s*block !important/);
    assert.match(landingCss, /:root\[data-theme='light'\] body\.app-page:not\(\.nco-logger-page\) \.app-navbar\s*\{[^}]*background:\s*rgba\(247, 250, 251, \.97\) !important/s);
    assert.match(landingCss, /:root\[data-theme='light'\] body\.app-page:not\(\.nco-logger-page\) \.app-footer\s*\{[^}]*background:\s*#e4edef !important/s);
});

test('collapsed site navigation is an accessible viewport drawer without changing desktop navigation', () => {
    assert.match(navbar, /data-mobile-nav-trigger aria-controls="navmenu" aria-expanded="false"/);
    assert.match(navbar, /class="navbar-collapse app-mobile-drawer" id="navmenu" data-mobile-nav-drawer/);
    assert.match(navbar, /data-mobile-nav-close aria-label="Close navigation menu"/);
    assert.match(navbar, /data-mobile-nav-backdrop hidden aria-hidden="true"/);
    assert.match(navbar, /mobileNavigation\.js\?v=<%= server\.appAssetVersion %>/);
    assert.doesNotMatch(navbar, /data-bs-toggle="collapse"|data-bs-target="#navmenu"/);
    assert.ok(navbar.indexOf('app-theme-item') > navbar.indexOf('Log out'));
    assert.match(navbar, /if \(user\.isLoggedIn\)[\s\S]*href="\/views\/favorites"[\s\S]*href="\/views\/myaccount"[\s\S]*Log out[\s\S]*else[\s\S]*href="\/views\/login"/);

    assert.match(landingCss, /@media \(max-width: 991\.98px\)[\s\S]*\.app-navbar \.app-mobile-drawer\s*\{[^}]*position:\s*fixed[^}]*width:\s*min\(84vw, 20rem\)[^}]*height:\s*100dvh[^}]*transform:\s*translateX\(100%\)/s);
    assert.match(landingCss, /\.app-mobile-nav-backdrop\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*1051/s);
    assert.match(landingCss, /\.app-navbar \.app-mobile-drawer\s*\{[^}]*z-index:\s*1052/s);
    assert.match(landingCss, /body\.app-mobile-nav-open\s*\{[^}]*position:\s*fixed[^}]*overflow:\s*hidden/s);
    assert.match(landingCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.app-navbar \.app-mobile-drawer,[\s\S]*transition:\s*none/s);

    assert.match(mobileNavigationClient, /trigger\.setAttribute\('aria-expanded', 'true'\)/);
    assert.match(mobileNavigationClient, /trigger\.setAttribute\('aria-expanded', 'false'\)/);
    assert.match(mobileNavigationClient, /backdrop\.addEventListener\('click', \(\) => closeDrawer\(\)\)/);
    assert.match(mobileNavigationClient, /closeButton\.addEventListener\('click', \(\) => closeDrawer\(\)\)/);
    assert.match(mobileNavigationClient, /event\.key === 'Escape'/);
    assert.match(mobileNavigationClient, /querySelectorAll\('\.nav-link'\).*closeDrawer\(\{ restoreFocus: false \}\)/);
    assert.match(mobileNavigationClient, /trigger\.focus\(\{ preventScroll: true \}\)/);
    assert.match(mobileNavigationClient, /document\.body\.style\.top = `-\$\{lockedScrollY\}px`/);
    assert.match(mobileNavigationClient, /window\.scrollTo\(0, lockedScrollY\)/);
    assert.match(mobileNavigationClient, /window\.matchMedia\('\(min-width: 992px\)'\)/);
    assert.match(mobileNavigationClient, /drawer\.setAttribute\('inert', ''\)/);
    assert.match(mobileNavigationClient, /drawer\.setAttribute\('role', 'dialog'\)/);
    assert.match(mobileNavigationClient, /drawer\.setAttribute\('aria-modal', 'true'\)/);
});

test('phone dashboard hero reserves a readable copy region and exposes the final artwork', () => {
    assert.match(landingCss, /@media \(max-width: 767\.98px\)[\s\S]*--landing-mobile-art-height:\s*clamp\(15\.5rem, 72vw, 17\.5rem\)[^}]*padding-bottom:\s*calc\(var\(--landing-mobile-art-height\) \+ \.75rem\)[^}]*background-position:\s*right bottom[^}]*background-size:\s*auto var\(--landing-mobile-art-height\)/s);
    assert.match(landingCss, /@media \(max-width: 991\.98px\) and \(orientation: landscape\) and \(max-height: 575px\)[\s\S]*background-position:\s*right bottom[^}]*background-size:\s*auto min\(100%, 25rem\)/s);
});

test('desktop navigation and complete logo presentation remain compact and single-line', () => {
    assert.match(landingCss, /\.app-navbar \.nav-link\s*\{[^}]*white-space:\s*nowrap/s);
    assert.match(landingCss, /@media \(min-width: 992px\)[\s\S]*\.landing-page \.landing-navbar \.navbar-nav\s*\{[^}]*flex-wrap:\s*nowrap/s);
    assert.match(landingCss, /\.app-brand-logo\s*\{[^}]*height:\s*auto[^}]*max-height:\s*4\.75rem/s);
    assert.match(landingCss, /\.landing-footer-brand > a,[\s\S]*\.landing-footer-brand img\s*\{[^}]*width:\s*min\(17\.5rem, 100%\)[^}]*height:\s*auto/s);
    assert.match(landingCss, /:root\[data-theme='light'\] \.app-navbar \.app-theme-logo-light\s*\{[^}]*transform:\s*translate\(0\.04923%, 4\.87357%\) scale\(1\.06923\)[^}]*transform-origin:\s*center center/s);
    assert.match(landingCss, /:root\[data-theme='light'\] \.app-navbar \.landing-brand-logo\.app-theme-logo-light\s*\{[^}]*transform:\s*translate\(0\.04923%, 4\.8228%\) scale\(1\.06923\)/s);
    assert.match(landingCss, /:root\[data-theme='light'\] \.landing-footer \.app-theme-logo-light\s*\{[^}]*transform:\s*translate\(0\.41456%, 1\.05528%\) scale\(1\.00425\)[^}]*transform-origin:\s*center center/s);
    assert.match(landingCss, /@media \(max-width: 991\.98px\)[\s\S]*\.app-theme-toggle\s*\{[^}]*width:\s*fit-content[^}]*min-height:\s*2\.75rem[^}]*gap:\s*\.5rem/s);
});

test('Logger light appearance keeps intentional chrome and compact-control contrast', () => {
    assert.match(loggerLightCss, /\.nch-tray-title\s*\{[^}]*color:\s*#0e202a[^}]*background:\s*#f4f8f9/s);
    assert.match(loggerLightCss, /#netcontrol-ncs-helper > header\s*\{[^}]*color:\s*#f4f8f9[^}]*background:\s*linear-gradient\(135deg, #183844, #102934\)/s);
    assert.match(loggerLightCss, /\.chat-message-actions-toggle\s*\{[^}]*color:\s*#174e5d[^}]*background:\s*#f2f7f9/s);
    assert.match(loggerLightCss, /\.chat-icon-control\s*\{[^}]*color:\s*#174e5d !important[^}]*background:\s*#f2f7f9 !important/s);
    assert.match(loggerLightCss, /\.nch-fixed-status-bar\s*\{[^}]*color:\s*#eef9fb[^}]*background:\s*#071722/s);
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
    assert.match(dashboardClient, /kind === 'upcoming' \? 3 : 4/);
    assert.match(dashboardClient, /formatConnectionLines\(occurrence\)\.join\(' · '\)/);
    assert.match(dashboardClient, /details\.title = connection/);
    assert.match(dashboardClient, /liveNet\.permanent/);
    assert.match(dashboardClient, /favorites\.interval\(i\)/);
    assert.match(dashboardClient, /refresh:\s*30000 \/ serverInfo\.requestRateFactor/);
    assert.match(dashboardClient, /`\$\{activeNets\.length\}\\u00A0LIVE NOW`/);
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
    assert.match(footer, /href="\/views\/contact"[^>]*>[\s\S]*Contact NCO Logger/);
    assert.doesNotMatch(footer, /logger@westvalleyarc\.com/);
    assert.match(footer, /bi bi-envelope/);
    assert.match(footer, /\/views\/privacypolicy/);
    assert.match(footer, /\/views\/termsofuse/);
    assert.match(footer, /\/views\/cookiepolicy/);
    assert.match(footer, /href="https:\/\/westvalleyarc\.com\/about-wvarc\/">About WVARC<\/a>/);
    assert.match(footer, /href="https:\/\/westvalleyarc\.com\/">Club Website<\/a>/);
    assert.match(footer, /href="https:\/\/westvalleyarc\.com\/membership\/">Join WVARC<\/a>/);
});

test('landing layout includes responsive hero, feature, net, and footer grids', () => {
    assert.match(landingCss, /\.landing-hero-grid\s*\{/);
    assert.match(landingCss, /\.landing-feature-grid\s*\{/);
    assert.match(landingCss, /\.landing-net-grid\s*\{/);
    assert.match(landingCss, /\.landing-footer-grid\s*\{/);
    assert.match(landingCss, /@media \(max-width: 991\.98px\)[\s\S]*\.landing-net-grid/);
    assert.match(landingCss, /@media \(max-width: 767\.98px\)[\s\S]*\.landing-hero-grid/);
    assert.match(landingCss, /@media \(max-width: 575\.98px\)[\s\S]*\.landing-page \.landing-footer \.container\s*\{[^}]*max-width:\s*100%[^}]*\}/s);
    assert.match(landingCss, /@media \(max-width: 575\.98px\)[\s\S]*\.landing-footer-grid/);
    assert.match(landingCss, /@media \(max-width: 575\.98px\)[\s\S]*\.landing-footer-grid > \*,[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/);
    assert.match(landingCss, /@media \(max-width: 575\.98px\)[\s\S]*\.landing-footer-bottom\s*\{[^}]*flex-direction:\s*column[^}]*\}/s);
    assert.match(landingCss, /@media \(max-width: 575\.98px\)[\s\S]*\.landing-footer-bottom nav\s*\{[^}]*flex-wrap:\s*wrap[^}]*max-width:\s*100%[^}]*\}/s);
    assert.match(landingCss, /\.landing-feature-card\s*\{[\s\S]*border-right:/);
    assert.match(landingCss, /\.landing-page \.landing-hero::before/);
    assert.match(landingCss, /\.landing-page \.scheduled-net-connections dd\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;/);
    assert.match(landingCss, /\.landing-page \.scheduled-net-connections[\s\S]*white-space:\s*nowrap;/);
    assert.match(landingCss, /\.landing-page \.scheduled-net-card:hover\s*\{[\s\S]*outline:\s*0;/);
    assert.match(landingCss, /\.landing-page \.scheduled-net-card:focus-visible\s*\{[\s\S]*outline:\s*2px solid/);
});
