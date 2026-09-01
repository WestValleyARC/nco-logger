/* hamlive-oss — MIT License. See LICENSE. */

const { logger } = require('../logger');
const PluginBase = require('../pluginBase');
const { flagAccountForDeletion } = require('../../lib/sharedNetOps');
const { AccountInactivityWarning, emailEnabled } = require('../../lib/userNotification');

const daysBefore = (date, days) => new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
const yearsBefore = (date, years) => {
    const result = new Date(date);
    result.setUTCFullYear(result.getUTCFullYear() - years);
    return result;
};

const sendInactivityWarning = async userProfileDoc => {
    if (!emailEnabled) {
        logger.warn(`Inactivity warning not sent for ${userProfileDoc.id}: email delivery is disabled`);
        return false;
    }
    const email = new AccountInactivityWarning();
    await email.sendMailToAddrs([userProfileDoc.email]);
    return true;
};

async function processInactiveAccount({
    userProfileDoc,
    inactivityYears = 3,
    warningDays,
    now = new Date(),
    sendWarning = sendInactivityWarning,
    flagForDeletion = flagAccountForDeletion,
    db
}) {
    if (userProfileDoc.flaggedForDeletion) return 'already-flagged';

    const warningSentAt = userProfileDoc.inactivityWarningSentAt
        ? new Date(userProfileDoc.inactivityWarningSentAt)
        : null;

    if (warningSentAt && new Date(userProfileDoc.lastLogin) > warningSentAt) {
        userProfileDoc.inactivityWarningSentAt = null;
        userProfileDoc.deletionReason = null;
        await userProfileDoc.save({ validateBeforeSave: false });
        return 'warning-cancelled';
    }

    if (new Date(userProfileDoc.lastLogin) > yearsBefore(now, inactivityYears)) return 'active';

    if (!warningSentAt) {
        if (!(await sendWarning(userProfileDoc))) return 'warning-not-sent';
        userProfileDoc.inactivityWarningSentAt = now;
        userProfileDoc.deletionReason = null;
        await userProfileDoc.save({ validateBeforeSave: false });
        return 'warning-sent';
    }

    if (warningSentAt > daysBefore(now, warningDays)) return 'warning-period';

    await flagForDeletion({ userProfileDoc, deletionReason: 'inactivity', db });
    return 'eligible-for-deletion';
}

class FlagAccountsTask extends PluginBase {
    constructor({
        label,
        options,
        db,
        now = () => new Date(),
        sendWarning = sendInactivityWarning,
        flagForDeletion = flagAccountForDeletion
    }) {
        super({ label, options, db });
        this.now = now;
        this.sendWarning = sendWarning;
        this.flagForDeletion = flagForDeletion;
    }

    async run() {
        const now = this.now();
        const inactivityYears = Number(this.options.inactivity_years) || 3;
        const warningDays = Number(this.options.inactivity_warning_days) || 30;
        const inactiveAccounts = await this.data.model.UserProfile.find({
            lastLogin: {
                $lte: yearsBefore(now, inactivityYears)
            },
            policyConsent: true
        });

        const lackingConsent = await this.data.model.UserProfile.find({
            policyConsent: false
        });

        if (lackingConsent.length) {
            await Promise.all(lackingConsent.map(userProfileDoc => {
                if (now.getTime() - userProfileDoc.createdAt > this.options.account_create_min * 60 * 1000) {
                    return flagAccountForDeletion({
                        userProfileDoc,
                        deletionReason: 'missing-consent',
                        db: this.db
                    });
                }
                logger.warn(`Not flagging ${userProfileDoc.id} as its in creation grace period`);
            }));
        }

        if (inactiveAccounts.length) {
            await Promise.all(inactiveAccounts.map(userProfileDoc => processInactiveAccount({
                userProfileDoc,
                inactivityYears,
                warningDays,
                now,
                sendWarning: this.sendWarning,
                flagForDeletion: this.flagForDeletion,
                db: this.db
            })));
        }
    }

    async cleanUp() {
        await super.cleanUp();
    }
}

module.exports = FlagAccountsTask;
module.exports.processInactiveAccount = processInactiveAccount;
module.exports.yearsBefore = yearsBefore;
