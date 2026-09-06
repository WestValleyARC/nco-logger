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
export declare const filterCuratedGifs: (gifs: CuratedGif[], category: string, query: string, offset?: number, limit?: number) => CuratedGif[];
//# sourceMappingURL=chatGif.d.ts.map