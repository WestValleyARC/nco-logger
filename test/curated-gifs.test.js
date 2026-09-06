const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { validateCatalog } = require('../scripts/gifs/validate');
const {
    manifest, isCuratedGifId, getCuratedGif, curatedGifPath, listCuratedGifs
} = require('../server/dist/lib/curatedGifs');

test('curated GIF manifest contains exactly 500 unique, verified animated assets', () => {
    const { verified, errors } = validateCatalog();
    assert.deepEqual(errors, []);
    assert.equal(verified.length, 500);
    assert.equal(new Set(verified.map(gif => gif.sha256)).size, 500);
    assert.equal(verified.every(gif => ['G', 'G/PG'].includes(gif.content_rating)), true);
    assert.equal(verified.every(gif => /^(Public domain|CC0|CC BY)/.test(gif.license_name)), true);
    assert.equal(verified.filter(gif => gif.id.startsWith('openmoji-')).length, 50);
    assert.equal(verified.filter(gif => gif.source_type === 'public-domain-film').length, 430);
    assert.equal(verified.filter(gif => gif.source_type === 'licensed-footage').length, 20);
    assert.equal(manifest.default_category, 'reactions');
    assert.deepEqual(Object.fromEntries(Object.entries(Object.groupBy(verified, gif => gif.category))
        .map(([category, gifs]) => [category, gifs.length])), {
        reactions: 100,
        funny: 80,
        celebration: 50,
        'classic-film': 100,
        animals: 40,
        'hello-goodbye': 30,
        'thanks-support': 30,
        'radio-tech': 10,
        weather: 10,
        'animated-icons': 50
    });
});

test('curated GIF IDs resolve only catalog-owned files and expose attribution metadata', () => {
    const first = manifest.items[0];
    assert.equal(isCuratedGifId(first.id), true);
    assert.equal(getCuratedGif(first.id).id, first.id);
    assert.equal(curatedGifPath(first.id), path.resolve(__dirname, `../assets/gifs/files/${first.filename}`));
    for (const value of ['../../etc/passwd', `${first.id}/../secret`, '', null, 'OPENMOJI-1F60D']) {
        assert.equal(isCuratedGifId(value), false);
        assert.equal(curatedGifPath(value), null);
    }
    const catalog = listCuratedGifs();
    assert.equal(catalog.length, 500);
    assert.equal(catalog.every(gif => gif.creator && gif.licenseName && gif.licenseUrl && gif.sourceUrl
        && gif.attributionText && gif.thumbnailUrl.startsWith('/api/chat/gifs/')), true);
    assert.equal(catalog.some(gif => Object.hasOwn(gif, 'original_file_url')), false);
});

test('GIF browser category filtering, global search, and pagination are deterministic', async () => {
    const moduleUrl = pathToFileURL(path.resolve(__dirname, '../client/dist/public/js/lib/chatGif.js')).href;
    const { filterCuratedGifs } = await import(moduleUrl);
    const catalog = listCuratedGifs();
    const reactions = filterCuratedGifs(catalog, 'reactions', '', 0, 18);
    assert.equal(reactions.length, 18);
    assert.equal(reactions.every(gif => gif.category === 'reactions'), true);
    assert.deepEqual(
        filterCuratedGifs(catalog, 'reactions', '', 18, 18),
        catalog.filter(gif => gif.category === 'reactions').slice(18, 36)
    );
    const radio = filterCuratedGifs(catalog, 'reactions', 'radio', 0, 500);
    assert.ok(radio.length > 0);
    assert.ok(radio.some(gif => gif.category === 'radio-tech'));
    for (const term of ['laugh', 'yes', 'no', 'wow', 'confused', 'thinking', 'waiting', 'thanks',
        'welcome', 'hello', 'goodbye', 'congrats', 'dance', 'applause', 'radio', 'ham', 'weather']) {
        assert.ok(filterCuratedGifs(catalog, '', term, 0, 500).length > 0, `missing search term: ${term}`);
    }
    assert.equal(filterCuratedGifs(catalog, '', 'no-such-curated-gif-term', 0, 40).length, 0);
});

test('Docker runtime image definition includes the complete self-hosted GIF catalog', () => {
    const fs = require('node:fs');
    const dockerfile = fs.readFileSync(path.resolve(__dirname, '../Dockerfile'), 'utf8');
    assert.match(dockerfile, /COPY assets\/gifs \.\/assets\/gifs/);
    assert.match(dockerfile, /COPY --from=build --chown=node:node \/app\/assets\/gifs \.\/assets\/gifs/);
});
