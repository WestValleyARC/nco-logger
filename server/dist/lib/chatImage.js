"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeChatImage = exports.detectImageType = exports.MAX_IMAGE_PIXELS = exports.IMAGE_TYPES = void 0;
const sharp_1 = __importDefault(require("sharp"));
sharp_1.default.cache(false);
sharp_1.default.concurrency(1);
exports.IMAGE_TYPES = Object.freeze({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp'
});
exports.MAX_IMAGE_PIXELS = 20_000_000;
const MAX_IMAGE_PAGES = 100;
let processing = 0;
const detectImageType = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12)
        return null;
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        return { mimeType: 'image/png', extension: 'png' };
    if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
        return { mimeType: 'image/jpeg', extension: 'jpg' };
    if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')))
        return { mimeType: 'image/gif', extension: 'gif' };
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP')
        return { mimeType: 'image/webp', extension: 'webp' };
    return null;
};
exports.detectImageType = detectImageType;
const invalid = () => Object.assign(new Error('Image could not be safely decoded or sanitized'), { status: 415 });
const sanitizeChatImage = async (input, maxBytes = 10 * 1024 * 1024) => {
    if (!input.length || input.length > maxBytes)
        throw invalid();
    const detected = (0, exports.detectImageType)(input);
    if (!detected)
        throw invalid();
    if (processing >= 2)
        throw Object.assign(new Error('Image processing is busy; please retry'), { status: 503 });
    processing++;
    try {
        if (detected.extension === 'png') {
            for (let offset = 8; offset + 12 <= input.length;) {
                const length = input.readUInt32BE(offset);
                if (input.subarray(offset + 4, offset + 8).toString('ascii') === 'acTL')
                    throw invalid();
                offset += length + 12;
            }
        }
        const decoder = (0, sharp_1.default)(input, { animated: true, limitInputPixels: exports.MAX_IMAGE_PIXELS, failOn: 'warning' });
        const metadata = await decoder.metadata();
        const formats = { png: 'png', jpg: 'jpeg', gif: 'gif', webp: 'webp' };
        if (metadata.format !== formats[detected.extension] ||
            !metadata.width ||
            !metadata.height ||
            metadata.width * metadata.height > exports.MAX_IMAGE_PIXELS ||
            (metadata.pages || 1) > MAX_IMAGE_PAGES)
            throw invalid();
        const pipeline = decoder.autoOrient().timeout({ seconds: 10 });
        switch (detected.extension) {
            case 'jpg':
                pipeline.jpeg({ quality: 95, chromaSubsampling: '4:4:4' });
                break;
            case 'png':
                pipeline.png();
                break;
            case 'gif':
                pipeline.gif({ reuse: false });
                break;
            case 'webp':
                pipeline.webp({ lossless: true });
                break;
        }
        const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
        if (data.length > maxBytes)
            throw Object.assign(new Error('Sanitized image exceeds the upload limit'), { status: 413 });
        return { data, ...detected, width: info.width, height: info.pageHeight || info.height };
    }
    catch (error) {
        if (error instanceof Error && 'status' in error)
            throw error;
        throw invalid();
    }
    finally {
        processing--;
    }
};
exports.sanitizeChatImage = sanitizeChatImage;
