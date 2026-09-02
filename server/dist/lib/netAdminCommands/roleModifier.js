const CheckStateApplicator = require('./checkStateApplicator');
const { logger } = require('../logger');
const { getStationDetail, setNetRole, handoffNetControl } = require('../sharedNetOps');

class RoleModifier extends CheckStateApplicator {
    #targetRole;

    constructor({ db, cs, commandProperties, label, targetRole }) {
        super({ label, commandProperties, db, cs });

        if (!targetRole) {
            throw new Error(`RoleModifier: expected targetRole, got ${targetRole}`);
        }

        this.#targetRole = targetRole;
    }

    get targetRole() {
        return this.#targetRole;
    }

    async toggleOne(station, req) {
        try {
            const { role, level: targetRoleLevel } = await getStationDetail({
                lnid: this.data.instance.ln._id,
                station,
                db: this.db
            });

            if (req.user.callSign.toUpperCase() === station.toUpperCase()) {
                throw new Error(`${this.cmd}: cannot modify own role`);
            }

            if (this.myLevel >= targetRoleLevel) {
                throw new Error(`${this.cmd}: insufficient privileges (${this.myRole} < ${role})`);
            }

            const newRole = role !== this.targetRole ? this.targetRole : 'netuser';
            const isHandoff = this.myRole === 'netcontrol' && this.targetRole === 'netcontrol';

            if (isHandoff) {
                await this.#handoffNetControl(station, req);
            } else {
                await this.#setRole(station, newRole);
            }

            logger.info(`setNetRole: ${station.toUpperCase()}: ${role} ➔ ${newRole}`);
            return `${station}: ${role} ➔ ${newRole}`;
        } catch (error) {
            logger.error(`toggleOne error: ${error.message}`);
            throw error;
        }
    }

    async #setRole(station, newRole, session = null) {
        await setNetRole({
            lnid: this.data.instance.ln._id,
            station,
            newRole,
            db: this.db,
            session
        });
    }

    async #handoffNetControl(station, req) {
        const { present } = await this.getStationStates();
        const isPresent = present.some(
            ia => ia.callSign.toUpperCase() === station.toUpperCase() && ia.checkedState === true
        );
        if (!isPresent) {
            throw new Error(`${station} must be online and present here`);
        }
        logger.info(`${req.user.callSign} yielding to ${station.toUpperCase()}`);

        // Start a session for transaction
        const session = await this.db.startSession();
        logger.info('handoffNetControl(): start db transaction');
        session.startTransaction();
        try {
            await handoffNetControl({
                lnid: this.data.instance.ln._id,
                sourceStation: req.user.callSign,
                targetStation: station,
                db: this.db,
                session
            });

            logger.info('handoffNetControl(): commit db transaction');
            await session.commitTransaction();
        } catch (err) {
            logger.info('handoffNetControl(): abort db transaction');
            await session.abortTransaction();
            logger.error(`handoffNetControl transaction error: ${err.message}`);
            throw err;
        } finally {
            session.endSession();
        }
    }

    async run({ req, res, cmdLine }) {
        try {
            await super.run({ req, res, cmdLine });

            if (cmdLine.length === 0) {
                const initCapLabel = `${this.label.charAt(0).toUpperCase()}${this.label.slice(1)}`;
                const stationIds = [...this.data.instance.ln.lookupTable.values()].map(
                    value => value.stationInteraction
                );

                const interactions = await this.data.model.StationInteraction.find({
                    _id: { $in: stationIds }
                });

                const filteredCallSigns = interactions
                    .filter(ia => ia.role === this.targetRole && ia.checkedState === true)
                    .map(ia => ia.callSign.toLowerCase())
                    .join(', ');

                return `${initCapLabel}s: ${filteredCallSigns}`;
            } else {
                const dstStations = this.parsedArgs._;
                await this.applyCheckState({ dstStations, stateToApply: true });
                return (await Promise.all(dstStations.map(station => this.toggleOne(station, req)))).join(', ');
            }
        } catch (error) {
            logger.error(`run error: ${error.message}`);
            throw error;
        }
    }
}

module.exports = RoleModifier;
