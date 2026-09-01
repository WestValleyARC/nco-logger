/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const { logger } = require('../lib/logger');
const { listPublicOccurrences } = require('../lib/scheduling/publicSchedule');

const ENDPOINT_VERSION = '1.0';

const scheduledOccurrenceList = async (req, res) => {
    try {
        const result = await listPublicOccurrences({
            window: req.query.window,
            timezone: req.query.timezone,
            start: req.query.start,
            limit: req.query.limit
        });
        return res.status(200).json({ endpointVersion: ENDPOINT_VERSION, ...result });
    } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500;
        if (status === 500) logger.error(error.stack);
        return res.status(status).json({
            endpointVersion: ENDPOINT_VERSION,
            errorMessage: status === 500 ? 'Scheduled nets could not be loaded' : error.message
        });
    }
};

module.exports = { scheduledOccurrenceList };
