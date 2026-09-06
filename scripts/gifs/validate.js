#!/usr/bin/env node
/* hamlive-oss — MIT License. See LICENSE. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const gifRoot = path.join(root, 'assets/gifs');

const parseGif = buffer => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 14 || !['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) {
        throw new Error('not a GIF');
    }
    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);
    let offset = 13;
    const packed = buffer[10];
    if (packed & 0x80) offset += 3 * (2 ** ((packed & 0x07) + 1));
    let frames = 0;
    let trailer = false;
    const skipSubBlocks = () => {
        while (offset < buffer.length) {
            const length = buffer[offset++];
            if (length === 0) return;
            offset += length;
            if (offset > buffer.length) throw new Error('truncated GIF data block');
        }
        throw new Error('unterminated GIF data block');
    };
    while (offset < buffer.length) {
        const marker = buffer[offset++];
        if (marker === 0x3b) { trailer = true; break; }
        if (marker === 0x21) {
            if (offset >= buffer.length) throw new Error('truncated GIF extension');
            offset += 1;
            skipSubBlocks();
            continue;
        }
        if (marker !== 0x2c || offset + 9 > buffer.length) throw new Error('invalid GIF block');
        const imagePacked = buffer[offset + 8];
        offset += 9;
        if (imagePacked & 0x80) offset += 3 * (2 ** ((imagePacked & 0x07) + 1));
        if (offset >= buffer.length) throw new Error('truncated GIF image');
        offset += 1;
        skipSubBlocks();
        frames += 1;
    }
    if (!trailer || width < 1 || height < 1 || frames < 1) throw new Error('incomplete GIF');
    return { width, height, frames };
};

const validateCatalog = () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(gifRoot, 'metadata/manifest.json'), 'utf8'));
    const errors = [];
    const verified = manifest.items.filter(item => item.verification_status === 'verified');
    if (verified.length !== 500) errors.push(`verified count is ${verified.length}, expected 500`);
    const required = [
        'id', 'filename', 'thumbnail_filename', 'title', 'description', 'category', 'keywords', 'source_url',
        'source_file_page_url', 'original_creator', 'license_name', 'license_url', 'attribution_text',
        'attribution_required', 'share_alike', 'date_retrieved', 'original_file_url', 'content_rating',
        'verification_status', 'sha256'
    ];
    const uniqueFields = ['id', 'filename', 'source_file_page_url', 'sha256'];
    const seen = Object.fromEntries(uniqueFields.map(field => [field, new Set()]));
    for (const item of verified) {
        for (const field of required) {
            if (item[field] === undefined || item[field] === null || item[field] === '') {
                errors.push(`${item.id || '(missing id)'}: missing ${field}`);
            }
        }
        if (!Array.isArray(item.keywords) || !item.keywords.length) errors.push(`${item.id}: missing keywords`);
        if (item.source_type !== undefined && !item.source_derivative_key) {
            errors.push(`${item.id}: footage derivative is missing its unique source interval`);
        }
        for (const field of ['source_url', 'source_file_page_url', 'license_url', 'original_file_url']) {
            try {
                if (new URL(item[field]).protocol !== 'https:') errors.push(`${item.id}: ${field} must use HTTPS`);
            } catch (_error) {
                errors.push(`${item.id}: invalid ${field}`);
            }
        }
        if (item.attribution_required && !String(item.attribution_text || '').trim()) {
            errors.push(`${item.id}: attribution is required but missing`);
        }
        for (const field of uniqueFields) {
            if (seen[field].has(item[field])) errors.push(`${item.id}: duplicate ${field}`);
            seen[field].add(item[field]);
        }
        if (path.basename(item.filename) !== item.filename || path.extname(item.filename).toLowerCase() !== '.gif') {
            errors.push(`${item.id}: unsafe GIF filename`);
            continue;
        }
        const filename = path.join(gifRoot, 'files', item.filename);
        const thumbnail = path.join(gifRoot, 'thumbnails', item.thumbnail_filename);
        if (!fs.existsSync(filename)) { errors.push(`${item.id}: GIF file missing`); continue; }
        if (!fs.existsSync(thumbnail)) errors.push(`${item.id}: thumbnail missing`);
        try {
            const data = fs.readFileSync(filename);
            const parsed = parseGif(data);
            const digest = crypto.createHash('sha256').update(data).digest('hex');
            if (digest !== item.sha256) errors.push(`${item.id}: SHA-256 mismatch`);
            if (parsed.frames < 2) errors.push(`${item.id}: GIF is not animated`);
            if (parsed.frames !== item.frame_count || parsed.width !== item.width || parsed.height !== item.height) {
                errors.push(`${item.id}: recorded GIF dimensions/frame count mismatch`);
            }
            if (data.length !== item.bytes) errors.push(`${item.id}: recorded size mismatch`);
        } catch (error) {
            errors.push(`${item.id}: ${error.message}`);
        }
    }
    const actual = fs.readdirSync(path.join(gifRoot, 'files')).filter(name => name.endsWith('.gif'));
    if (actual.length !== verified.length) errors.push(`found ${actual.length} GIF files for ${verified.length} records`);
    const derivativeKeys = verified.filter(item => item.source_derivative_key).map(item => item.source_derivative_key);
    if (new Set(derivativeKeys).size !== derivativeKeys.length) errors.push('duplicate source footage interval');
    return { manifest, verified, errors };
};

if (require.main === module) {
    const result = validateCatalog();
    if (result.errors.length) {
        result.errors.forEach(error => console.error(error));
        process.exitCode = 1;
    } else {
        const bytes = result.verified.reduce((sum, item) => sum + item.bytes, 0);
        console.log(`Validated ${result.verified.length} animated GIFs (${bytes} bytes)`);
    }
}

module.exports = { parseGif, validateCatalog };
