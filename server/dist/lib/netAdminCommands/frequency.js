/* hamlive-oss — MIT License. See LICENSE. */

const NetAdminCmd = require('../netAdminCmd');
const { logger } = require('../logger');

class FrequencyCmd extends NetAdminCmd {
    constructor({ db, cs }) {
        super({
            label: 'frequency',
            commandProperties: {
                cmd: 'f',
                alias: [],
                verboseUsage: '(f) change frequency, usage: f <new freq in MHz>',
                compactUsage: 'f <new MHz>',
                advanced: false,
                hidden: false,
                level: 0,
                mustBeCheckedIn: true,
                minArgs: 0,
                maxArgs: 1,
                deps: []
            },
            db,
            cs
        });
    }

    async run({ req, res, cmdLine }) {
        await super.run({ req, res, cmdLine });

        //This buffer % should come form flexOpts eventually (common between this file, presence.ts, liveNetController.js and realtimeClients.ts)
        const AWAY_BUFFER_PCT = 20;
        const pushIntervalSec = (res.locals.flexOpts.awayInMs * (1 - AWAY_BUFFER_PCT / 100)) / 1000; // 80% of awayInMs in seconds

        if (cmdLine.length === 0) {
            const frequency = this.data.instance.ln.frequency ?? this.data.instance.np.frequency;
            if (Boolean(frequency)) {
                return `${frequency} MHz`;
            } else {
                return 'No frequency set';
            }
        } else {
            const currentFrequency = this.data.instance.ln.frequency ?? this.data.instance.np.frequency;
            if (currentFrequency != cmdLine[0]) {
                await this.data.model.LiveNet.findOneAndUpdate(
                    { _id: this.data.instance.ln._id },
                    { frequency: cmdLine[0] },
                    { runValidators: true }
                );

                const frequency = Boolean(currentFrequency) ? currentFrequency : '(null)';
                const interval = pushIntervalSec ? `~${Math.round(pushIntervalSec)}sec` : '';

                return `${frequency}MHz -> ${cmdLine[0]}MHz (wait ${interval} for UI (low priority))`;
            } else {
                return 'Frequency unchanged';
            }
        }
    }
}

module.exports = FrequencyCmd;
