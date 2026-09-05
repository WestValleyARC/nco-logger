/* hamlive-oss — MIT License. See LICENSE. */

// To-do: Look at the new types created in types.ts. Lets make sure the controller and the sharedNetOps function conform to the new types
// Lets also modify the admin commands to work with any changes in sharedNetOps (specifically the hand, highlight, and checkState functions)
// Use the new Response Handler class to handle all responses in this controller

const { ResponseHandler } = require('../lib/responseUtils');
const NetProfile = require('../models/netProfile').getNetProfile(null);
const { getLiveNet } = require('../models/liveNet');
const LiveNet = getLiveNet(null);
const StationInteraction = require('../models/stationInteraction').getStationInteraction(null);
const netOp = require('../lib/sharedNetOps');
const { logger } = require('../lib/logger');
const { conf } = require('../lib/configLib');

const CommandSet = (() => {
    const commandMap = new Map();

    const createAliasMap = myLevelCmds => {
        const aliasMap = new Map();
        myLevelCmds.forEach(cmd => {
            for (const a of commandMap.get(cmd)?.alias) {
                if (!commandMap.get(cmd).alias.includes(cmd)) {
                    commandMap.get(cmd).alias.forEach(a => {
                        aliasMap.set(a, cmd);
                    });
                }
            }
        });
        return aliasMap;
    };

    const createCommandDetails = (myLevelCmds, aliasMap) => {
        return myLevelCmds
            .filter(cmd => !aliasMap.has(cmd))
            .map(cmd => {
                return {
                    command: cmd,
                    label: commandMap.get(cmd)?.label,
                    verboseUsage: commandMap.get(cmd)?.verboseUsage,
                    compactUsage: commandMap.get(cmd)?.compactUsage,
                    advanced: commandMap.get(cmd)?.advanced
                };
            });
    };

    return {
        usage(cmd) {
            if (commandMap.has(cmd)) {
                return commandMap.get(cmd).verboseUsage;
            } else {
                throw new Error(`no command or alias: ${cmd}`);
            }
        },

        register(CmdClass) {
            const cc = new CmdClass({ cs: this });

            for (let cmd of [cc.cmd, ...cc.alias]) {
                if (commandMap.has(cmd)) {
                    logger.error('cmd reg failed, cmd exists');
                    throw new Error(`cmd reg failed, '${cmd}' already exists in commandset`);
                } else {
                    commandMap.set(cmd, cc);
                }
            }
        },

        getMine(myLevel) {
            const myLevelCmds = Array.from(commandMap.keys()).filter(cmd => {
                const { level, hidden, minArgs } = commandMap.get(cmd);

                return level >= myLevel && !hidden;
            });

            const aliasMap = createAliasMap(myLevelCmds);
            const commandDetails = createCommandDetails(myLevelCmds, aliasMap);

            return {
                commandDetail: commandDetails,
                aliases: Array.from(aliasMap).map(pair => {
                    return { alias: pair[0], command: pair[1] };
                })
            };
        },

        validate() {
            let cmdList = Array.from(commandMap.keys());
            cmdList.forEach(cmd => {
                commandMap.get(cmd)?.deps?.forEach(dep => {
                    if (!cmdList.includes(dep)) {
                        throw new Error(`command [${cmd}] requires command [${dep}], which is missing in command set`);
                    }
                });
            });

            Object.freeze(commandMap);

            logger.debug(
                `registered: ${cmdList
                    .map(cmd => `[${cmd}]:L${commandMap.get(cmd)['level']}:${commandMap.get(cmd)['label']}`)
                    .join(', ')}`
            );
        },

        run(req, res, cmdLine = req.body.cmdLine) {
            // Check if cmdLine is provided and is a string
            if (!cmdLine || typeof cmdLine !== 'string') {
                throw new Error('cmdLine must be a string');
            }

            // Convert cmdLine to lower case, trim it, replace multiple consecutive spaces with a single space, and split it into words
            cmdLine = cmdLine
                .replace(/\s{2,}/g, ' ')
                .toLowerCase()
                .trim()
                .split(' ');
            const cmd = cmdLine.shift();

            if (commandMap.has(cmd)) {
                return commandMap.get(cmd).run({
                    req,
                    res,
                    cmdLine
                });
            } else {
                throw new Error(`no such command: ${cmd}`);
            }
        }
    };
})();

// Constants for action types
const ACTION_HAND = 'hand';
const ACTION_HIGHLIGHT = 'highlight';
const ACTION_CHECK_STATE = 'checkState';
const ACTION_SIG_REPORT = 'sigReport';

class Interaction {
    // Private fields
    #req; // request object
    #res; // response object
    #dstStation; // destination station
    #netProfile; // net profile document
    #liveNet; // live net document
    #sia; // source station interaction document
    #dia; // destination station interaction document

    // JavaScript does not support async constructors, so we use a static async method to create an instance of the class
    static async create(req, res, dstStation) {
        const netProfile = await NetProfile.findById(req.params.id);
        if (!netProfile) {
            throw new Error('NetProfile not found in Interaction-create()');
        }
        const liveNet = await LiveNet.findById(netProfile.liveNet);
        if (!liveNet) {
            throw new Error('LiveNet not found in Interaction-create()');
        }
        const sia = await StationInteraction.findById(
            liveNet.lookupTable.get(req.user.callSign.toUpperCase())?.stationInteraction
        );
        const dia = await StationInteraction.findById(
            liveNet.lookupTable.get(dstStation.toUpperCase())?.stationInteraction
        );
        if (!sia || !dia) {
            throw new Error('Source or dest interaction not found in Interaction-create()');
        }
        return new Interaction({ req, res, dstStation, netProfile, liveNet, sia, dia });
    }

    // Constructor
    constructor({ req, res, dstStation, netProfile, liveNet, sia, dia }) {
        // Assign parameters to private fields
        this.#req = req; // request object
        this.#res = res; // response object
        this.#dstStation = dstStation; // destination station
        this.#netProfile = netProfile; // net profile document
        this.#liveNet = liveNet; // live net document
        this.#sia = sia; // source station interaction document
        this.#dia = dia; // destination station interaction document

        // Set options for methods
        [ACTION_SIG_REPORT, ACTION_HAND, ACTION_CHECK_STATE, ACTION_HIGHLIGHT].forEach(action => {
            this[action].opts = { clientExecutable: true };
        });
    }
    // Calculate the average of the RST (Readability, Signal Strength, Tone) values
    #calculateAverage = (average, length, tNaN) => {
        // 'avg' is a helper function that calculates the average of a specific type of value (R|S|T) from multiple reports.
        // It takes the sum of RST values ('val') and the total number of valid reports ('len'), calculates the average, rounds it to a whole number, and converts it to a string.
        const avg = (val, len) => (len > 0 ? Math.round(val / len).toString() : '0');

        // The 'average' array holds the sum of Readability (R), Signal Strength (S), and Tone (T) values.
        // We calculate the average of these values using the 'avg' function, which divides the sum by the number of reports and rounds the result.
        // For R and S (when the index is not 2), we use the total number of reports as the divisor.
        // For T (when the index is 2), we use the number of valid T reports as the divisor, as not all reports may include a valid T value.
        // The result is an array of average R, S, and T values, which we destructure into 'avg0', 'avg1', and 'avg2' for further processing.
        const [avg0, avg1, avg2] = average.map((val, i) => avg(val, i === 2 ? length - tNaN : length));

        // The 'average' array holds the sum of Readability (R), Signal Strength (S), and Tone (T) values.
        // If the sum of Tone (T) values (average[2]) is NaN or 0, it indicates no valid T values were reported.
        // In this case, the average RST report is calculated using only R and S values, hence we return the sum of 'avg0' and 'avg1'.
        // If the sum of T values is a valid number and not 0, it indicates valid T values were reported.
        // In this case, the average RST report is calculated using R, S, and T values, hence we return the sum of 'avg0', 'avg1', and 'avg2'.
        return isNaN(average[2]) || average[2] === 0 ? avg0 + avg1 : avg0 + avg1 + avg2;
    };

    // Check if sigReports are restricted
    #checkSigReportsRestricted = async () => {
        const netRoleDetail = await netOp.getStationDetail({
            lnid: this.#liveNet._id,
            station: this.#req.user.callSign.toUpperCase()
        });
        if (!netRoleDetail) {
            throw new Error('NetRoleDetail (role & level) not found in Interaction-#checkSigReportsRestricted()');
        }
        if (this.#netProfile.restrictedSigReports && netRoleDetail.level !== 0) {
            throw new Error(`sigReports are restricted to NCS only`);
        }
    };

    // Check if destination station is the same as user's station
    #checkDstStation = () => {
        if (this.#dstStation.toUpperCase() === this.#req.user.callSign.toUpperCase()) {
            throw new Error('Cannot submit sigreport for own station');
        }
    };

    // Update sigReports
    #updateSigReports = ({ r, s, t }) => {
        if (typeof r !== 'number' || typeof s !== 'number' || (t !== undefined && typeof t !== 'number')) {
            throw new Error('Invalid RST values -- expected numbers in Interaction-#updateSigReports()');
        }
        this.#dia.sigReports.rst.set(this.#req.user.callSign.toUpperCase(), { r, s, t });
    };

    // This method calculates the average signal reports for the current interaction document.
    // It starts by initializing a counter (tNaN) to track the number of invalid Tone values.
    // It then creates an array from the current RST reports and reduces it to a single value.
    // During the reduction:
    // - If the Tone value (v.t) is not a number (NaN), the counter (tNaN) is incremented.
    // - The new array returned by the reducer function contains the sum of the corresponding RST values and the current RST value from the report.
    // - If the Tone value (v.t) from the report is NaN, the current sum of Tone values is retained (i.e., the Tone value is not added to the sum).
    // - If the Tone value (v.t) from the report is not NaN, it is added to the current sum of Tone values.
    // After reducing the array of RST reports to a single value (average), it calculates the average RST report.
    // The calculateAverage method is called with the sum of RST values, the total number of reports, and the number of invalid Tone values (tNaN).
    // The calculated average RST report is then assigned to the 'calculated' field of the signal reports.
    #calculateSigReports = () => {
        let tNaN = 0;
        const average = Array.from(this.#dia.sigReports.rst).reduce(
            (sum, [, v]) => {
                isNaN(v.t) && tNaN++;
                return [sum[0] + v.r, sum[1] + v.s, isNaN(v.t) ? sum[2] : sum[2] + v.t];
            },
            [0, 0, 0]
        );
        this.#dia.sigReports.calculated = this.#calculateAverage(average, this.#dia.sigReports.rst.size, tNaN);
    };

    // This method modifies the calculated signal report to fit the expected length based on the current mode of operation.
    // For example, in LSB mode, the report is 'RS' (2 characters), in CW mode it's 'RST' (3 characters), and in PSK31 mode it's 'RSQ' (3 characters).
    // It uses the 'getSigReportType' method from 'netOp' to find the expected report type for the current mode, using a mapping of report types by mode.
    // If the calculated report is longer than expected, it's trimmed to the correct length.
    #adjustSigReportLength = () => {
        const sigReportType = netOp.getSigReportType({
            mode: this.#netProfile.mode,
            sigReportTypeByMode: this.#res.locals.flexOpts.sigReportTypeByMode
        });
        if (sigReportType && this.#dia.sigReports.calculated.length > sigReportType.length) {
            this.#dia.sigReports.calculated = this.#dia.sigReports.calculated.slice(0, sigReportType.length);
        }
    };

    // Save destination station interaction document
    #saveData = async () => {
        await this.#dia.save();
    };

    // This method handles the ACTION_SIG_REPORT action.
    // It accepts an object as an argument, which contains the Readability (R), Signal Strength (S), and Tone (T) values from the POSTed signal report.
    async [ACTION_SIG_REPORT]({ r, s, t }) {
        // Check if signal reports are restricted to NCS-only.
        await this.#checkSigReportsRestricted();

        // Check if the destination station is not own station.
        this.#checkDstStation();

        // Update the signal reports with the provided R, S, and T values.
        this.#updateSigReports({ r, s, t });

        // Calculate the average signal reports.
        this.#calculateSigReports();

        // Adjust the length of the calculated signal report to match the expected length for the current mode of operation.
        // LSB == RS == 2 characters, CW == RST == 3 characters, PSK31 == RSQ == 3 characters
        this.#adjustSigReportLength();

        // Save the updated destination station interaction document.
        await this.#saveData();

        // Return an object that includes the calculated signal report.
        return { calculated: this.#dia.sigReports.calculated };
    }

    // Check parameters for simple interaction wrapper
    #checkParams = (state, action) => {
        if (typeof state !== 'boolean') {
            throw new Error(`INTERACTION_Controller: ${action}: State must be a boolean`);
        }
        if (typeof action !== 'string') {
            throw new Error(`INTERACTION_Controller: Action must be a string`);
        }
        if (!(action in netOp)) {
            throw new Error(`INTERACTION_Controller: ${action} is not a valid net operation`);
        }
    };

    // Create parameters for simple interactions for simple interaction wrapper
    #createParams = (action, state) => {
        const baseParams = {
            liveNet: this.#liveNet,
            srcStation: this.#req.user.callSign.toUpperCase(),
            dstStation: this.#dstStation.toUpperCase(),
            state
        };

        return action === 'checkState'
            ? { ...baseParams, dstStations: [this.#dstStation], highlight: false, flexOpts: this.#res.locals.flexOpts }
            : baseParams;
    };

    // Wrap simple interactions
    async simpleInteractionWrapper(state, action) {
        // Check if the state is a boolean and the action is a string and confirm the action is a valid net operation.
        this.#checkParams(state, action);
        logger.debug(
            `INTERACTION_Controller: ${action}: ${this.#req.user.callSign.toUpperCase()} -> ${this.#dstStation.toUpperCase()} ${state}`
        );
        const params = this.#createParams(action, state);
        return { [action]: await netOp[action](params) };
    }

    // Handle a hand interaction
    async [ACTION_HAND]({ state }) {
        return this.simpleInteractionWrapper(state, ACTION_HAND);
    }

    // Handle a highlight interaction
    async [ACTION_HIGHLIGHT]({ state }) {
        return this.simpleInteractionWrapper(state, ACTION_HIGHLIGHT);
    }

    // Handle a check state interaction
    async [ACTION_CHECK_STATE]({ state }) {
        return this.simpleInteractionWrapper(state, ACTION_CHECK_STATE);
    }
}
// CommandSet Init:
//
// Iterate over all the commands in the configuration. This is the first step in initializing the CommandSet.
Object.keys(conf.netadmin_commands).forEach(cmd => {
    try {
        // Check if the command is enabled in the configuration. This is part of the conditional logic that determines which commands get registered to the CommandSet.
        if (conf.netadmin_commands[cmd].enabled) {
            // Register the command to the CommandSet. This is done by requiring the command module from the specified directory and passing it to the CommandSet's register method.
            CommandSet.register(require(`../lib/netAdminCommands/${cmd}`));
        } else {
            // If the command is not enabled, log a warning. This is part of the feedback mechanism that informs about the commands that are disabled and hence not added to the CommandSet.
            logger.warn(`net cmd: ${cmd}: [disabled]`);
        }
    } catch (err) {
        // If an error occurs while loading the command module or registering it to the CommandSet, log an error. This is part of the error handling mechanism during the CommandSet initialization.
        logger.error(`Error loading command ${cmd}: ${err.stack}`);
    }
});

try {
    // Validate the command set to ensure all commands are correctly registered. This is the final step in the CommandSet initialization where it checks for any inconsistencies or errors in the registered commands.
    CommandSet.validate();
} catch (err) {
    // If an error occurs during the validation of the CommandSet, log an error. This is part of the error handling mechanism during the CommandSet validation.
    logger.error(`Error validating command set: ${err.stack}`);
}

//API Endpoint processors below:

// Commandline Processor:
async function adminCommandProcessor(req, res) {
    const handleResponse = new ResponseHandler({ ttlMs: res.locals.flexOpts.baseTtlMs });
    try {
        // If the command runs successfully, send a 200 response with the result
        handleResponse.sendResponse(res, 'OK', { message: await CommandSet.run(req, res) });
    } catch (err) {
        // If an error occurs, send a 500 response with the error message

        handleResponse.sendError(res, 'INTERNAL_SERVER_ERROR', err.message);

        // Log the error. If the error is "no such command", log a warning. Otherwise, log an error.
        if (err.message.includes('no such command')) {
            logger.warn(err.message);
        } else {
            logger.error(err.stack);
        }
    }
}

// This function returns commands available to the user based on their role and level
async function adminCommandList(req, res) {
    const handleResponse = new ResponseHandler({ ttlMs: res.locals.flexOpts.baseTtlMs });

    try {
        // Fetch the liveNet id from the NetProfile
        const netProfile = await NetProfile.findById(req.params.id);
        const lnid = netProfile.liveNet;

        // Fetch the role and level details for the user's station
        const { role, level } = await netOp.getStationDetail({
            lnid,
            station: req.user.callSign
        });

        // Log the action of sending command list
        logger.debug(`INTERACTIONS_Controller sending command list to ${req.user.callSign}`);

        // Send the response object with a 200 status
        handleResponse.sendResponse(res, 'OK', {
            ...CommandSet.getMine(level),
            role,
            level
        });
    } catch (err) {
        // Check if the error is a CastError and starts with a specific string
        const isCastError =
            err.name === 'CastError' &&
            err.reason.toString().startsWith('TypeError: Argument passed in must be a Buffer or string');
        // Set the error message based on whether it's a CastError
        const errorMessage = isCastError ? 'make sure id param is correct / exists' : err.message;

        // If it's a CastError, log an error message
        if (isCastError) {
            logger.error(`make sure id param ${req.params.id} is correct`);
        }

        // Send a 500 status response with the error message
        handleResponse.sendError(res, 'INTERNAL_SERVER_ERROR', errorMessage);

        // Log the error stack
        logger.error(err.stack);
    }
}

// Handle events (larglely the result of UI interaction) that are sent to the server
// from the client (e.g. sigReport, hand, highlight, checkState)
async function stationEventProcessor(req, res) {
    const handleResponse = new ResponseHandler({ ttlMs: res.locals.flexOpts.baseTtlMs });

    try {
        // Check if action and dstStation are provided and are strings
        if (!req.body.action || typeof req.body.action !== 'string') {
            throw new Error('action must be a string');
        }
        if (!req.body.dstStation || typeof req.body.dstStation !== 'string') {
            throw new Error('dstStation must be a string');
        }

        // Trim the action and destination station from the request body
        const action = req.body.action.trim();
        const dstStation = req.body.dstStation.trim();

        // Check if actionParams is provided and is an object
        if (!req.body.actionParams || typeof req.body.actionParams !== 'object') {
            throw new Error('actionParams must be an object');
        }

        // Create a new Interaction and throw an error if it fails
        const iao = await Interaction.create(req, res, dstStation);
        if (!iao) {
            throw new Error('constructor Interaction.create() failed to instantiate iao');
        }

        // Check if the action is client executable
        if (iao[action]?.opts?.clientExecutable) {
            // Log the action execution
            logger.info(
                `INTERACTION_Controller: Executing:\t${action.toUpperCase()}(${JSON.stringify(
                    req.body.actionParams
                )} : src ${req.user.callSign.toUpperCase()} dst ${dstStation.toUpperCase()})`
            );

            // Execute the action and send the result with a 200 status
            handleResponse.sendResponse(res, 'OK', { message: await iao[action](req.body.actionParams) });
        } else {
            throw new Error(`no such client-executable action:${action}`);
        }
    } catch (err) {
        const authorizationFailure = err.message === 'sigReports are restricted to NCS only';
        handleResponse.sendError(res, authorizationFailure ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR', err.message);

        // Log the error stack
        logger.error(err.stack);
    }
}
module.exports = {
    stationEventProcessor,
    adminCommandProcessor,
    adminCommandList
};
