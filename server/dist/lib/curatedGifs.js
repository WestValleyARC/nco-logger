/* hamlive-oss — MIT License. See LICENSE. */

const fs = require('fs');
const path = require('path');

const GIF_ROOT = path.resolve(__dirname, '../../../assets/gifs');
const manifest = JSON.parse(fs.readFileSync(path.join(GIF_ROOT, 'metadata/manifest.json'), 'utf8'));
const gifsById = new Map(manifest.items
    .filter(item => item.verification_status === 'verified')
    .map(item => [item.id, Object.freeze(item)]));

const isCuratedGifId = value => typeof value === 'string'
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    && gifsById.has(value);

const getCuratedGif = value => isCuratedGifId(value) ? gifsById.get(value) : null;

const curatedGifPath = (value, thumbnail = false) => {
    const gif = getCuratedGif(value);
    if (!gif) return null;
    const directory = thumbnail ? 'thumbnails' : 'files';
    const filename = thumbnail ? gif.thumbnail_filename : gif.filename;
    return path.join(GIF_ROOT, directory, filename);
};

const publicGif = gif => ({
    id: gif.id,
    title: gif.title,
    description: gif.description,
    category: gif.category,
    keywords: gif.keywords,
    thumbnailUrl: `/api/chat/gifs/${gif.id}/thumbnail`,
    sourceUrl: gif.source_file_page_url,
    creator: gif.original_creator,
    licenseName: gif.license_name,
    licenseUrl: gif.license_url,
    attributionText: gif.attribution_text
});

const listCuratedGifs = () => [...gifsById.values()].map(publicGif);

module.exports = {
    GIF_ROOT,
    manifest,
    isCuratedGifId,
    getCuratedGif,
    curatedGifPath,
    publicGif,
    listCuratedGifs
};
