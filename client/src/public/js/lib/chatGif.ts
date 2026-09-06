/* hamlive-oss — MIT License. See LICENSE. */

export interface CuratedGif {
    id: string;
    title: string;
    description: string;
    category: string;
    keywords: string[];
    thumbnailUrl: string;
    sourceUrl: string;
    creator: string;
    licenseName: string;
    licenseUrl: string;
    attributionText: string;
}

export const filterCuratedGifs = (
    gifs: CuratedGif[], category: string, query: string, offset = 0, limit = 40
): CuratedGif[] => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return gifs.filter(gif => {
        if (!normalizedQuery && category && gif.category !== category) return false;
        if (!normalizedQuery) return true;
        const searchable = [gif.title, gif.description, gif.category, ...gif.keywords]
            .join(' ').toLocaleLowerCase();
        return searchable.includes(normalizedQuery);
    }).slice(offset, offset + limit);
};
