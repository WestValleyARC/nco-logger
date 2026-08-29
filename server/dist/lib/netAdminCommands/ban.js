/* hamlive-oss — MIT License. See LICENSE. */

const NetAdminCmd = require('../netAdminCmd');
const { wellFormedCall } = require('../serverUtils');
const { banUserHelper } = require('../localChat');

/**
 * Ban command - Bans a user from the net's chat
 * Usage: ban <callsign> <reason...>
 */
class BanCmd extends NetAdminCmd {
    constructor({ db, cs }) {
        super({
            label: 'ban',
            commandProperties: {
                cmd: 'ban',
                alias: [],
                verboseUsage: '(ban) ban a station from chat, usage: ban <callsign> <reason>',
                compactUsage: 'ban <callsign> <reason>',
                advanced: true,
                hidden: false,
                level: 0, // NCS only
                mustBeCheckedIn: false,
                minArgs: 2, // callsign + at least one word of reason
                maxArgs: 10, // Allow for multi-word reason
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
            throw new Error('ban: missing callsign');
        }
        if (!wellFormedCall(targetCallsign)) {
            throw new Error(`ban: malformed callsign: ${targetCallsign}`);
        }

        // Collect reason from remaining args (required)
        const reasonParts = this.parsedArgs._.slice(1);
        const reason = reasonParts.join(' ');

        // Find the target user's interaction to get their userProfile ID
        const targetCallsignUpper = targetCallsign.toUpperCase();
        const lookupEntry = this.data.instance.ln.lookupTable.get(targetCallsignUpper);
        if (!lookupEntry) {
            throw new Error(`ban: ${targetCallsign.toLowerCase()} is not in attendance`);
        }

        const targetInteraction = await this.data.model.StationInteraction.findById(lookupEntry.stationInteraction);
        if (!targetInteraction || !targetInteraction.userProfile) {
            throw new Error(`ban: ${targetCallsign.toLowerCase()} does not have an account`);
        }

        await banUserHelper({
            npid: this.npid,
            userIdToBan: targetInteraction.userProfile.toString(),
            bannedByUserId: req.user._id.toString(),
            targetCallsign: targetCallsign.toUpperCase(),
            moderatorCallsign: req.user.callSign.toUpperCase(),
            reason
        });

        return `${targetCallsign.toLowerCase()} banned from chat (reason: ${reason})`;
    }
}

module.exports = BanCmd;
