# Curated Chat GIF Library

This directory contains the production NCO Logger curated GIF library.

- `files/` contains exactly 500 locally hosted animated GIF assets.
- `thumbnails/` contains compact static PNG previews used by the picker so browsing never downloads 500 animations.
- `metadata/manifest.json` records per-asset provenance, creator, license, attribution, source URLs, category, keywords, content rating, integrity hash, dimensions, frame count, and verification status.
- `metadata/rejected.json` preserves rejected catalog candidates and their rejection reasons.
- `LICENSE.openmoji.txt` is the full CC BY-SA 4.0 license governing the source artwork and animated adaptations.
- Do not bulk-copy arbitrary Google Images or hotlink remote GIFs.
- The catalog contains 450 short footage adaptations from individually verified Wikimedia Commons file pages and 50 animated icons derived from pinned OpenMoji 17.0.0 artwork.
- Each record contains its exact source page, source interval where applicable, creator, license, modification notes, and required attribution.

Run `npm run gifs:validate` to enforce the exact count, metadata, paths, uniqueness, hashes, dimensions, animation, and file integrity. The checked-in source list is `scripts/gifs/curated_sources.json`. To rebuild the mixed catalog from cached/downloaded Commons sources and the existing selected OpenMoji subset, run:

```sh
python3 scripts/gifs/build_curated_catalog.py --ffmpeg /path/to/ffmpeg
```

The builder queries current Commons file-page metadata and rejects sources outside its public-domain/Creative Commons allowlist. Footage is converted to short, silent, looping 240px GIFs; the selected icon derivatives remain under CC BY-SA 4.0. Run the validator after rebuilding and manually review the complete contact sheets before release.
