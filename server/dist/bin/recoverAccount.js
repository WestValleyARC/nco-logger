#!/usr/bin/env node
/* hamlive-oss — MIT License. See LICENSE. */

const mongoose = require('mongoose');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { recoveryPlan, executeRecovery, RecoveryError } = require('../lib/accountRecovery');

async function main() {
    const argv = yargs(hideBin(process.argv)).strict().exitProcess(false)
        .usage('$0 --database NAME --account-id ID --call-sign CALL --new-email EMAIL [--execute ...]')
        .option('database', { type: 'string', demandOption: true, describe: 'Exact target database name' })
        .option('account-id', { type: 'string', demandOption: true, describe: 'Original account ObjectId' })
        .option('call-sign', { type: 'string', demandOption: true, describe: 'Original callsign; never reassigned' })
        .option('new-email', { type: 'string', demandOption: true, describe: 'Verified replacement mailbox' })
        .option('execute', { type: 'boolean', default: false, describe: 'Commit recovery; default is read-only dry run' })
        .option('confirm', { type: 'string', describe: 'Exact dry-run confirmation digest' })
        .option('operator', { type: 'string', describe: 'Operator identity for the audit trail' })
        .option('case-ref', { type: 'string', describe: 'Support case reference' })
        .option('verification', { type: 'string', describe: 'How account ownership and mailbox control were independently verified (no secrets)' })
        .option('verified-owner', { type: 'boolean', default: false })
        .option('verified-new-email', { type: 'boolean', default: false })
        .option('maintenance-confirmed', { type: 'boolean', default: false, describe: 'All app and background-worker instances stopped; replacement deploy supports authVersion' })
        .help().parse();
    if (argv.help) return;
    // Explicit environment only: do not silently fall back to a development or production URI.
    if (!process.env.MONGODB_URI) throw new RecoveryError('Set MONGODB_URI using the deployment environment.');
    try {
        await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
        const request = {
            database: argv.database, accountId: argv.accountId, callSign: argv.callSign, newEmail: argv.newEmail,
            confirm: argv.confirm, operator: argv.operator, caseRef: argv.caseRef, verification: argv.verification,
            verifiedOwner: argv.verifiedOwner, verifiedNewEmail: argv.verifiedNewEmail,
            maintenanceConfirmed: argv.maintenanceConfirmed
        };
        if (argv.execute) {
            console.log(JSON.stringify({ committed: true, ...await executeRecovery(mongoose.connection, request) }, null, 2));
            console.log('Restart every app instance with session-version support. Request a fresh email sign-in link for the replacement mailbox.');
        } else {
            const { original, confirmation } = await recoveryPlan(mongoose.connection.db, request);
            console.log(JSON.stringify({ dryRun: true, database: argv.database, accountId: String(original._id),
                callSign: original.callSign, currentEmail: original.email, newEmail: request.newEmail,
                confirmation, changes: ['Replace email on original account', 'Clear previous Google ID',
                    'Revoke existing sessions and outstanding email sign-in links', 'Store atomic audit record with original profile'] }, null, 2));
            console.log('Nothing changed. Verify ownership and mailbox control independently; stop all app/worker instances before --execute.');
        }
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) main().catch(error => {
    console.error(error instanceof RecoveryError ? error.message : 'Recovery failed; no success was confirmed. Inspect the audit record before retrying. Check database connectivity, unique-email conflicts and replica-set transaction support.');
    process.exitCode = 1;
});
