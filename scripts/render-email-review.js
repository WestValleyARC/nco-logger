/* Render deterministic email examples to a developer-selected directory. No email is sent. */
const fs = require('fs');
const path = require('path');
const { conf } = require('../server/dist/lib/configLib');

const outputDirectory = process.argv[2];
if (!outputDirectory) throw new Error('Usage: node scripts/render-email-review.js <output-directory>');

conf.base_url = process.env.BASE_URL || 'https://logger.westvalleyarc.com';
conf.email_from = conf.email_from || 'NCO Logger <logger@westvalleyarc.com>';
conf.email_reply_to = conf.email_reply_to || 'logger@westvalleyarc.com';
// Some shared server modules construct (but do not connect) a Mongo client while loading.
conf.dburi = conf.dburi || 'mongodb://127.0.0.1:27017/nco_logger_email_review';

const { buildEmailReviewFixtures } = require('../test/fixtures/email-review-fixtures');

const main = async () => {
    const fixtures = await buildEmailReviewFixtures();
    fs.mkdirSync(outputDirectory, { recursive: true });
    const manifest = fixtures.map(fixture => {
        fs.writeFileSync(path.join(outputDirectory, `${fixture.id}.html`), fixture.html);
        fs.writeFileSync(path.join(outputDirectory, `${fixture.id}.txt`), fixture.text);
        return {
            id: fixture.id,
            subject: fixture.subject,
            from: fixture.from,
            replyTo: fixture.replyTo,
            to: fixture.to,
            links: fixture.links,
            attachments: fixture.attachments,
            html: `${fixture.id}.html`,
            text: `${fixture.id}.txt`
        };
    });
    fs.writeFileSync(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`Rendered ${fixtures.length} email examples to ${path.resolve(outputDirectory)}\n`);
};

main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
