/* hamlive-oss — MIT License. See LICENSE. */

const { logger } = require('../logger');
const PluginBase = require('../pluginBase');

class CloseIdleNetsTask extends PluginBase {
    constructor({ label, options, db }) {
        super({ label, options, db });
    }

    async run() {
        logger.info('Idle-net closure is handled by the recurring scheduling worker');
    }

    async cleanUp() {
        await super.cleanUp();
    }
}

module.exports = CloseIdleNetsTask;
