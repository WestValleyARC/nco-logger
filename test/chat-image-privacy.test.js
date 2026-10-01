const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { sanitizeChatImage } = require('../server/dist/lib/chatImage');
const { createTestDatabase } = require('./helpers/testDatabase');

const SECRET = 'private-author-camera-gps-original-filename@example.test';
const image = (format = 'jpeg', orientation = 6) =>
    sharp({
        create: {
            width: 12,
            height: 8,
            channels: 4,
            background: { r: 210, g: 30, b: 40, alpha: 0.5 }
        }
    })
        .toFormat(format)
        .withMetadata({
            orientation,
            exif: {
                IFD0: { Artist: SECRET, Make: SECRET, Model: SECRET, ImageDescription: SECRET, Copyright: SECRET },
                IFD3: {
                    GPSLatitudeRef: 'N',
                    GPSLatitude: '33/1 26/1 54/1',
                    GPSLongitudeRef: 'W',
                    GPSLongitude: '112/1 4/1 26/1'
                }
            }
        })
        .withXmp(`<x:xmpmeta xmlns:x="adobe:ns:meta/">${SECRET}</x:xmpmeta>`)
        .toBuffer();
const assertPrivate = async data => {
    const metadata = await sharp(data, { animated: true }).metadata();
    for (const field of ['exif', 'xmp', 'iptc', 'icc', 'orientation', 'comments'])
        assert.equal(metadata[field], undefined, field);
    assert.equal(data.includes(Buffer.from(SECRET)), false);
    return metadata;
};

test('JPEG, PNG and WebP strip personal metadata and preserve orientation and alpha', async () => {
    for (const format of ['jpeg', 'png', 'webp']) {
        const source = await image(format);
        assert.ok((await sharp(source).metadata()).exif);
        assert.ok(source.includes(Buffer.from(SECRET)));
        const output = await sanitizeChatImage(source);
        const metadata = await assertPrivate(output.data);
        assert.equal(metadata.format, format);
        assert.equal(metadata.width, 8);
        assert.equal(metadata.height, 12);
        if (format !== 'jpeg') assert.equal(metadata.hasAlpha, true);
    }
});

test('all EXIF orientations preserve asymmetric pixel placement', async () => {
    const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 255]);
    for (let orientation = 1; orientation <= 8; orientation++) {
        const original = await sharp(pixels, { raw: { width: 3, height: 2, channels: 3 } })
            .png()
            .withMetadata({ orientation })
            .toBuffer();
        const expected = await sharp(original).autoOrient().raw().toBuffer();
        const output = await sanitizeChatImage(original);
        assert.deepEqual(await sharp(output.data).raw().toBuffer(), expected, `orientation ${orientation}`);
        await assertPrivate(output.data);
    }
});

test('animated GIF and WebP preserve frames, timings and loops without comments', async () => {
    const pixels = Buffer.concat([Buffer.alloc(4 * 4 * 3, 30), Buffer.alloc(4 * 4 * 3, 200)]);
    for (const format of ['gif', 'webp']) {
        let original = await sharp(pixels, { raw: { width: 4, height: 8, channels: 3, pageHeight: 4 } })
            .toFormat(format, { loop: 3, delay: [100, 250], lossless: true })
            .toBuffer();
        if (format === 'gif') {
            const comment = Buffer.concat([
                Buffer.from([0x21, 0xfe, SECRET.length]),
                Buffer.from(SECRET),
                Buffer.from([0])
            ]);
            original = Buffer.concat([original.subarray(0, -1), comment, original.subarray(-1)]);
        }
        const before = await sharp(original, { animated: true }).metadata();
        const output = await sanitizeChatImage(original);
        const after = await assertPrivate(output.data);
        assert.equal(after.pages, 2);
        assert.deepEqual(after.delay, before.delay);
        assert.equal(after.loop, before.loop);
        assert.deepEqual(
            await sharp(output.data, { animated: true }).raw().toBuffer(),
            await sharp(original, { animated: true }).raw().toBuffer()
        );
    }
});

test('JPEG comments, APP13/IPTC, and trailing payload are never copied', async () => {
    const original = await image();
    const segment = marker => {
        const payload = Buffer.from(SECRET);
        const length = Buffer.alloc(2);
        length.writeUInt16BE(payload.length + 2);
        return Buffer.concat([Buffer.from([255, marker]), length, payload]);
    };
    const input = Buffer.concat([
        original.subarray(0, 2),
        segment(0xfe),
        segment(0xed),
        original.subarray(2),
        Buffer.from(SECRET)
    ]);
    await assertPrivate((await sanitizeChatImage(input)).data);
});

test('invalid, truncated, oversized and unsupported animated PNG input fails closed', async () => {
    for (const data of [Buffer.alloc(0), Buffer.from('<svg/>'), (await image()).subarray(0, 50)]) {
        await assert.rejects(sanitizeChatImage(data), { status: 415 });
    }
    await assert.rejects(sanitizeChatImage(await image(), 20), { status: 415 });
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } })
        .png()
        .toBuffer();
    const acTL = Buffer.alloc(20);
    acTL.writeUInt32BE(8);
    acTL.write('acTL', 4);
    await assert.rejects(sanitizeChatImage(Buffer.concat([png.subarray(0, 33), acTL, png.subarray(33)])), {
        status: 415
    });
    const bomb = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: 'red' } })
        .png()
        .toBuffer();
    await assert.rejects(sanitizeChatImage(bomb), { status: 415 });
});

test('image routes and retention use isolated database/files and preserve retry ownership', async t => {
    const database = await createTestDatabase({ databaseName: 'chat_image_privacy_test' });
    const uploadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nco-image-privacy-'));
    const { conf } = require('../server/dist/lib/configLib');
    conf.chat_upload_dir = uploadDir;
    conf.chat_retention_days = '7';
    await mongoose.connect(database.uri);
    delete require.cache[require.resolve('../server/dist/lib/localChat')];
    const chat = require('../server/dist/lib/localChat');
    const retention = require('../server/dist/lib/chatRetention');
    const { getChatRetention, getChatImageAsset } = require('../server/dist/models/chatRetention');
    const Job = getChatRetention();
    const Asset = getChatImageAsset();
    const Message = require('../server/dist/models/chatMessage').getChatMessage();
    const Live = require('../server/dist/models/liveNet').getLiveNet();
    const Interaction = require('../server/dist/models/stationInteraction').getStationInteraction();
    const User = require('../server/dist/models/userProfile').getUserProfile();
    const Auto = require('../server/dist/models/liveNetAutoClose').getLiveNetAutoClose();
    await Promise.all([
        Job.init(),
        Asset.init(),
        Message.init(),
        Live.init(),
        Interaction.init(),
        User.init(),
        Auto.init()
    ]);
    const id = () => new mongoose.Types.ObjectId();
    const profile = id(),
        first = id(),
        second = id(),
        third = id();
    const live = await Live.create({ netProfile: profile, netControl: first, url: '/test', lookupTable: {} });
    for (const [i, user] of [first, second, third].entries()) {
        await User.create({
            _id: user,
            callSign: `W1T${String.fromCharCode(65 + i)}`,
            displayName: 'Tester',
            email: `test${i}@example.test`,
            lastAuthVia: 'email'
        });
        await Interaction.create({
            liveNet: live._id,
            netProfile: profile,
            userProfile: user,
            callSign: `W1T${String.fromCharCode(65 + i)}`,
            role: i ? 'netuser' : 'netcontrol',
            createdBy: 'user'
        });
    }
    const invoke = async (handler, req) => {
        let status = 200,
            body,
            headers;
        await handler(req, {
            status(value) {
                status = value;
                return this;
            },
            json(value) {
                body = value;
                return this;
            },
            send(value) {
                body = value;
                return this;
            },
            set(value) {
                headers = value;
                return this;
            }
        });
        return { status, body, headers };
    };
    const req = (user = first, extra = {}) => ({
        params: { id: String(profile) },
        user: { _id: user, callSign: 'W1TA', displayName: 'Tester' },
        ...extra
    });
    let stored;
    try {
        await t.test('both public and direct upload paths sanitize before persistence and delivery', async () => {
            for (const scope of ['public', 'direct']) {
                const original = await image();
                const response = await invoke(
                    chat.uploadImage,
                    req(first, {
                        body: original,
                        params: { id: String(profile), ...(scope === 'direct' ? { userId: String(second) } : {}) },
                        get: header =>
                            header === 'content-type' ? 'image/jpeg' : header === 'x-filename' ? SECRET : undefined
                    })
                );
                assert.equal(response.status, 201, JSON.stringify(response.body));
                stored = await Message.findById(response.body.message.id);
                assert.match(stored.attachment.storageName, /^[a-f0-9-]+\.jpg$/);
                await assertPrivate(await fs.promises.readFile(chat.attachmentPath(stored.attachment.storageName)));
                assert.equal(JSON.stringify(response.body).includes(SECRET), false);
                const delivered = await invoke(
                    chat.serveImage,
                    req(second, { params: { id: String(profile), messageId: String(stored._id) } })
                );
                assert.equal(delivered.status, 200);
                await assertPrivate(delivered.body);
                assert.match(delivered.headers['Content-Disposition'], new RegExp(`${stored._id}\\.jpg`));
                if (scope === 'direct')
                    assert.equal(
                        (
                            await invoke(
                                chat.serveImage,
                                req(third, { params: { id: String(profile), messageId: String(stored._id) } })
                            )
                        ).status,
                        404
                    );
            }
        });
        await t.test(
            'legacy bytes are sanitized in memory, originals remain untouched, symlinks fail closed',
            async () => {
                const original = await image();
                const name = `${crypto.randomUUID()}.jpg`;
                await fs.promises.writeFile(chat.attachmentPath(name), original);
                const legacy = await Message.create({
                    liveNet: live._id,
                    netProfile: profile,
                    userProfile: first,
                    callSign: 'W1TA',
                    attachment: { kind: 'image', storageName: name, mimeType: 'image/jpeg', size: original.length }
                });
                const request = req(second, { params: { id: String(profile), messageId: String(legacy._id) } });
                const output = await invoke(chat.serveImage, request);
                assert.equal(output.status, 200);
                await assertPrivate(output.body);
                assert.deepEqual(await fs.promises.readFile(chat.attachmentPath(name)), original);
                await fs.promises.unlink(chat.attachmentPath(name));
                const outside = path.join(uploadDir, 'outside-data');
                await fs.promises.writeFile(outside, original);
                await fs.promises.symlink(outside, chat.attachmentPath(name));
                assert.equal((await invoke(chat.serveImage, request)).status, 500);
                await fs.promises.unlink(chat.attachmentPath(name));
            }
        );
        await t.test('failed message persistence and unlink keep a durable recoverable asset', async st => {
            const create = st.mock.method(Message, 'create', async () => {
                throw new Error('simulated persistence failure');
            });
            const unlink = st.mock.method(fs.promises, 'unlink', async () => {
                throw Object.assign(new Error('simulated unlink failure'), { code: 'EACCES' });
            });
            const before = await Asset.countDocuments({});
            const response = await invoke(
                chat.uploadImage,
                req(first, {
                    body: await image(),
                    get: header => (header === 'content-type' ? 'image/jpeg' : undefined)
                })
            );
            assert.equal(response.status, 500);
            assert.equal(await Asset.countDocuments({}), before + 1);
            create.mock.restore();
            unlink.mock.restore();
            const entries = await Asset.find({}).lean();
            for (const asset of entries)
                await assertPrivate(await fs.promises.readFile(chat.attachmentPath(asset.storageName)));
        });
        await t.test('manual close persists retry inputs and closes even when report generation fails', async st => {
            const Profile = require('../server/dist/models/netProfile').getNetProfile();
            const profileDoc = await Profile.create({
                title: 'Privacy close test',
                frequency: '146.520',
                mode: 'FM',
                owners: [first]
            });
            const session = await Live.create({
                netProfile: profileDoc._id,
                netControl: first,
                url: '/close-test',
                lookupTable: {}
            });
            const oldMessage = await Message.create({
                liveNet: session._id,
                netProfile: profileDoc._id,
                userProfile: first,
                callSign: 'W1TA',
                text: 'keep for retry'
            });
            const { NetCloseReport } = require('../server/dist/lib/userNotification');
            const init = st.mock.method(NetCloseReport, 'init', async () => {
                throw new Error('report failed');
            });
            const { closeNet } = require('../server/dist/lib/sharedNetOps');
            const now = new Date();
            assert.equal(await closeNet({ netProfileDoc: profileDoc, liveNetDoc: session, closedAt: now }), true);
            assert.equal(await Live.exists({ _id: session._id }), null);
            assert.ok(await Message.exists({ _id: oldMessage._id }));
            const job = await Job.findOne({ liveNet: session._id });
            assert.equal(job.reportState, 'failed');
            assert.equal(job.reportInput.netProfileDoc.title, profileDoc.title);
            init.mock.restore();
            const retry = st.mock.method(NetCloseReport, 'init', async () => ({
                sendMailToUPIDs: async () => ({ accepted: ['test@example.test'] })
            }));
            await retention.processChatRetentionJob({
                liveNetId: session._id,
                now: new Date(now.getTime() + retention.RETRY_MS)
            });
            assert.equal((await Job.findOne({ _id: job._id })).reportState, 'sent');
            assert.ok(await Message.exists({ _id: oldMessage._id }));
            retry.mock.restore();
        });
        const closedAt = new Date('2030-01-01T00:00:00Z');
        const due = new Date(closedAt.getTime() + 7 * retention.DAY_MS);
        await t.test('quiet close retains seven days and active-session guard prevents cleanup', async () => {
            await retention.enqueueChatRetention({ liveNetId: live._id, netProfileId: profile, closedAt, quiet: true });
            const job = await Job.findOne({ liveNet: live._id });
            assert.equal(job.expiresAt.toISOString(), due.toISOString());
            assert.equal(job.reportState, 'skipped');
            assert.equal(await retention.processChatRetentionJob({ liveNetId: live._id, now: due }), false);
            assert.ok(await Message.exists({ liveNet: live._id }));
            await Live.deleteOne({ _id: live._id });
            await Job.updateOne({ _id: job._id }, { $set: { nextAttemptAt: closedAt } });
            assert.equal(
                await retention.processChatRetentionJob({ liveNetId: live._id, now: new Date(due - 1) }),
                true
            );
            assert.ok(await fs.promises.stat(chat.attachmentPath(stored.attachment.storageName)));
        });
        await t.test('reopened profile cannot read retained public/direct messages or image endpoints', async () => {
            const reopened = await Live.create({
                netProfile: profile,
                netControl: first,
                url: '/test',
                lookupTable: {}
            });
            for (const user of [first, second])
                await Interaction.create({
                    liveNet: reopened._id,
                    netProfile: profile,
                    userProfile: user,
                    callSign: 'W1TA',
                    role: 'netcontrol',
                    createdBy: 'user'
                });
            const messages = await invoke(chat.listMessages, req());
            assert.equal(messages.status, 200);
            assert.equal(messages.body.messages.length, 0);
            assert.equal(messages.body.directMessages.length, 0);
            assert.equal(
                (
                    await invoke(
                        chat.serveImage,
                        req(first, { params: { id: String(profile), messageId: String(stored._id) } })
                    )
                ).status,
                404
            );
            await Live.deleteOne({ _id: reopened._id });
        });
        await t.test(
            'unlink failure retains references and retries idempotently without deleting other sessions',
            async st => {
                const other = await Message.create({
                    liveNet: id(),
                    netProfile: profile,
                    userProfile: first,
                    callSign: 'W1TA',
                    text: 'other session'
                });
                const unlink = fs.promises.unlink;
                const failing = st.mock.method(fs.promises, 'unlink', async file => {
                    if (file === chat.attachmentPath(stored.attachment.storageName))
                        throw Object.assign(new Error('simulated'), { code: 'EACCES' });
                    return unlink.call(fs.promises, file);
                });
                assert.equal(await retention.processChatRetentionJob({ liveNetId: live._id, now: due }), false);
                assert.ok(await Message.exists({ _id: stored._id }));
                assert.ok(await Asset.exists({ storageName: stored.attachment.storageName }));
                assert.equal((await Job.findOne({ liveNet: live._id })).lastError, 'EACCES');
                failing.mock.restore();
                const retryAt = new Date(due.getTime() + retention.RETRY_MS);
                assert.equal(await retention.processChatRetentionJob({ liveNetId: live._id, now: retryAt }), true);
                assert.equal(await Message.countDocuments({ liveNet: live._id }), 0);
                assert.equal(await Asset.countDocuments({ liveNet: live._id }), 0);
                assert.ok(await Message.exists({ _id: other._id }));
                await assert.rejects(fs.promises.stat(chat.attachmentPath(stored.attachment.storageName)), {
                    code: 'ENOENT'
                });
                assert.equal(await retention.processChatRetentionJob({ liveNetId: live._id, now: retryAt }), false);
            }
        );
        await t.test(
            'failed reports extend retention, recover after restart and clean only after success',
            async () => {
                const session = id();
                await retention.enqueueChatRetention({
                    liveNetId: session,
                    netProfileId: profile,
                    closedAt,
                    quiet: false,
                    reportInput: { retryData: 'durable' },
                    recipientIds: [first]
                });
                let cleanups = 0;
                await retention.processChatRetentionJob({
                    liveNetId: session,
                    now: due,
                    deliverReport: async () => {
                        throw new Error('SMTP failure');
                    },
                    cleanup: async () => cleanups++
                });
                assert.equal(cleanups, 0);
                assert.equal((await Job.findOne({ liveNet: session })).reportInput.retryData, 'durable');
                const retryAt = new Date(due.getTime() + retention.RETRY_MS);
                await retention.processChatRetentionJob({
                    liveNetId: session,
                    now: retryAt,
                    deliverReport: async () => 'sent',
                    cleanup: async () => cleanups++
                });
                assert.equal(cleanups, 1);
                const completed = await Job.findOne({ liveNet: session });
                assert.ok(completed.completedAt);
                assert.equal(completed.reportInput, undefined);
            }
        );
        await t.test(
            'successful delivery never shortens the seven-day window, leases avoid duplicate workers',
            async () => {
                const session = id();
                let deliveries = 0,
                    cleanups = 0;
                await retention.enqueueChatRetention({
                    liveNetId: session,
                    netProfileId: profile,
                    closedAt,
                    quiet: false
                });
                const options = {
                    liveNetId: session,
                    now: closedAt,
                    deliverReport: async () => {
                        deliveries++;
                        return 'sent';
                    },
                    cleanup: async () => cleanups++
                };
                await Promise.all([
                    retention.processChatRetentionJob(options),
                    retention.processChatRetentionJob(options)
                ]);
                assert.equal(deliveries, 1);
                assert.equal(cleanups, 0);
                await retention.processChatRetentionJob({ ...options, now: due });
                assert.equal(deliveries, 1);
                assert.equal(cleanups, 1);
            }
        );
        await t.test('automatic quiet closes wait for the existing report outbox and requeue failures', async () => {
            const session = id();
            let cleanups = 0;
            const event = await Auto.create({
                liveNet: session,
                netProfile: profile,
                netTitle: 'Test',
                firstObservedAt: closedAt,
                closeState: 'completed',
                email: { state: 'failed' }
            });
            await retention.enqueueChatRetention({ liveNetId: session, netProfileId: profile, closedAt, quiet: true });
            await retention.processChatRetentionJob({ liveNetId: session, now: due, cleanup: async () => cleanups++ });
            assert.equal(cleanups, 0);
            assert.equal((await Auto.findById(event._id)).email.state, 'pending');
            await Auto.updateOne({ _id: event._id }, { $set: { 'email.state': 'sent' } });
            await retention.processChatRetentionJob({
                liveNetId: session,
                now: new Date(due.getTime() + retention.RETRY_MS),
                cleanup: async () => cleanups++
            });
            assert.equal(cleanups, 1);
        });
        await t.test(
            'ledger-owned orphans recover while unknown legacy files and active assets are preserved',
            async () => {
                const orphan = `${crypto.randomUUID()}.jpg`,
                    unknown = `${crypto.randomUUID()}.jpg`;
                await fs.promises.writeFile(chat.attachmentPath(orphan), await image());
                await fs.promises.writeFile(chat.attachmentPath(unknown), await image());
                await Asset.create({ liveNet: id(), netProfile: profile, storageName: orphan, createdAt: closedAt });
                const active = await Live.create({
                    netProfile: id(),
                    netControl: first,
                    url: '/test',
                    lookupTable: {}
                });
                const activeName = `${crypto.randomUUID()}.jpg`;
                await fs.promises.writeFile(chat.attachmentPath(activeName), await image());
                await Asset.create({
                    liveNet: active._id,
                    netProfile: active.netProfile,
                    storageName: activeName,
                    createdAt: closedAt
                });
                await retention.runChatRetentionPass({ now: due });
                await assert.rejects(fs.promises.stat(chat.attachmentPath(orphan)), { code: 'ENOENT' });
                assert.ok(await fs.promises.stat(chat.attachmentPath(unknown)));
                assert.ok(await fs.promises.stat(chat.attachmentPath(activeName)));
            }
        );
    } finally {
        await mongoose.disconnect();
        await database.cleanup();
        await fs.promises.rm(uploadDir, { recursive: true, force: true });
    }
});
