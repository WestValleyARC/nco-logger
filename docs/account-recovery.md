# Operator account recovery

Use `server/dist/bin/recoverAccount.js` to replace a lost email on an existing account. This is a server CLI, not a public endpoint. It preserves the account ID, callsign, net ownership, favorites and history. It never moves callsigns, merges users or deletes a conflicting account.

## Verify before changing anything

A callsign, name, license lookup, QRZ listing, email claim or a radio transmission alone does not establish account ownership. These can be public or impersonated. Verify the claimant through an independently established relationship or trusted contact channel already known to the club. Do not rely solely on contact details supplied in the recovery request. If ownership remains uncertain, stop and escalate for independent review; do not perform recovery.

Separately verify control of the new mailbox, for example by sending a fresh challenge through your support mailbox and checking the reply. Do not ask the claimant to create a second Logger account: an existing account at the new email blocks recovery. Record a support case reference and a concise description of the checks. Keep identity documents, challenge codes and sensitive evidence in the restricted support case, not in CLI arguments or the database audit note.

The script requires verification attestations but cannot validate the human investigation. Anyone who has the database credentials already has powerful access; restrict shell access and credentials. The database audit is a recovery record, not a tamper-proof log against database administrators.

## Preview

Use the existing deployment environment; do not put MongoDB credentials in command arguments. The CLI reads only `MONGODB_URI`, with no fallback URI. Supply the exact database name and the original account's ObjectId, obtained through an operator database lookup. Email addresses appear in preview output: keep that output private.

This scoped, read-only lookup returns the account ID and current email for one callsign (replace `AB1CDE`):

```sh
COMPOSE_PROJECT_NAME=nco-logger docker compose exec -T app node -e '
const mongoose = require("mongoose");
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  console.log(await mongoose.connection.collection("userprofiles").findOne(
    { callSign: "AB1CDE" }, { projection: { _id: 1, callSign: 1, email: 1 } }
  ));
  await mongoose.disconnect();
})().catch(() => { console.error("Lookup failed"); process.exit(1); });'
```

For the Compose deployment (replace all example values):

```sh
COMPOSE_PROJECT_NAME=nco-logger docker compose exec -T app node server/dist/bin/recoverAccount.js \
  --database hamlive \
  --account-id 507f1f77bcf86cd799439011 \
  --call-sign AB1CDE \
  --new-email replacement@example.com
```

No writes occur without `--execute`. The preview shows the current and replacement email and a confirmation digest tied to the database, entire current profile and replacement email. A changed profile invalidates the digest, including intervening sign-ins. A wrong account ID/callsign pair is refused. Locked, privileged and deletion-pending profiles are refused for separate review. An email occupied by any other account, including a partial or deletion-pending one, is refused; do not delete that account blindly.

## Execute in a maintenance window

Deploy the version supporting `authVersion` sessions first. Stop **every** app and background worker using this database, including other hosts; this closes live streams and prevents in-flight login, profile or cleanup operations. `--maintenance-confirmed` is an operator attestation, not automatic process detection. Keep MongoDB running.

```sh
COMPOSE_PROJECT_NAME=nco-logger docker compose stop app
```

Take your normal database backup. Rerun the preview using `docker compose run --rm --no-deps app node ...` while the app is stopped. Review the resulting digest, then execute using the same deployment image:

```sh
COMPOSE_PROJECT_NAME=nco-logger docker compose run --rm --no-deps app \
  node server/dist/bin/recoverAccount.js \
  --database hamlive \
  --account-id 507f1f77bcf86cd799439011 \
  --call-sign AB1CDE \
  --new-email replacement@example.com \
  --execute --confirm DIGEST_FROM_PREVIEW \
  --operator YOUR_OPERATOR_ID --case-ref SUPPORT_CASE_ID \
  --verification 'Describe independent account-ownership and mailbox-control checks; no secrets' \
  --verified-owner --verified-new-email --maintenance-confirmed
```

The script requires replica-set transactions. In one transaction it stores the original profile and verification record in `accountrecoveries`, changes the email, clears the previous Google ID, advances `authVersion` and removes outstanding magic links for both addresses. Failure aborts the transaction. The normal unique email index must be present. Existing session rows may remain until expiry, but the application rejects their old authentication version.

Restart **all** instances on code that supports session versions:

```sh
COMPOSE_PROJECT_NAME=nco-logger docker compose up -d --wait app
```

Have the user request a fresh email sign-in link at the replacement address and confirm their original callsign and nets. Google sign-in can then reuse the account if its email matches. Do not send the user a session cookie or bypass link. Notify the former mailbox of the recovery through your support workflow when appropriate without revealing the new address.

Keep the audit ID in the support case. Do not revert to code that ignores `authVersion`: retained old sessions could become valid again. A mistaken recovery must be reviewed and corrected as a new recovery with another session-version increment; blindly restoring the old snapshot could restore revoked access. Ambiguous commit/network failures require checking `accountrecoveries` and the current profile before retrying.

This tool performs no production recovery until an operator explicitly supplies a verified case and executes it.
