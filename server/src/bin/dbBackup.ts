#!/usr/bin/env node
// @ts-nocheck -- legacy CLI ported into the TypeScript-owned source tree; types will be tightened incrementally.

/*
 * dbBackup.js — backup, restore, migrate, verify hamlive MongoDB databases.
 *
 * Subcommands:
 *   backup   Dump a database to a local gzipped archive (optionally upload to S3).
 *   restore  Restore a gzipped archive into a database.
 *   migrate  Move data from one MongoDB URI to another (dump→restore or piped).
 *   verify   Compare doc counts and indexes between two URIs.
 *   list     List local + S3 archives.
 *   prune    Delete local archives older than N days.
 *
 * Dumps default to readPreference=primaryPreferred for single-node replica-set
 * compatibility; secondary reads are explicit opt-in. Production writes
 * require --confirm-production matching the URI-derived database name.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

const yargs = require('yargs');
const hideBin = require('yargs/helpers').hideBin;
const YAML = require('yaml');
const mongoose = require('mongoose');

const PROFILES_PATH = path.join(os.homedir(), '.hamlive-backup.yaml');
const DEFAULT_BACKUP_DIR = process.env.HAMLIVE_BACKUP_DIR || path.resolve(process.cwd(), 'backups');

// ---------- helpers ---------------------------------------------------------

function loadProfiles() {
    if (!fs.existsSync(PROFILES_PATH)) return {};
    try {
        return YAML.parse(fs.readFileSync(PROFILES_PATH, 'utf8')) || {};
    } catch (err) {
        console.error(`Failed to parse ${PROFILES_PATH}: ${err.message}`);
        process.exit(2);
    }
}

/** Resolve a URI from CLI options. Order: explicit --uri, --profile, --env. */
function resolveUri(opts, role /* 'source' | 'target' | 'uri' */) {
    const uriKey = role === 'uri' ? 'uri' : `${role}-uri`;
    const profileKey = role === 'uri' ? 'profile' : `${role}-profile`;
    const envKey = role === 'uri' ? 'env' : `${role}-env`;

    const environmentKey = role === 'uri' ? 'environment' : `${role}-environment`;
    if (opts[uriKey]) {
        const uri = opts[uriKey];
        return { uri, dbname: requireUriDbname(uri, `--${uriKey}`), environment: opts[environmentKey] || 'unclassified', origin: `--${uriKey}` };
    }

    if (opts[profileKey]) {
        const profiles = loadProfiles();
        const p = profiles[opts[profileKey]];
        if (!p?.uri) {
            console.error(`Profile "${opts[profileKey]}" not found in ${PROFILES_PATH}`);
            process.exit(2);
        }
        const dbname = requireUriDbname(p.uri, `profile:${opts[profileKey]}`);
        assertDatabaseIdentity(p.dbname, dbname, `profile "${opts[profileKey]}"`);
        return { uri: p.uri, dbname, environment: p.environment || 'unclassified', origin: `profile:${opts[profileKey]}` };
    }

    const env = opts[envKey] || (opts.production ? 'production' : 'development');
    if (!['production', 'development'].includes(env)) throw new Error(`Unsupported environment "${env}"`);
    const variable = env === 'production' ? 'MONGODB_PRODUCTION_URI' : 'MONGODB_DEVELOPMENT_URI';
    const uri = process.env[variable] || (env === 'production' ? process.env.MONGODB_URI : undefined);
    if (!uri) throw new Error(`No ${variable} configured for ${env}; refusing to fall back to another environment`);
    return { uri, dbname: requireUriDbname(uri, variable), environment: env, origin: `environment:${env}` };
}

function dbnameFromUri(uri) {
    // Mongo URIs may have comma-separated hosts (replica sets), which break
    // the URL parser. Extract the path between the host(s) and the query
    // string with a regex instead.
    const m = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@]*@)?[^/?]+\/([^?]+)/);
    if (!m || !m[1]) return null;
    try { return decodeURIComponent(m[1]); } catch { return null; }
}

function requireUriDbname(uri, origin) {
    const dbname = dbnameFromUri(uri);
    if (!dbname) throw new Error(`MongoDB URI from ${origin} must include a database name`);
    return dbname;
}

function assertDatabaseIdentity(configured, actual, origin) {
    if (configured && configured !== actual) {
        throw new Error(`Database identity conflict in ${origin}: configured name does not match URI database`);
    }
}

function stripDbnameFromUri(uri) {
    // When using --nsFrom/--nsTo, mongorestore interprets a dbname in the URI
    // path as an implicit --db filter, which conflicts with the namespace
    // remap. Strip it.
    return uri.replace(/^(mongodb(?:\+srv)?:\/\/(?:[^@]*@)?[^/?]+)\/[^?]+(\?|$)/, '$1/$2');
}

function hostsFromUri(uri) {
    const m = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@]*@)?([^/?]+)/);
    if (!m) return [];
    return m[1].split(',').map((h) => h.split(':')[0].toLowerCase()).sort();
}

function sameCluster(a, b) {
    const ha = hostsFromUri(a), hb = hostsFromUri(b);
    if (!ha.length || !hb.length) return false;
    return ha.join('|') === hb.join('|');
}

function withReadPref(uri, pref = 'primaryPreferred') {
    if (/[?&]readPreference=/i.test(uri)) return uri;
    return uri + (uri.includes('?') ? '&' : '?') + `readPreference=${pref}`;
}

function timestamp() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function humanSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function which(bin) {
    const r = spawnSync('which', [bin], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
}

function requireTools(tools) {
    const missing = tools.filter((t) => !which(t));
    if (missing.length) {
        console.error(`Missing required tool(s): ${missing.join(', ')}`);
        console.error('Install via the MongoDB Database Tools: https://www.mongodb.com/try/download/database-tools');
        process.exit(2);
    }
}

function runStreaming(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited with code ${code}`));
        });
    });
}

function runPiped(srcCmd, srcArgs, dstCmd, dstArgs) {
    return new Promise((resolve, reject) => {
        const src = spawn(srcCmd, srcArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
        const dst = spawn(dstCmd, dstArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
        src.stdout.pipe(dst.stdin);

        let srcCode = null, dstCode = null;
        const finish = () => {
            if (srcCode === null || dstCode === null) return;
            if (srcCode === 0 && dstCode === 0) resolve();
            else reject(new Error(`pipe failed (src=${srcCode}, dst=${dstCode})`));
        };
        src.on('error', reject);
        dst.on('error', reject);
        src.on('exit', (c) => { srcCode = c; finish(); });
        dst.on('exit', (c) => { dstCode = c; finish(); });
    });
}

async function confirmTargetWrite(target, opts) {
    if (target.environment === 'production') {
        if (opts['confirm-production'] === target.dbname) return;
        throw new Error(`Refusing production write to database "${target.dbname}"; pass --confirm-production "${target.dbname}"`);
    }
    if (target.environment === 'development') return;
    if (opts['confirm-target'] === target.dbname) return;
    throw new Error(`Refusing write to unclassified database "${target.dbname}"; classify it or pass --confirm-target "${target.dbname}"`);
}

async function promptYesNo(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(`${question} [y/N] `, (ans) => {
            rl.close();
            resolve(/^y(es)?$/i.test(ans.trim()));
        });
    });
}

// ---------- subcommand: backup ---------------------------------------------

async function cmdBackup(opts) {
    requireTools(['mongodump']);
    const { uri, dbname, origin } = resolveUri(opts, 'uri');
    const name = dbname || dbnameFromUri(uri) || 'unknown';
    const ts = timestamp();
    const dir = opts.dir || DEFAULT_BACKUP_DIR;
    ensureDir(dir);
    const file = path.join(dir, `${name}-${ts}.archive.gz`);
    const partial = `${file}.partial`;

    console.log(`Source     : ${origin} (db=${name})`);
    console.log(`Destination: ${file}`);

    const args = buildBackupArgs(uri, partial, opts);
    try {
        await runStreaming('mongodump', args);
        fs.chmodSync(partial, 0o600);
        fs.renameSync(partial, file);
    } catch (err) {
        if (fs.existsSync(partial)) fs.unlinkSync(partial);
        throw err;
    }

    const stat = fs.statSync(file);
    console.log(`Wrote ${humanSize(stat.size)} to ${file}`);

    if (opts['s3-bucket']) {
        requireTools(['aws']);
        const s3key = `${opts['s3-prefix'] || 'hamlive'}/${path.basename(file)}`;
        const s3uri = `s3://${opts['s3-bucket']}/${s3key}`;
        console.log(`Uploading to ${s3uri}`);
        await runStreaming('aws', ['s3', 'cp', file, s3uri, '--sse', 'AES256']);
    }
    console.log('backup: done');
}

// ---------- subcommand: restore --------------------------------------------

async function cmdRestore(opts) {
    requireTools(['mongorestore']);
    if (!opts.archive) {
        console.error('--archive <path> is required');
        process.exit(2);
    }
    if (!fs.existsSync(opts.archive)) {
        console.error(`Archive not found: ${opts.archive}`);
        process.exit(2);
    }
    const target = resolveUri(opts, 'uri');
    const { uri, dbname, origin } = target;
    const name = dbname || dbnameFromUri(uri) || 'unknown';

    console.log(`Archive : ${opts.archive}`);
    console.log(`Target  : ${origin} (db=${name})`);

    await confirmTargetWrite(target, opts);

    if (!opts.yes) {
        const ok = await promptYesNo(`Restore into ${name}? Existing data may be replaced.`);
        if (!ok) { console.log('aborted'); process.exit(1); }
    }

    const remapArgs = [];
    let willRemap = false;
    if (opts['ns-from'] && opts['ns-to']) {
        remapArgs.push(`--nsFrom=${opts['ns-from']}`, `--nsTo=${opts['ns-to']}`);
        willRemap = true;
    } else if (opts['archive-dbname'] && opts['archive-dbname'] !== name) {
        const from = `${opts['archive-dbname']}.*`;
        const to = `${name}.*`;
        console.log(`Namespace remap: ${from} → ${to}`);
        remapArgs.push(`--nsFrom=${from}`, `--nsTo=${to}`);
        willRemap = true;
    }

    // When remapping, strip the dbname from the URI: mongorestore otherwise
    // treats it as an implicit --db filter that conflicts with --nsFrom/--nsTo.
    const args = buildRestoreArgs(uri, opts.archive, remapArgs, opts);
    if (willRemap && opts['oplog-replay']) {
        console.log('Skipping --oplogReplay because namespaces differ.');
    }

    await runStreaming('mongorestore', args);
    console.log('restore: done');
}

// ---------- subcommand: migrate --------------------------------------------

async function cmdMigrate(opts) {
    requireTools(['mongodump', 'mongorestore']);
    const src = resolveUri(opts, 'source');
    const tgt = resolveUri(opts, 'target');
    const srcName = src.dbname || dbnameFromUri(src.uri) || 'unknown';
    const tgtName = tgt.dbname || dbnameFromUri(tgt.uri) || 'unknown';

    console.log(`Source : ${src.origin} (db=${srcName})`);
    console.log(`Target : ${tgt.origin} (db=${tgtName})`);
    console.log(`Mode   : ${opts.mode}`);
    if (sameCluster(src.uri, tgt.uri)) {
        console.log('Note   : source and target appear to be on the same cluster (same hosts).');
    }

    await confirmTargetWrite(tgt, opts);

    if (!opts['allow-non-empty']) {
        const counts = await collectionCounts(tgt.uri);
        const nonEmpty = Object.entries(counts).filter(([, n]) => n > 0);
        if (nonEmpty.length) {
            console.error(`Target ${tgtName} is not empty: ${nonEmpty.map(([k, v]) => `${k}=${v}`).join(', ')}`);
            console.error('Pass --allow-non-empty to proceed (existing docs will be merged/overwritten by mongorestore).');
            process.exit(3);
        }
    }

    if (!opts.yes) {
        const ok = await promptYesNo(`Migrate ${srcName} → ${tgtName}?`);
        if (!ok) { console.log('aborted'); process.exit(1); }
    }

    const dumpUri = withReadPref(src.uri, opts['read-preference'] || 'primaryPreferred');
    const remap = srcName !== tgtName ? [`--nsFrom=${srcName}.*`, `--nsTo=${tgtName}.*`] : [];
    if (remap.length) console.log(`Namespace remap: ${srcName}.* → ${tgtName}.*`);
    const useOplog = Boolean(opts.oplog) && !dbnameFromUri(src.uri) && remap.length === 0;
    if (opts.oplog && !useOplog) {
        const reasons = [];
        if (dbnameFromUri(src.uri)) reasons.push('source URI scopes to a single DB');
        if (remap.length) reasons.push('namespaces differ');
        console.log(`Skipping --oplog (${reasons.join('; ')}).`);
    }

    // When remapping, strip the dbname from the target URI so mongorestore
    // doesn't treat it as an implicit --db filter (incompatible with --nsFrom).
    const restoreUri = remap.length ? stripDbnameFromUri(tgt.uri) : tgt.uri;

    if (opts.mode === 'pipe') {
        const { dumpArgs, restoreArgs } = buildMigrateArgs(dumpUri, restoreUri, undefined, remap, opts);
        await runPiped('mongodump', dumpArgs, 'mongorestore', restoreArgs);
    } else {
        const dir = opts.dir || DEFAULT_BACKUP_DIR;
        ensureDir(dir);
        const file = path.join(dir, `${srcName}-migrate-${timestamp()}.archive.gz`);
        const { dumpArgs, restoreArgs } = buildMigrateArgs(dumpUri, restoreUri, file, remap, opts);
        await runStreaming('mongodump', dumpArgs);
        console.log(`Dump  : ${file} (${humanSize(fs.statSync(file).size)})`);
        await runStreaming('mongorestore', restoreArgs);
    }

    if (opts.verify) {
        console.log('--- verifying ---');
        await verifyParity(src.uri, tgt.uri, opts['read-preference'] || 'primaryPreferred');
    }
    console.log('migrate: done');
}

// ---------- subcommand: verify ---------------------------------------------

async function collectionCounts(uri) {
    mongoose.set('strictQuery', true);
    const conn = await mongoose.createConnection(uri, { maxPoolSize: 2 }).asPromise();
    try {
        const collections = await conn.db.listCollections().toArray();
        const counts = {};
        for (const c of collections) {
            if (c.type !== 'collection') continue;
            counts[c.name] = await conn.db.collection(c.name).countDocuments({});
        }
        return counts;
    } finally {
        await conn.close();
    }
}

async function collectionIndexes(uri) {
    const conn = await mongoose.createConnection(uri, { maxPoolSize: 2 }).asPromise();
    try {
        const collections = await conn.db.listCollections().toArray();
        const result = {};
        for (const c of collections) {
            if (c.type !== 'collection') continue;
            const idx = await conn.db.collection(c.name).indexes();
            result[c.name] = idx.map((i) => i.name).sort();
        }
        return result;
    } finally {
        await conn.close();
    }
}

async function verifyParity(srcUri, tgtUri, readPreference = 'primaryPreferred') {
    const [srcCounts, tgtCounts, srcIdx, tgtIdx] = await Promise.all([
        collectionCounts(withReadPref(srcUri, readPreference)),
        collectionCounts(tgtUri),
        collectionIndexes(withReadPref(srcUri, readPreference)),
        collectionIndexes(tgtUri)
    ]);
    const names = Array.from(new Set([...Object.keys(srcCounts), ...Object.keys(tgtCounts)])).sort();
    let mismatch = 0;
    console.log('collection                     source     target   diff   indexes');
    for (const n of names) {
        const s = srcCounts[n] ?? 0;
        const t = tgtCounts[n] ?? 0;
        const sIdx = (srcIdx[n] || []).join(',');
        const tIdx = (tgtIdx[n] || []).join(',');
        const idxOk = sIdx === tIdx ? 'ok' : 'DIFF';
        const diff = t - s;
        if (s !== t || sIdx !== tIdx) mismatch++;
        console.log(
            `${n.padEnd(30)} ${String(s).padStart(8)} ${String(t).padStart(10)} ${String(diff).padStart(6)}   ${idxOk}`
        );
    }
    if (mismatch) {
        console.error(`\n${mismatch} collection(s) differ between source and target.`);
        process.exitCode = 4;
    } else {
        console.log('\nparity: OK');
    }
}

async function cmdVerify(opts) {
    const src = resolveUri(opts, 'source');
    const tgt = resolveUri(opts, 'target');
    console.log(`Source : ${src.origin}`);
    console.log(`Target : ${tgt.origin}`);
    await verifyParity(src.uri, tgt.uri, opts['read-preference'] || 'primaryPreferred');
}

// ---------- subcommand: list -----------------------------------------------

async function cmdList(opts) {
    const dir = opts.dir || DEFAULT_BACKUP_DIR;
    if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir)
            .filter((f) => f.endsWith('.archive.gz'))
            .map((f) => {
                const s = fs.statSync(path.join(dir, f));
                return { name: f, size: s.size, mtime: s.mtime };
            })
            .sort((a, b) => b.mtime - a.mtime);
        console.log(`Local (${dir}):`);
        if (!files.length) console.log('  (none)');
        for (const f of files) {
            console.log(`  ${f.mtime.toISOString()}  ${humanSize(f.size).padStart(12)}  ${f.name}`);
        }
    } else {
        console.log(`Local (${dir}): directory does not exist`);
    }

    if (opts['s3-bucket']) {
        requireTools(['aws']);
        const prefix = opts['s3-prefix'] || 'hamlive';
        console.log(`\nS3 (s3://${opts['s3-bucket']}/${prefix}/):`);
        await runStreaming('aws', ['s3', 'ls', `s3://${opts['s3-bucket']}/${prefix}/`, '--human-readable']);
    }
}

// ---------- subcommand: prune ----------------------------------------------

async function cmdPrune(opts) {
    const dir = opts.dir || DEFAULT_BACKUP_DIR;
    const keepDays = Number(opts['keep-days']);
    if (!Number.isFinite(keepDays) || keepDays < 1) {
        console.error('--keep-days must be a positive integer');
        process.exit(2);
    }
    if (!fs.existsSync(dir)) {
        console.log(`No backup dir at ${dir}; nothing to prune.`);
        return;
    }
    const cutoff = Date.now() - keepDays * 86400 * 1000;
    const victims = fs.readdirSync(dir)
        .filter((f) => f.endsWith('.archive.gz'))
        .map((f) => ({ name: f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtime }))
        .filter((f) => f.mtime.getTime() < cutoff);

    if (!victims.length) { console.log('Nothing to prune.'); return; }
    console.log(`Will delete ${victims.length} file(s) older than ${keepDays}d:`);
    for (const v of victims) console.log(`  ${v.mtime.toISOString()}  ${v.name}`);
    if (opts['dry-run']) { console.log('(dry-run; nothing deleted)'); return; }
    if (!opts.yes) {
        const ok = await promptYesNo('Proceed?');
        if (!ok) { console.log('aborted'); return; }
    }
    for (const v of victims) fs.unlinkSync(v.full);
    console.log(`Deleted ${victims.length} file(s).`);
}

// ---------- CLI -------------------------------------------------------------

const commonConnectionOpts = {
    'production': { type: 'boolean', default: false, describe: 'use the configured production URI' },
    'env': { choices: ['production', 'development'], describe: 'select an explicitly configured environment' },
    'environment': { choices: ['production', 'development'], describe: 'classification for a raw URI' },
    'profile': { type: 'string', describe: `named profile from ${PROFILES_PATH}` },
    'uri': { type: 'string', describe: 'raw mongodb URI (overrides --profile/--env)' },
    'dir': { type: 'string', describe: `local backup dir (default: ${DEFAULT_BACKUP_DIR})` }
};

const sourceTargetOpts = {
    'source-env': { type: 'string' },
    'source-profile': { type: 'string' },
    'source-uri': { type: 'string' },
    'source-environment': { choices: ['production', 'development'] },
    'target-env': { type: 'string' },
    'target-profile': { type: 'string' },
    'target-uri': { type: 'string' },
    'target-environment': { choices: ['production', 'development'] },
    'read-preference': { choices: ['primaryPreferred', 'secondary'], default: 'primaryPreferred' }
};

function configureCli(args) {
    return yargs(args)
    .scriptName('dbBackup')
    .usage('$0 <command> [options]')
    .command(
        'backup',
        'dump a database to a gzipped archive',
        (y) => y.options({
            ...commonConnectionOpts,
            'collection': { type: 'array', describe: 'limit dump to specific collection(s)' },
            'no-oplog': { type: 'boolean', default: false, describe: 'skip --oplog (use for non-replica-set)' },
            'read-preference': { choices: ['primaryPreferred', 'secondary'], default: 'primaryPreferred' },
            's3-bucket': { type: 'string' },
            's3-prefix': { type: 'string', default: 'hamlive' }
        }),
        (a) => run(cmdBackup, a)
    )
    .command(
        'restore',
        'restore a gzipped archive into a database',
        (y) => y.options({
            ...commonConnectionOpts,
            'archive': { type: 'string', demandOption: true, describe: 'path to .archive.gz' },
            'archive-dbname': { type: 'string', describe: 'dbname inside the archive (auto-remaps to target if different); e.g. hamlive-prod' },
            'drop': { type: 'boolean', default: false, describe: 'drop collections before restore' },
            'oplog-replay': { type: 'boolean', default: false },
            'ns-from': { type: 'string', describe: 'remap namespace from (e.g. hamlive-prod.*); overrides --archive-dbname' },
            'ns-to': { type: 'string', describe: 'remap namespace to (e.g. hamlive-staging.*)' },
            'confirm-production': { type: 'string', describe: 'required dbname when target is prod' },
            'confirm-target': { type: 'string', describe: 'required dbname for an unclassified target' },
            'yes': { type: 'boolean', default: false, alias: 'y' }
        }),
        (a) => run(cmdRestore, a)
    )
    .command(
        'migrate',
        'copy data from one URI to another (dump→restore)',
        (y) => y.options({
            ...sourceTargetOpts,
            'dir': commonConnectionOpts.dir,
            'mode': { choices: ['dump-restore', 'pipe'], default: 'dump-restore' },
            'drop': { type: 'boolean', default: false },
            'allow-non-empty': { type: 'boolean', default: false, describe: 'allow target with existing data' },
            'oplog': { type: 'boolean', default: false, describe: 'capture oplog for a compatible full-instance migration' },
            'oplog-replay': { type: 'boolean', default: false },
            'read-preference': { choices: ['primaryPreferred', 'secondary'], default: 'primaryPreferred' },
            'verify': { type: 'boolean', default: true, describe: 'run parity check after restore' },
            'confirm-production': { type: 'string' },
            'confirm-target': { type: 'string' },
            'yes': { type: 'boolean', default: false, alias: 'y' }
        }),
        (a) => run(cmdMigrate, a)
    )
    .command(
        'verify',
        'compare doc counts and indexes between two URIs',
        (y) => y.options(sourceTargetOpts),
        (a) => run(cmdVerify, a)
    )
    .command(
        'list',
        'list local + S3 backups',
        (y) => y.options({
            'dir': commonConnectionOpts.dir,
            's3-bucket': { type: 'string' },
            's3-prefix': { type: 'string', default: 'hamlive' }
        }),
        (a) => run(cmdList, a)
    )
    .command(
        'prune',
        'delete local backups older than N days',
        (y) => y.options({
            'dir': commonConnectionOpts.dir,
            'keep-days': { type: 'number', default: 30 },
            'dry-run': { type: 'boolean', default: false },
            'yes': { type: 'boolean', default: false, alias: 'y' }
        }),
        (a) => run(cmdPrune, a)
    )
    .demandCommand(1)
    .strict()
    .help()
    .parse();
}

if (require.main === module) configureCli(hideBin(process.argv));

function buildBackupArgs(uri, archive, opts = {}) {
    const args = [`--uri=${withReadPref(uri, opts['read-preference'] || 'primaryPreferred')}`, `--archive=${archive}`, '--gzip'];
    if (!opts['no-oplog'] && !dbnameFromUri(uri)) args.push('--oplog');
    if (opts.collection) {
        for (const collection of [].concat(opts.collection)) args.push('--collection', collection);
    }
    return args;
}

function buildRestoreArgs(uri, archive, remapArgs = [], opts = {}) {
    const restoreUri = remapArgs.length ? stripDbnameFromUri(uri) : uri;
    const args = [`--uri=${restoreUri}`, `--archive=${archive}`, '--gzip', ...remapArgs];
    if (opts.drop) args.push('--drop');
    if (opts['oplog-replay'] && remapArgs.length === 0) args.push('--oplogReplay');
    return args;
}

function buildMigrateArgs(sourceUri, targetUri, archive, remapArgs = [], opts = {}) {
    const archiveArg = archive ? `--archive=${archive}` : '--archive';
    const useOplog = Boolean(opts.oplog) && !dbnameFromUri(sourceUri) && remapArgs.length === 0;
    const dumpArgs = [`--uri=${sourceUri}`, archiveArg, '--gzip'];
    const restoreArgs = [`--uri=${targetUri}`, archiveArg, '--gzip', ...remapArgs];
    if (useOplog) dumpArgs.push('--oplog');
    if (opts.drop) restoreArgs.push('--drop');
    if (useOplog && opts['oplog-replay']) restoreArgs.push('--oplogReplay');
    return { dumpArgs, restoreArgs, useOplog };
}

function run(fn, argv) {
    Promise.resolve(fn(argv))
        .then(() => process.exit(process.exitCode || 0))
        .catch((err) => {
            console.error(err.stack || err.message || err);
            process.exit(1);
        });
}

module.exports = {
    buildBackupArgs,
    buildMigrateArgs,
    buildRestoreArgs,
    confirmTargetWrite,
    configureCli,
    assertDatabaseIdentity,
    dbnameFromUri,
    requireUriDbname,
    resolveUri,
    verificationSourceUri: (uri, readPreference = 'primaryPreferred') => withReadPref(uri, readPreference),
    withReadPref
};
