/* hamlive-oss — MIT License. See LICENSE. */

const NetAdminCmd = require('../netAdminCmd');
const { wellFormedCall } = require('../serverUtils');
const { unbanUserHelper } = require('../localChat');

/**
 * Unban command - Unbans a user from the net's chat
 * Usage: unban <callsign>
 */
class UnbanCmd extends NetAdminCmd {
    constructor({ db, cs }) {
        super({
            label: 'unban',
            commandProperties: {
                cmd: 'unban',
                alias: [],
                verboseUsage: '(unban) unban a station from chat, usage: unban <callsign>',
                compactUsage: 'unban <callsign>',
                advanced: true,
                hidden: false,
                level: 0, // NCS only
                mustBeCheckedIn: false,
                minArgs: 1,
                maxArgs: 1,
                deps: []
            },
            db,
            cs
        });
    }

    async run({ req, res, cmdLine }) {
        await super.run({ req, res, cmdLine });

        const targetCallsign = this.parsedArgs._[0];
        if (!targetCallsign) {
            throw new Error('unban: missing callsign');
        }
        if (!wellFormedCall(targetCallsign)) {
            throw new Error(`unban: malformed callsign: ${targetCallsign}`);
        }

        // Find the target user's interaction to get their userProfile ID
        const targetCallsignUpper = targetCallsign.toUpperCase();
        const lookupEntry = this.data.instance.ln.lookupTable.get(targetCallsignUpper);
        if (!lookupEntry) {
            throw new Error(`unban: ${targetCallsign.toLowerCase()} is not in attendance`);
        }

        const targetInteraction = await this.data.model.StationInteraction.findById(lookupEntry.stationInteraction);
        if (!targetInteraction || !targetInteraction.userProfile) {
            throw new Error(`unban: ${targetCallsign.toLowerCase()} does not have an account`);
        }

        await unbanUserHelper({
            npid: this.npid,
            userIdToUnban: targetInteraction.userProfile.toString(),
            targetCallsign: targetCallsign.toUpperCase(),
            moderatorCallsign: req.user.callSign.toUpperCase()
        });

        return `${targetCallsign.toLowerCase()} unbanned from chat`;
    }
}

module.exports = UnbanCmd;
