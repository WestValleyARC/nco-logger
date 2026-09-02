/* hamlive-oss — MIT License. See LICENSE. */

const apiNotFound = (_req, res) => {
    if (res.headersSent) return;
    return res.status(404).json({ error: 'Not Found' });
};

module.exports = { apiNotFound };
