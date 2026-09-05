#!/usr/bin/env node
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

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { spawn, spawnSync, type SpawnOptions } from 'node:child_process';
import yargs, { type Options } from 'yargs';
import { hideBin } from 'yargs/helpers';
import YAML from 'yaml';
import mongoose from 'mongoose';

type EnvironmentName = 'production' | 'development' | 'unclassified';
type CliOptions = Record<string, unknown>;
type Profiles = Record<string, { uri?: string; dbname?: string; environment?: EnvironmentName }>;
interface ResolvedTarget {
    uri: string;
    dbname: string;
    environment: EnvironmentName;
    origin: string;
}

const optionString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
const optionBoolean = (value: unknown): boolean => value === true;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const PROFILES_PATH = path.join(os.homedir(), '.hamlive-backup.yaml');
const DEFAULT_BACKUP_DIR = process.env['HAMLIVE_BACKUP_DIR'] || path.resolve(process.cwd(), 'backups');
const DEFAULT_UPLOAD_DIR = process.env['HAMLIVE_UPLOAD_DIR'];

// ---------- helpers ---------------------------------------------------------

function loadProfiles(): Profiles {
    if (!fs.existsSync(PROFILES_PATH)) return {};
    try {
        const parsed: unknown = YAML.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed as Profiles : {};
    } catch (err) {
        console.error(`Failed to parse ${PROFILES_PATH}: ${errorMessage(err)}`);
        process.exit(2);
    }
}

/** Resolve a URI from CLI options. Order: explicit --uri, --profile, --env. */
function resolveUri(opts: CliOptions, role: 'source' | 'target' | 'uri'): ResolvedTarget {
    const uriKey = role === 'uri' ? 'uri' : `${role}-uri`;
    const profileKey = role === 'uri' ? 'profile' : `${role}-profile`;
    const envKey = role === 'uri' ? 'env' : `${role}-env`;

    const environmentKey = role === 'uri' ? 'environment' : `${role}-environment`;
    const directUri = optionString(opts[uriKey]);
    if (directUri) {
        const environment = optionString(opts[environmentKey]) as EnvironmentName | undefined;
        return { uri: directUri, dbname: requireUriDbname(directUri, `--${uriKey}`), environment: environment || 'unclassified', origin: `--${uriKey}` };
    }

    const profileName = optionString(opts[profileKey]);
    if (profileName) {
        const profiles = loadProfiles();
        const p = profiles[profileName];
        if (!p?.uri) {
            console.error(`Profile "${profileName}" not found in ${PROFILES_PATH}`);
            process.exit(2);
        }
        const dbname = requireUriDbname(p.uri, `profile:${profileName}`);
        assertDatabaseIdentity(p.dbname, dbname, `profile "${profileName}"`);
        return { uri: p.uri, dbname, environment: p.environment || 'unclassified', origin: `profile:${profileName}` };
    }

    const env = (optionString(opts[envKey]) || (optionBoolean(opts['production']) ? 'production' : 'development')) as EnvironmentName;
    if (!['production', 'development'].includes(env)) throw new Error(`Unsupported environment "${env}"`);
    const variable = env === 'production' ? 'MONGODB_PRODUCTION_URI' : 'MONGODB_DEVELOPMENT_URI';
    const uri = process.env[variable] || (env === 'production' ? process.env['MONGODB_URI'] : undefined);
    if (!uri) throw new Error(`No ${variable} configured for ${env}; refusing to fall back to another environment`);
    return { uri, dbname: requireUriDbname(uri, variable), environment: env, origin: `environment:${env}` };
}

function dbnameFromUri(uri: string): string | null {
    // Mongo URIs may have comma-separated hosts (replica sets), which break
    // the URL parser. Extract the path between the host(s) and the query
    // string with a regex instead.
    const m = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@]*@)?[^/?]+\/([^?]+)/);
    if (!m || !m[1]) return null;
    try { return decodeURIComponent(m[1]); } catch { return null; }
}

function requireUriDbname(uri: string, origin: string): string {
    const dbname = dbnameFromUri(uri);
    if (!dbname) throw new Error(`MongoDB URI from ${origin} must include a database name`);
    return dbname;
}

function assertDatabaseIdentity(configured: string | undefined, actual: string, origin: string): void {
    if (configured && configured !== actual) {
        throw new Error(`Database identity conflict in ${origin}: configured name does not match URI database`);
    }
}

function stripDbnameFromUri(uri: string): string {
    // When using --nsFrom/--nsTo, mongorestore interprets a dbname in the URI
    // path as an implicit --db filter, which conflicts with the namespace
    // remap. Strip it.
    return uri.replace(/^(mongodb(?:\+srv)?:\/\/(?:[^@]*@)?[^/?]+)\/[^?]+(\?|$)/, '$1/$2');
}

function hostsFromUri(uri: string): string[] {
    const m = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@]*@)?([^/?]+)/);
    if (!m) return [];
    const hosts = m[1];
    if (!hosts) return [];
    return hosts.split(',').map((host) => host.split(':')[0]?.toLowerCase() || '').filter(Boolean).sort();
}

function sameCluster(a: string, b: string): boolean {
    const ha = hostsFromUri(a), hb = hostsFromUri(b);
    if (!ha.length || !hb.length) return false;
    return ha.join('|') === hb.join('|');
}

function withReadPref(uri: string, pref = 'primaryPreferred'): string {
    if (/[?&]readPreference=/i.test(uri)) return uri;
    return uri + (uri.includes('?') ? '&' : '?') + `readPreference=${pref}`;
}

function timestamp(): string {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function sha256File(file: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function companionFiles(archive: string): { manifest: string; uploads: string } {
    return { manifest: `${archive}.manifest.json`, uploads: `${archive}.uploads.tar.gz` };
}

function safeUploadArchiveEntries(output: string): boolean {
    return output.split(/\r?\n/).filter(Boolean).every(entry =>
        !path.posix.isAbsolute(entry) && !entry.split('/').includes('..')
    );
}

function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function which(bin: string): string | null {
    const r = spawnSync('which', [bin], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
}

function requireTools(tools: string[]): void {
    const missing = tools.filter((t) => !which(t));
    if (missing.length) {
        console.error(`Missing required tool(s): ${missing.join(', ')}`);
        console.error('Install via the MongoDB Database Tools: https://www.mongodb.com/try/download/database-tools');
        process.exit(2);
    }
}

function runStreaming(cmd: string, args: string[], opts: SpawnOptions = {}): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited with code ${code}`));
        });
    });
}

function runCapture(cmd: string, args: string[]): string {
    const result = spawnSync(cmd, args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${cmd} exited with code ${result.status}: ${result.stderr.trim()}`);
    return result.stdout;
}

function runPiped(srcCmd: string, srcArgs: string[], dstCmd: string, dstArgs: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const src = spawn(srcCmd, srcArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
        const dst = spawn(dstCmd, dstArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
        if (!src.stdout || !dst.stdin) return reject(new Error('Unable to create backup pipeline'));
        src.stdout.pipe(dst.stdin);

        let srcCode: number | null = null, dstCode: number | null = null;
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

function confirmTargetWrite(target: ResolvedTarget, opts: CliOptions): void {
    if (target.environment === 'production') {
        if (opts['confirm-production'] === target.dbname) return;
        throw new Error(`Refusing production write to database "${target.dbname}"; pass --confirm-production "${target.dbname}"`);
    }
    if (target.environment === 'development') return;
    if (opts['confirm-target'] === target.dbname) return;
    throw new Error(`Refusing write to unclassified database "${target.dbname}"; classify it or pass --confirm-target "${target.dbname}"`);
}

async function promptYesNo(question: string): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise<boolean>((resolve) => {
        rl.question(`${question} [y/N] `, (ans) => {
            rl.close();
            resolve(/^y(es)?$/i.test(ans.trim()));
        });
    });
}

// ---------- subcommand: backup ---------------------------------------------

async function cmdBackup(opts: CliOptions): Promise<void> {
    requireTools(['mongodump']);
    const { uri, dbname, origin } = resolveUri(opts, 'uri');
    const name = dbname || dbnameFromUri(uri) || 'unknown';
    const ts = timestamp();
    const dir = optionString(opts['dir']) || DEFAULT_BACKUP_DIR;
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

    const uploadDir = optionString(opts['upload-dir']) || DEFAULT_UPLOAD_DIR;
    const companions = companionFiles(file);
    if (uploadDir) {
        requireTools(['tar']);
        if (!fs.statSync(uploadDir, { throwIfNoEntry: false })?.isDirectory()) {
            throw new Error(`Configured upload directory does not exist: ${uploadDir}`);
        }
        const uploadPartial = `${companions.uploads}.partial`;
        const manifestPartial = `${companions.manifest}.partial`;
        try {
            await runStreaming('tar', ['-czf', uploadPartial, '-C', uploadDir, '.']);
            fs.chmodSync(uploadPartial, 0o600);
            fs.renameSync(uploadPartial, companions.uploads);
            const manifest = {
                schemaVersion: 1, complete: true, createdAt: new Date().toISOString(), database: name,
                databaseArchive: path.basename(file), uploadsArchive: path.basename(companions.uploads),
                sha256: { database: sha256File(file), uploads: sha256File(companions.uploads) }
            };
            fs.writeFileSync(manifestPartial, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
            fs.renameSync(manifestPartial, companions.manifest);
            console.log(`Wrote coordinated manifest ${companions.manifest}`);
        } catch (error) {
            for (const incomplete of [uploadPartial, manifestPartial, companions.uploads, file]) {
                if (fs.existsSync(incomplete)) fs.unlinkSync(incomplete);
            }
            throw error;
        }
    } else if (optionBoolean(opts['require-uploads'])) {
        throw new Error('Upload backup is required but HAMLIVE_UPLOAD_DIR/--upload-dir is not configured');
    }

    const s3Bucket = optionString(opts['s3-bucket']);
    if (s3Bucket) {
        requireTools(['aws']);
        const s3key = `${optionString(opts['s3-prefix']) || 'hamlive'}/${path.basename(file)}`;
        const s3uri = `s3://${s3Bucket}/${s3key}`;
        console.log(`Uploading to ${s3uri}`);
        await runStreaming('aws', ['s3', 'cp', file, s3uri, '--sse', 'AES256']);
        if (fs.existsSync(companions.manifest)) {
            for (const companion of [companions.uploads, companions.manifest]) {
                await runStreaming('aws', ['s3', 'cp', companion, `s3://${s3Bucket}/${optionString(opts['s3-prefix']) || 'hamlive'}/${path.basename(companion)}`, '--sse', 'AES256']);
            }
        }
    }
    console.log('backup: done');
}

// ---------- subcommand: restore --------------------------------------------

async function cmdRestore(opts: CliOptions): Promise<void> {
    requireTools(['mongorestore']);
    const archive = optionString(opts['archive']);
    if (!archive) {
        console.error('--archive <path> is required');
        process.exit(2);
    }
    if (!fs.existsSync(archive)) {
        console.error(`Archive not found: ${archive}`);
        process.exit(2);
    }
    const target = resolveUri(opts, 'uri');
    const { uri, dbname, origin } = target;
    const name = dbname || dbnameFromUri(uri) || 'unknown';

    console.log(`Archive : ${archive}`);
    console.log(`Target  : ${origin} (db=${name})`);

    confirmTargetWrite(target, opts);

    if (!optionBoolean(opts['yes'])) {
        const ok = await promptYesNo(`Restore into ${name}? Existing data may be replaced.`);
        if (!ok) { console.log('aborted'); process.exit(1); }
    }

    let uploadRestore: { dir: string; archive: string } | undefined;
    if (optionBoolean(opts['restore-uploads'])) {
        const uploadDir = optionString(opts['upload-dir']) || DEFAULT_UPLOAD_DIR;
        if (!uploadDir) throw new Error('Upload restore requires HAMLIVE_UPLOAD_DIR or --upload-dir');
        const companions = companionFiles(archive);
        if (!fs.existsSync(companions.manifest) || !fs.existsSync(companions.uploads)) {
            throw new Error('Coordinated upload archive or manifest is missing');
        }
        const manifest = JSON.parse(fs.readFileSync(companions.manifest, 'utf8')) as {
            complete?: boolean; databaseArchive?: string; uploadsArchive?: string;
            sha256?: { database?: string; uploads?: string };
        };
        if (!manifest.complete || manifest.databaseArchive !== path.basename(archive) ||
            manifest.uploadsArchive !== path.basename(companions.uploads) ||
            manifest.sha256?.database !== sha256File(archive) || manifest.sha256?.uploads !== sha256File(companions.uploads)) {
            throw new Error('Backup manifest validation failed');
        }
        ensureDir(uploadDir);
        if (fs.readdirSync(uploadDir).length && !optionBoolean(opts['allow-non-empty-uploads'])) {
            throw new Error('Upload restore target is not empty; refusing to merge without --allow-non-empty-uploads');
        }
        const entries = runCapture('tar', ['-tzf', companions.uploads]);
        if (!safeUploadArchiveEntries(entries)) throw new Error('Upload archive contains an unsafe path');
        uploadRestore = { dir: uploadDir, archive: companions.uploads };
    }

    const remapArgs = [];
    let willRemap = false;
    const nsFrom = optionString(opts['ns-from']);
    const nsTo = optionString(opts['ns-to']);
    const archiveDbname = optionString(opts['archive-dbname']);
    if (nsFrom && nsTo) {
        remapArgs.push(`--nsFrom=${nsFrom}`, `--nsTo=${nsTo}`);
        willRemap = true;
    } else if (archiveDbname && archiveDbname !== name) {
        const from = `${archiveDbname}.*`;
        const to = `${name}.*`;
        console.log(`Namespace remap: ${from} → ${to}`);
        remapArgs.push(`--nsFrom=${from}`, `--nsTo=${to}`);
        willRemap = true;
    }

    // When remapping, strip the dbname from the URI: mongorestore otherwise
    // treats it as an implicit --db filter that conflicts with --nsFrom/--nsTo.
    const args = buildRestoreArgs(uri, archive, remapArgs, opts);
    if (willRemap && optionBoolean(opts['oplog-replay'])) {
        console.log('Skipping --oplogReplay because namespaces differ.');
    }

    await runStreaming('mongorestore', args);

    if (uploadRestore) {
        await runStreaming('tar', ['-xzf', uploadRestore.archive, '-C', uploadRestore.dir, '--no-same-owner', '--no-same-permissions']);
        console.log(`Restored coordinated uploads into ${uploadRestore.dir}`);
    }
    console.log('restore: done');
}

// ---------- subcommand: migrate --------------------------------------------

async function cmdMigrate(opts: CliOptions): Promise<void> {
    requireTools(['mongodump', 'mongorestore']);
    const src = resolveUri(opts, 'source');
    const tgt = resolveUri(opts, 'target');
    const srcName = src.dbname || dbnameFromUri(src.uri) || 'unknown';
    const tgtName = tgt.dbname || dbnameFromUri(tgt.uri) || 'unknown';

    console.log(`Source : ${src.origin} (db=${srcName})`);
    console.log(`Target : ${tgt.origin} (db=${tgtName})`);
    const mode = optionString(opts['mode']) || 'dump-restore';
    console.log(`Mode   : ${mode}`);
    if (sameCluster(src.uri, tgt.uri)) {
        console.log('Note   : source and target appear to be on the same cluster (same hosts).');
    }

    confirmTargetWrite(tgt, opts);

    if (!optionBoolean(opts['allow-non-empty'])) {
        const counts = await collectionCounts(tgt.uri);
        const nonEmpty = Object.entries(counts).filter(([, n]) => n > 0);
        if (nonEmpty.length) {
            console.error(`Target ${tgtName} is not empty: ${nonEmpty.map(([k, v]) => `${k}=${v}`).join(', ')}`);
            console.error('Pass --allow-non-empty to proceed (existing docs will be merged/overwritten by mongorestore).');
            process.exit(3);
        }
    }

    if (!optionBoolean(opts['yes'])) {
        const ok = await promptYesNo(`Migrate ${srcName} → ${tgtName}?`);
        if (!ok) { console.log('aborted'); process.exit(1); }
    }

    const readPreference = optionString(opts['read-preference']) || 'primaryPreferred';
    const dumpUri = withReadPref(src.uri, readPreference);
    const remap = srcName !== tgtName ? [`--nsFrom=${srcName}.*`, `--nsTo=${tgtName}.*`] : [];
    if (remap.length) console.log(`Namespace remap: ${srcName}.* → ${tgtName}.*`);
    const useOplog = optionBoolean(opts['oplog']) && !dbnameFromUri(src.uri) && remap.length === 0;
    if (optionBoolean(opts['oplog']) && !useOplog) {
        const reasons = [];
        if (dbnameFromUri(src.uri)) reasons.push('source URI scopes to a single DB');
        if (remap.length) reasons.push('namespaces differ');
        console.log(`Skipping --oplog (${reasons.join('; ')}).`);
    }

    // When remapping, strip the dbname from the target URI so mongorestore
    // doesn't treat it as an implicit --db filter (incompatible with --nsFrom).
    const restoreUri = remap.length ? stripDbnameFromUri(tgt.uri) : tgt.uri;

    if (mode === 'pipe') {
        const { dumpArgs, restoreArgs } = buildMigrateArgs(dumpUri, restoreUri, undefined, remap, opts);
        await runPiped('mongodump', dumpArgs, 'mongorestore', restoreArgs);
    } else {
        const dir = optionString(opts['dir']) || DEFAULT_BACKUP_DIR;
        ensureDir(dir);
        const file = path.join(dir, `${srcName}-migrate-${timestamp()}.archive.gz`);
        const { dumpArgs, restoreArgs } = buildMigrateArgs(dumpUri, restoreUri, file, remap, opts);
        await runStreaming('mongodump', dumpArgs);
        console.log(`Dump  : ${file} (${humanSize(fs.statSync(file).size)})`);
        await runStreaming('mongorestore', restoreArgs);
    }

    if (opts['verify'] !== false) {
        console.log('--- verifying ---');
        await verifyParity(src.uri, tgt.uri, readPreference);
    }
    console.log('migrate: done');
}

// ---------- subcommand: verify ---------------------------------------------

const DISPOSABLE_SECURITY_COLLECTIONS = new Set(['sessions', 'magiclogintokens', 'ratelimits']);

async function collectionCounts(uri: string): Promise<Record<string, number>> {
    mongoose.set('strictQuery', true);
    const conn = await mongoose.createConnection(uri, { maxPoolSize: 2 }).asPromise();
    try {
        const collections = await conn.db.listCollections().toArray();
        const counts: Record<string, number> = {};
        for (const c of collections) {
            if (c.type !== 'collection' || DISPOSABLE_SECURITY_COLLECTIONS.has(c.name)) continue;
            counts[c.name] = await conn.db.collection(c.name).countDocuments({});
        }
        return counts;
    } finally {
        await conn.close();
    }
}

async function collectionIndexes(uri: string): Promise<Record<string, string[]>> {
    const conn = await mongoose.createConnection(uri, { maxPoolSize: 2 }).asPromise();
    try {
        const collections = await conn.db.listCollections().toArray();
        const result: Record<string, string[]> = {};
        for (const c of collections) {
            if (c.type !== 'collection' || DISPOSABLE_SECURITY_COLLECTIONS.has(c.name)) continue;
            const idx = await conn.db.collection(c.name).indexes();
            result[c.name] = idx.flatMap((index) => {
                const name: unknown = index['name'];
                return typeof name === 'string' ? [name] : [];
            }).sort();
        }
        return result;
    } finally {
        await conn.close();
    }
}

async function verifyParity(srcUri: string, tgtUri: string, readPreference = 'primaryPreferred'): Promise<void> {
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

async function cmdVerify(opts: CliOptions): Promise<void> {
    const src = resolveUri(opts, 'source');
    const tgt = resolveUri(opts, 'target');
    console.log(`Source : ${src.origin}`);
    console.log(`Target : ${tgt.origin}`);
    await verifyParity(src.uri, tgt.uri, optionString(opts['read-preference']) || 'primaryPreferred');
}

// ---------- subcommand: list -----------------------------------------------

async function cmdList(opts: CliOptions): Promise<void> {
    const dir = optionString(opts['dir']) || DEFAULT_BACKUP_DIR;
    if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir)
            .filter((f) => f.endsWith('.archive.gz'))
            .map((f) => {
                const s = fs.statSync(path.join(dir, f));
                return { name: f, size: s.size, mtime: s.mtime };
            })
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        console.log(`Local (${dir}):`);
        if (!files.length) console.log('  (none)');
        for (const f of files) {
            console.log(`  ${f.mtime.toISOString()}  ${humanSize(f.size).padStart(12)}  ${f.name}`);
        }
    } else {
        console.log(`Local (${dir}): directory does not exist`);
    }

    const s3Bucket = optionString(opts['s3-bucket']);
    if (s3Bucket) {
        requireTools(['aws']);
        const prefix = optionString(opts['s3-prefix']) || 'hamlive';
        console.log(`\nS3 (s3://${s3Bucket}/${prefix}/):`);
        await runStreaming('aws', ['s3', 'ls', `s3://${s3Bucket}/${prefix}/`, '--human-readable']);
    }
}

// ---------- subcommand: prune ----------------------------------------------

async function cmdPrune(opts: CliOptions): Promise<void> {
    const dir = optionString(opts['dir']) || DEFAULT_BACKUP_DIR;
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
    if (optionBoolean(opts['dry-run'])) { console.log('(dry-run; nothing deleted)'); return; }
    if (!optionBoolean(opts['yes'])) {
        const ok = await promptYesNo('Proceed?');
        if (!ok) { console.log('aborted'); return; }
    }
    for (const v of victims) {
        for (const file of [v.full, companionFiles(v.full).uploads, companionFiles(v.full).manifest]) {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }
    }
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
} satisfies Record<string, Options>;

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
} satisfies Record<string, Options>;

function configureCli(args: string[]): void {
    void yargs(args)
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
            'upload-dir': { type: 'string', describe: 'upload directory to include in the coordinated backup' },
            'require-uploads': { type: 'boolean', default: false, describe: 'fail if upload backup is not configured' },
            's3-bucket': { type: 'string' },
            's3-prefix': { type: 'string', default: 'hamlive' }
        }),
        (a) => run(cmdBackup, a as CliOptions)
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
            'restore-uploads': { type: 'boolean', default: false, describe: 'restore matching uploads after manifest verification' },
            'upload-dir': { type: 'string', describe: 'empty upload target directory' },
            'allow-non-empty-uploads': { type: 'boolean', default: false, describe: 'explicitly permit merging upload files' },
            'ns-from': { type: 'string', describe: 'remap namespace from (e.g. hamlive-prod.*); overrides --archive-dbname' },
            'ns-to': { type: 'string', describe: 'remap namespace to (e.g. hamlive-staging.*)' },
            'confirm-production': { type: 'string', describe: 'required dbname when target is prod' },
            'confirm-target': { type: 'string', describe: 'required dbname for an unclassified target' },
            'yes': { type: 'boolean', default: false, alias: 'y' }
        }),
        (a) => run(cmdRestore, a as CliOptions)
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
        (a) => run(cmdMigrate, a as CliOptions)
    )
    .command(
        'verify',
        'compare doc counts and indexes between two URIs',
        (y) => y.options(sourceTargetOpts),
        (a) => run(cmdVerify, a as CliOptions)
    )
    .command(
        'list',
        'list local + S3 backups',
        (y) => y.options({
            'dir': commonConnectionOpts.dir,
            's3-bucket': { type: 'string' },
            's3-prefix': { type: 'string', default: 'hamlive' }
        }),
        (a) => run(cmdList, a as CliOptions)
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
        (a) => run(cmdPrune, a as CliOptions)
    )
    .demandCommand(1)
    .strict()
    .help()
    .parse();
}

if (require.main === module) configureCli(hideBin(process.argv));

function buildBackupArgs(uri: string, archive: string, opts: CliOptions = {}): string[] {
    const args = [`--uri=${withReadPref(uri, optionString(opts['read-preference']) || 'primaryPreferred')}`, `--archive=${archive}`, '--gzip'];
    // Authentication and abuse-control state is deliberately disposable. A
    // recovery must not revive old sessions, magic links, or rate windows.
    for (const collection of DISPOSABLE_SECURITY_COLLECTIONS) {
        args.push(`--excludeCollection=${collection}`);
    }
    if (!optionBoolean(opts['no-oplog']) && !dbnameFromUri(uri)) args.push('--oplog');
    const collections = opts['collection'];
    if (collections) {
        const values = Array.isArray(collections) ? collections : [collections];
        for (const collection of values) {
            const name = optionString(collection);
            if (name) args.push('--collection', name);
        }
    }
    return args;
}

function buildRestoreArgs(uri: string, archive: string, remapArgs: string[] = [], opts: CliOptions = {}): string[] {
    const restoreUri = remapArgs.length ? stripDbnameFromUri(uri) : uri;
    const args = [`--uri=${restoreUri}`, `--archive=${archive}`, '--gzip', ...remapArgs];
    if (optionBoolean(opts['drop'])) args.push('--drop');
    if (optionBoolean(opts['oplog-replay']) && remapArgs.length === 0) args.push('--oplogReplay');
    return args;
}

function buildMigrateArgs(sourceUri: string, targetUri: string, archive?: string, remapArgs: string[] = [], opts: CliOptions = {}) {
    const archiveArg = archive ? `--archive=${archive}` : '--archive';
    const useOplog = optionBoolean(opts['oplog']) && !dbnameFromUri(sourceUri) && remapArgs.length === 0;
    const dumpArgs = [`--uri=${sourceUri}`, archiveArg, '--gzip'];
    const restoreArgs = [`--uri=${targetUri}`, archiveArg, '--gzip', ...remapArgs];
    if (useOplog) dumpArgs.push('--oplog');
    if (optionBoolean(opts['drop'])) restoreArgs.push('--drop');
    if (useOplog && optionBoolean(opts['oplog-replay'])) restoreArgs.push('--oplogReplay');
    return { dumpArgs, restoreArgs, useOplog };
}

function run(fn: (options: CliOptions) => Promise<void>, argv: CliOptions): void {
    Promise.resolve(fn(argv))
        .then(() => process.exit(process.exitCode || 0))
        .catch((err: unknown) => {
            console.error(err instanceof Error ? err.stack || err.message : String(err));
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
    companionFiles,
    safeUploadArchiveEntries,
    sha256File,
    verificationSourceUri: (uri: string, readPreference = 'primaryPreferred') => withReadPref(uri, readPreference),
    withReadPref
};
