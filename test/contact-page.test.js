const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('path');

const { conf } = require('../server/dist/lib/configLib');
const viewRoutes = require('../server/dist/routes/viewRoutes');

const pageData = {
    server: {
        appName: 'NCO Logger', appLogName: 'nco-logger', appAssetVersion: 'test', nodeEnv: 'test',
        logLevel: 'info', requestRateFactor: 1, httpClientTimeout: 1000, awayInMs: 1000,
        cmdHelpUrl: '', ts: ''
    },
    user: {
        isLoggedIn: false, newAccount: false, userId: '', callSign: '', displayName: '', chat: true
    }
};

test('contact page links to the configured support email instead of a form', async t => {
    const original = conf.support_email;
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../server/dist/views'));
    app.use((_req, res, next) => {
        res.locals.serverInfo = pageData;
        next();
    });
    app.use('/views', viewRoutes);
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    t.after(() => {
        if (original === undefined) delete conf.support_email;
        else conf.support_email = original;
        return new Promise(resolve => server.close(resolve));
    });

    await t.test('renders a mailto link for SUPPORT_EMAIL and no form', async () => {
        conf.support_email = 'help@example.com';
        const response = await fetch(`${baseUrl}/views/contact`);
        const html = await response.text();
        assert.equal(response.status, 200);
        assert.match(html, /Contact NCO Logger/);
        assert.match(html, /href="mailto:help@example\.com"/);
        assert.doesNotMatch(html, /<form/);
    });

    await t.test('escapes the configured address', async () => {
        conf.support_email = '"><script>alert(1)</script>@example.com';
        const html = await (await fetch(`${baseUrl}/views/contact`)).text();
        assert.doesNotMatch(html, /<script>alert/);
    });

    await t.test('shows a notice and no mailto link when unset', async () => {
        delete conf.support_email;
        const html = await (await fetch(`${baseUrl}/views/contact`)).text();
        assert.doesNotMatch(html, /mailto:/);
        assert.match(html, /not available/);
    });

    await t.test('POST is no longer accepted', async () => {
        const response = await fetch(`${baseUrl}/views/contact`, { method: 'POST' });
        assert.equal(response.status, 404);
    });
});
