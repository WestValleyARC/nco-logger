/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('logger modules isolate their content and keep long side lists scrolling inside their grid cells', () => {
    const css = read('client/dist/public/css/nco-logger.css');

    const moduleRule = css.match(/#netcontrol-ncs-helper \.nch-module\s*\{[^}]*\}/)?.[0] || '';
    assert.match(moduleRule, /z-index:\s*1/);
    assert.match(moduleRule, /isolation:\s*isolate/);
    assert.match(moduleRule, /contain:\s*layout paint/);
    assert.match(moduleRule, /min-height:\s*0/);
    assert.match(moduleRule, /max-height:\s*100%/);
    assert.match(moduleRule, /overflow:\s*hidden/);

    const contentRule = css.match(/#netcontrol-ncs-helper \.nch-module-content\s*\{[^}]*\}/)?.[0] || '';
    assert.match(contentRule, /min-height:\s*0/);
    assert.match(contentRule, /max-height:\s*100%/);
    assert.match(contentRule, /flex:\s*1 1 0/);
    assert.match(contentRule, /overflow-x:\s*hidden/);
    assert.match(contentRule, /overflow-y:\s*auto/);

    const sideRowRule = css.match(/:is\(\.nch-checked-out-section, \.nch-lurkers-fixed\) > \.nch-module-content > \.nch-row\s*\{[^}]*\}/)?.[0] || '';
    assert.match(sideRowRule, /max-width:\s*100%/);
    assert.match(sideRowRule, /overflow:\s*hidden/);
});

test('only the module being moved or resized rises above sibling modules', () => {
    const css = read('client/dist/public/css/nco-logger.css');

    assert.match(
        css,
        /#netcontrol-ncs-helper \.nch-module:is\(\.nch-module-dragging, \.nch-module-resizing\)\s*\{\s*z-index:\s*2;\s*\}/
    );
});

test('desktop Station Controls spread their rows across the module and chat fills its module', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'client/dist/public/css/nco-logger.css'), 'utf8');

    assert.match(css, /\.nch-controls-pane \.nch-entry-controls\s*\{[^}]*align-content:\s*space-evenly;/s);
    assert.match(css, /\.nch-controls-pane \.nch-net-actions\s*\{[^}]*margin:\s*3px 0 0;/s);
    assert.match(css, /\.nch-chat-module-body\s*\{[^}]*gap:\s*0;[^}]*padding:\s*0;/s);
});
