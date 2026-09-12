const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const loadGrid = () => import(pathToFileURL(path.join(root, 'client/dist/public/js/lib/loggerGrid.js')).href);
const visible = ['lurkers', 'controls', 'checkedOut', 'chat', 'active'];
const tabletPortraitLayout = () => ({
    gridVersion: 4,
    items: {
        lurkers: { x: 0, y: 0, w: 5, h: 5 },
        controls: { x: 5, y: 0, w: 14, h: 5 },
        checkedOut: { x: 19, y: 0, w: 5, h: 5 },
        chat: { x: 0, y: 10, w: 10, h: 14 },
        active: { x: 10, y: 10, w: 14, h: 14 }
    },
    collapsed: {}
});

test('tablet portrait Chat and Active Log move upward to the first free row without relocating peers', async () => {
    const { findLoggerGridItemPosition } = await loadGrid();

    for (const itemId of ['chat', 'active']) {
        const layout = tabletPortraitLayout();
        const untouched = Object.fromEntries(visible.filter(id => id !== itemId).map(id => [id, layout.items[id]]));
        const moved = findLoggerGridItemPosition(
            layout, itemId, { x: layout.items[itemId].x, y: 0 },
            { x: layout.items[itemId].x, y: layout.items[itemId].y },
            { maxX: 24 - layout.items[itemId].w, maxY: 24 - layout.items[itemId].h }, visible
        );

        assert.ok(moved);
        assert.equal(moved.items[itemId].y, 5);
        assert.deepEqual(
            Object.fromEntries(visible.filter(id => id !== itemId).map(id => [id, moved.items[id]])),
            untouched
        );
        assert.deepEqual(layout, tabletPortraitLayout(), 'the starting layout is not mutated');
    }
});

test('tablet portrait Checked Out moves to an open top-row location without relocating peers', async () => {
    const { findLoggerGridItemPosition } = await loadGrid();
    const layout = tabletPortraitLayout();
    layout.items.lurkers = { x: 0, y: 5, w: 5, h: 5 };
    const before = structuredClone(layout.items);
    const moved = findLoggerGridItemPosition(
        layout, 'checkedOut', { x: 0, y: 0 }, { x: 19, y: 0 },
        { maxX: 19, maxY: 19 }, visible
    );

    assert.ok(moved);
    assert.deepEqual(moved.items.checkedOut, { x: 0, y: 0, w: 5, h: 5 });
    for (const id of visible.filter(id => id !== 'checkedOut')) assert.deepEqual(moved.items[id], before[id]);
});

test('tablet portrait Lurkers and Checked Out directly exchange positions without moving peers', async () => {
    const { findLoggerGridItemPosition } = await loadGrid();
    for (const [draggedId, targetId] of [['lurkers', 'checkedOut'], ['checkedOut', 'lurkers']]) {
        const layout = tabletPortraitLayout();
        const before = structuredClone(layout.items);
        const moved = findLoggerGridItemPosition(
            layout, draggedId,
            { x: before[targetId].x, y: before[targetId].y },
            { x: before[draggedId].x, y: before[draggedId].y },
            { maxX: 19, maxY: 19 }, visible
        );

        assert.ok(moved);
        assert.deepEqual(moved.items[draggedId], before[targetId]);
        assert.deepEqual(moved.items[targetId], before[draggedId]);
        for (const id of visible.filter(id => ![draggedId, targetId].includes(id))) {
            assert.deepEqual(moved.items[id], before[id]);
        }
        assert.deepEqual(layout.items, before, 'the starting layout is not mutated');
    }
});

test('compatible different-size modules directly swap left and right origins', async () => {
    const { findLoggerGridItemPosition } = await loadGrid();
    const layout = {
        items: {
            left: { x: 0, y: 0, w: 5, h: 4 },
            right: { x: 10, y: 0, w: 8, h: 4 },
            peer: { x: 18, y: 8, w: 6, h: 6 }
        }
    };
    const before = structuredClone(layout.items);
    const moved = findLoggerGridItemPosition(
        layout, 'left', { x: 10, y: 0 }, { x: 0, y: 0 },
        { maxX: 19, maxY: 20 }, ['left', 'right', 'peer']
    );

    assert.ok(moved);
    assert.deepEqual(moved.items.left, { x: 10, y: 0, w: 5, h: 4 });
    assert.deepEqual(moved.items.right, { x: 0, y: 0, w: 8, h: 4 });
    assert.deepEqual(moved.items.peer, before.peer, 'peers outside the swap pair stay immutable');
});

test('incompatible two-item swap falls back to the nearest legal dragged-item position', async () => {
    const { findLoggerGridItemPosition } = await loadGrid();
    const layout = tabletPortraitLayout();
    const before = structuredClone(layout.items);
    const moved = findLoggerGridItemPosition(
        layout, 'chat', { x: 10, y: 10 }, { x: 0, y: 10 },
        { maxX: 14, maxY: 10 }, visible
    );

    assert.ok(moved);
    assert.deepEqual(moved.items.chat, before.chat);
    for (const id of visible.filter(id => id !== 'chat')) assert.deepEqual(moved.items[id], before[id]);
});

test('occupied pointer paths search around peers for the requested legal destination', async () => {
    const { findLoggerGridItemPosition } = await loadGrid();
    const layout = tabletPortraitLayout();
    const before = structuredClone(layout.items);
    const moved = findLoggerGridItemPosition(
        layout, 'checkedOut', { x: 10, y: 0 }, { x: 19, y: 0 },
        { maxX: 19, maxY: 19 }, visible
    );

    assert.ok(moved);
    assert.deepEqual(moved.items.checkedOut, { x: 10, y: 5, w: 5, h: 5 });
    for (const id of visible.filter(id => id !== 'checkedOut')) assert.deepEqual(moved.items[id], before[id]);
});

test('a drop that is not substantially over a compatible peer does not swap it', async () => {
    const { findLoggerGridItemPosition } = await loadGrid();
    const layout = tabletPortraitLayout();
    const before = structuredClone(layout.items);
    const moved = findLoggerGridItemPosition(
        layout, 'checkedOut', { x: 4, y: 0 }, { x: 19, y: 0 },
        { maxX: 19, maxY: 19 }, visible
    );

    assert.ok(moved);
    assert.notDeepEqual(moved.items.checkedOut, before.lurkers);
    for (const id of visible.filter(id => id !== 'checkedOut')) assert.deepEqual(moved.items[id], before[id]);
});

test('move and resize candidates never repack unrelated modules', async () => {
    const { findLoggerGridItemPosition, replaceLoggerGridItem } = await loadGrid();
    const layout = tabletPortraitLayout();
    const before = structuredClone(layout.items);

    const blockedResize = replaceLoggerGridItem(
        layout, 'chat', { x: 0, y: 5, w: 20, h: 19 }, visible
    );
    assert.equal(blockedResize, null);
    assert.deepEqual(layout.items, before);

    const resized = replaceLoggerGridItem(
        layout, 'chat', { x: 0, y: 5, w: 10, h: 19 }, visible
    );
    assert.ok(resized);
    for (const id of visible.filter(id => id !== 'chat')) assert.deepEqual(resized.items[id], before[id]);

    const blockedMove = findLoggerGridItemPosition(
        layout, 'chat', { x: 10, y: 10 }, { x: 0, y: 10 },
        { maxX: 14, maxY: 10 }, visible
    );
    assert.ok(blockedMove);
    assert.deepEqual(blockedMove.items.chat, layout.items.chat);
    for (const id of visible.filter(id => id !== 'chat')) assert.deepEqual(blockedMove.items[id], before[id]);
});

test('diagonal drag finds the nearest legal destination without changing peer geometry', async () => {
    const { findLoggerGridItemPosition } = await loadGrid();
    const layout = tabletPortraitLayout();
    const before = structuredClone(layout.items);
    const moved = findLoggerGridItemPosition(
        layout, 'chat', { x: 2, y: 0 }, { x: 0, y: 10 },
        { maxX: 14, maxY: 10 }, visible
    );

    assert.ok(moved);
    assert.deepEqual(moved.items.chat, { x: 0, y: 5, w: 10, h: 14 });
    for (const id of visible.filter(id => id !== 'chat')) assert.deepEqual(moved.items[id], before[id]);
});

test('tablet portrait top-row modules share five-row grid geometry', async () => {
    const { loggerGridLayoutIsCollisionFree } = await loadGrid();
    const layout = tabletPortraitLayout();
    assert.equal(loggerGridLayoutIsCollisionFree(layout, visible), true);
    assert.deepEqual(
        ['lurkers', 'controls', 'checkedOut'].map(id => ({ y: layout.items[id].y, h: layout.items[id].h })),
        [{ y: 0, h: 5 }, { y: 0, h: 5 }, { y: 0, h: 5 }]
    );

    const source = fs.readFileSync(path.join(root, 'client/src/public/js/byView/liveNet/ncoLogger.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'client/dist/public/css/nco-logger.css'), 'utf8');
    assert.match(source, /tabletPortrait:[\s\S]*lurkers: \{ x: 0, y: 0, w: 5, h: 5 \}[\s\S]*controls: \{ x: 5, y: 0, w: 14, h: 5 \}[\s\S]*checkedOut: \{ x: 19, y: 0, w: 5, h: 5 \}/);
    assert.match(css, /\[data-layout-context="tabletPortrait"\] \.nch-controls-pane\s*\{[^}]*box-sizing:\s*border-box[^}]*height:\s*167px !important/s);
    assert.match(css, /--nch-tablet-top-track:\s*32\.6px/);
    assert.match(css, /grid-template-rows:\s*repeat\(5, var\(--nch-tablet-top-track\)\) repeat\(19, minmax\(0, 1fr\)\)/);
    assert.match(source, /\$\{moduleResizeZones\("controls"\)\}/);
});

test('live module event paths cannot invoke a whole-layout resolver or refresh migration', () => {
    const source = fs.readFileSync(path.join(root, 'client/src/public/js/byView/liveNet/ncoLogger.js'), 'utf8');
    const serverUtils = fs.readFileSync(path.join(root, 'server/dist/lib/serverUtils.js'), 'utf8');

    assert.doesNotMatch(source, /(?:try)?resolveGridLayout/);
    assert.doesNotMatch(source, /[A-Za-z]+NeedsCorrection/, 'refresh must not rewrite saved geometry by resemblance');
    assert.match(source, /function restoreModuleLayout\(source\)[\s\S]*gridLayoutIsCollisionFree\(normalized\)[\s\S]*return fallback/);
    assert.match(source, /function applyModuleLayout\(\)[\s\S]*local\.moduleLayout = normalizeModuleLayout\(local\.moduleLayout\)/);
    assert.match(source, /function setModuleCollapsed\(id, collapsed\)[\s\S]*gridLayoutIsCollisionFree\(layout\)[\s\S]*local\.moduleLayout = layout/);
    assert.match(serverUtils, /'js\/lib\/loggerGrid\.js'/, 'deployed asset version must include the drag helper');
});

test('the live tablet geometry places row five exactly below 167px Controls', () => {
    const gap = 1;
    const topTrack = (167 - (4 * gap)) / 5;
    const rowFiveStart = (5 * topTrack) + (5 * gap);
    assert.equal(topTrack, 32.6);
    assert.equal((5 * topTrack) + (4 * gap), 167);
    assert.equal(rowFiveStart, 168);
});
