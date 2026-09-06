export const filterCuratedGifs = (gifs, category, query, offset = 0, limit = 40) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return gifs.filter(gif => {
        if (!normalizedQuery && category && gif.category !== category)
            return false;
        if (!normalizedQuery)
            return true;
        const searchable = [gif.title, gif.description, gif.category, ...gif.keywords]
            .join(' ').toLocaleLowerCase();
        return searchable.includes(normalizedQuery);
    }).slice(offset, offset + limit);
};
//# sourceMappingURL=chatGif.js.map