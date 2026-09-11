/* hamlive-oss — MIT License. See LICENSE. */
const StationInteraction = require('../models/stationInteraction').getStationInteraction(null);
const UserProfile = require('../models/userProfile').getUserProfile(null);

const FIXTURE = 'josh-private';
const OWNER_CALLSIGN = 'KE7WIL';
const isPrivateTestNet = profile => profile?.testFixture === FIXTURE;
const userId = user => String(user?._id || user?.id || '');
const isOwner = (profile, user) => Boolean(profile?.owners?.some(id => String(id) === userId(user)));
const isInvited = (profile, user) => Boolean(profile?.invitedTesters?.some(id => String(id) === userId(user)));
const canAccess = (profile, user) => !isPrivateTestNet(profile) || isOwner(profile, user) || isInvited(profile, user);

const active = Array.from({ length: 24 }, (_, i) => ({
    callSign: `TST0${String.fromCharCode(65 + i)}`, name: `Test Operator ${i + 1}`, location: `Test Location ${i + 1}`
}));
const checkedOut = Array.from({ length: 5 }, (_, i) => ({
    callSign: `TST1${String.fromCharCode(65 + i)}`, name: `Checked Out ${i + 1}`, location: `Test Location ${i + 25}`
}));
const lurkers = Array.from({ length: 3 }, (_, i) => ({
    callSign: `TST2${String.fromCharCode(65 + i)}`, name: `Lurker ${i + 1}`, location: `Test Location ${i + 30}`
}));
const legacyFixtureCallSigns = [
    ...Array.from({ length: 24 }, (_, i) => `TST${String(i + 1).padStart(2, '0')}A`),
    ...Array.from({ length: 5 }, (_, i) => `TST${String(i + 1).padStart(2, '0')}X`),
    ...Array.from({ length: 3 }, (_, i) => `TST${String(i + 1).padStart(2, '0')}L`)
];
const fixtureCallSigns = new Set([...legacyFixtureCallSigns, ...active, ...checkedOut, ...lurkers].map(item => item.callSign || item));

async function resetFixture({ profile, liveNet, owner }) {
    if (!isPrivateTestNet(profile) || !liveNet || !isOwner(profile, owner)) return false;
    const old = await StationInteraction.find({ netProfile: profile._id, liveNet: liveNet._id, callSign: { $in: [...fixtureCallSigns] } });
    if (old.length) await StationInteraction.deleteMany({ _id: { $in: old.map(item => item._id) } });
    const now = new Date();
    const docs = [];
    for (const [items, checkedState] of [[active, true], [checkedOut, false], [lurkers, null]]) {
        for (const item of items) docs.push({
            ...item, displayName: item.name, participantProfile: { name: item.name, location: item.location },
            netProfile: profile._id, liveNet: liveNet._id, createdBy: 'admin', role: 'netuser', checkedState,
            checkedInAt: checkedState === true ? now : null, lastSeen: checkedState === null ? now : undefined,
            chatEnabled: false, qrzLookupStatus: 'skipped-local-profile', sigReports: { rst: {} }
        });
    }
    const created = await StationInteraction.insertMany(docs);
    const byCall = new Map(created.map(item => [item.callSign, item]));
    const real = await StationInteraction.find({ liveNet: liveNet._id, callSign: { $nin: [...fixtureCallSigns] } });
    const lookup = {};
    real.forEach(item => { lookup[item.callSign] = { stationInteraction: item._id }; });
    created.forEach(item => { lookup[item.callSign] = { stationInteraction: item._id }; });
    const realActive = real.filter(item => item.checkedState === true && item.callSign !== owner.callSign).map(item => item.callSign);
    const realOut = real.filter(item => item.checkedState === false).map(item => item.callSign);
    const realLurkers = real.filter(item => item.checkedState === null && item.callSign !== owner.callSign).map(item => item.callSign);
    liveNet.lookupTable = lookup;
    liveNet.loggerState = {
        ...(liveNet.loggerState || {}),
        order: [owner.callSign, ...active.map(item => item.callSign), ...realActive],
        checkedOutOrder: [...checkedOut.map(item => item.callSign), ...realOut],
        lurkerOrder: [...lurkers.map(item => item.callSign), ...realLurkers]
    };
    await liveNet.save();
    return true;
}

async function findRegistered(identifier) {
    const escaped = String(identifier || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escaped) return null;
    const exact = new RegExp(`^${escaped}$`, 'i');
    return UserProfile.findOne({ $or: [{ callSign: exact }, { email: exact }] });
}
module.exports = { FIXTURE, OWNER_CALLSIGN, isPrivateTestNet, isOwner, isInvited, canAccess, resetFixture, findRegistered };

async function accessMiddleware(req, res, next) {
    try {
        const NetProfile = require('../models/netProfile').getNetProfile(null);
        const profile = await NetProfile.findById(req.params.id).select('testFixture owners invitedTesters');
        if (!profile || canAccess(profile, req.user)) return next();
        return res.status(403).json({ endpointVersion: '1.0', errorMessage: 'This test net is invite-only' });
    } catch (err) { return next(err); }
}
module.exports.accessMiddleware = accessMiddleware;

async function ensureProfile() {
    const NetProfile = require('../models/netProfile').getNetProfile(null);
    const owner = await UserProfile.findOne({ callSign: OWNER_CALLSIGN });
    if (!owner) return null;
    let profile = await NetProfile.findOne({ testFixture: FIXTURE });
    if (!profile) {
        profile = await NetProfile.create({
            title: 'Test Net - Josh', netType: 'Ragchew', frequency: '147.3', mode: 'FM',
            owners: [owner._id], permanent: true, invisible: true, testFixture: FIXTURE,
            notes: 'Private invite-only test fixture. Synthetic stations reset when the owner opens the net.'
        });
    } else {
        profile.title = 'Test Net - Josh'; profile.owners = [owner._id]; profile.permanent = true; profile.invisible = true;
        await profile.save();
    }
    await UserProfile.updateOne({ _id: owner._id }, { $addToSet: { myNets: profile._id } });
    return profile;
}
module.exports.ensureProfile = ensureProfile;
