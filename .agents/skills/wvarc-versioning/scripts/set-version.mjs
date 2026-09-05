#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../../..');
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta)\.([1-9]\d*))?$/;

const paths = {
    packageJson: resolve(repoRoot, 'package.json'),
    packageLock: resolve(repoRoot, 'package-lock.json'),
    loggerSource: resolve(repoRoot, 'client/src/public/js/byView/liveNet/ncoLogger.js'),
    loggerDist: resolve(repoRoot, 'client/dist/public/js/byView/liveNet/ncoLogger.js'),
    mainSource: resolve(repoRoot, 'client/src/public/js/byView/liveNet/main.ts'),
    mainDist: resolve(repoRoot, 'client/dist/public/js/byView/liveNet/main.js'),
    liveNetView: resolve(repoRoot, 'server/dist/views/liveNet.ejs')
};

function fail(message) {
    console.error(`Versioning error: ${message}`);
    process.exitCode = 1;
}

function assertVersion(value, label) {
    if (!semverPattern.test(value)) throw new Error(`${label} is not an allowed WVARC version: ${value}`);
}

async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'));
}

async function replaceOne(path, pattern, replacement, label) {
    const input = await readFile(path, 'utf8');
    const matches = input.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)) || [];
    if (matches.length !== 1) throw new Error(`${label} marker count was ${matches.length}, expected 1`);
    await writeFile(path, input.replace(pattern, replacement));
}

async function assertOne(path, pattern, label) {
    const input = await readFile(path, 'utf8');
    const matches = input.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)) || [];
    if (matches.length !== 1) throw new Error(`${label} marker count was ${matches.length}, expected 1`);
}

async function assertDynamicAssetVersioning() {
    await assertOne(
        paths.mainSource,
        /const LOGGER_ASSET_VERSION = new URL\(import\.meta\.url\)\.searchParams\.get\('v'\) \|\| 'unversioned';/,
        'Logger asset fingerprint source'
    );
    await assertOne(
        paths.liveNetView,
        /\/css\/nco-logger\.css\?v=<%= server\.appAssetVersion %>/,
        'Logger stylesheet asset fingerprint'
    );
    await assertOne(
        paths.liveNetView,
        /\/js\/byView\/<%= VIEW %>\/main\.js\?v=<%= server\.appAssetVersion %>/,
        'Logger module asset fingerprint'
    );
}

function capturedVersion(input, pattern, label) {
    const match = input.match(pattern);
    if (!match?.[1]) throw new Error(`${label} marker is missing`);
    return match[1];
}

async function setVersion(version) {
    assertVersion(version, 'Requested version');

    const packageJson = await readJson(paths.packageJson);
    packageJson.version = version;
    await writeFile(paths.packageJson, `${JSON.stringify(packageJson, null, 4)}\n`);

    const packageLock = await readJson(paths.packageLock);
    packageLock.version = version;
    if (!packageLock.packages?.['']) throw new Error('package-lock root package metadata is missing');
    packageLock.packages[''].version = version;
    await writeFile(paths.packageLock, `${JSON.stringify(packageLock, null, 4)}\n`);

    await replaceOne(paths.loggerSource, /const VERSION = "[^"]+";/, `const VERSION = "${version}";`, 'Logger UI');
    await assertDynamicAssetVersioning();

    console.log(`Set WVARC application version to ${version}. Run npm run build, then run this script with --check.`);
}

async function checkVersion() {
    const packageJson = await readJson(paths.packageJson);
    const expected = String(packageJson.version || '');
    assertVersion(expected, 'package.json version');
    const packageLock = await readJson(paths.packageLock);
    const values = [
        ['package-lock.json version', String(packageLock.version || '')],
        ['package-lock root package version', String(packageLock.packages?.['']?.version || '')]
    ];

    const loggerSource = await readFile(paths.loggerSource, 'utf8');
    const loggerDist = await readFile(paths.loggerDist, 'utf8');
    await assertDynamicAssetVersioning();
    await assertOne(
        paths.mainDist,
        /const LOGGER_ASSET_VERSION = new URL\(import\.meta\.url\)\.searchParams\.get\('v'\) \|\| 'unversioned';/,
        'Logger generated asset fingerprint'
    );
    values.push(
        ['Logger source version', capturedVersion(loggerSource, /const VERSION = "([^"]+)";/, 'Logger source')],
        ['Logger generated version', capturedVersion(loggerDist, /const VERSION = "([^"]+)";/, 'Logger generated output')]
    );

    const drift = values.filter(([, value]) => value !== expected);
    if (drift.length) {
        drift.forEach(([label, value]) => fail(`${label} is ${value || '(empty)'}; expected ${expected}`));
        return;
    }
    console.log(`All WVARC application version markers match ${expected}.`);
}

const argument = process.argv[2];
try {
    if (argument === '--check') await checkVersion();
    else if (argument && process.argv.length === 3) await setVersion(argument);
    else throw new Error('Usage: set-version.mjs <MAJOR.MINOR.PATCH[-alpha.N|-beta.N]> | --check');
} catch (error) {
    fail(error instanceof Error ? error.message : String(error));
}
