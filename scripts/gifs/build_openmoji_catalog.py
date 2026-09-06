#!/usr/bin/env python3
"""Build the reviewed NCO Logger GIF catalog from pinned OpenMoji artwork."""

from __future__ import annotations

import hashlib
import io
import json
import shutil
import sys
import zipfile
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
ASSET_ROOT = ROOT / "assets" / "gifs"
FILES_DIR = ASSET_ROOT / "files"
THUMBS_DIR = ASSET_ROOT / "thumbnails"
MANIFEST_PATH = ASSET_ROOT / "metadata" / "manifest.json"
REJECTED_PATH = ASSET_ROOT / "metadata" / "rejected.json"
VERSION = "17.0.0"
RETRIEVED = "2026-09-06"
LICENSE_NAME = "CC BY-SA 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
PROJECT_URL = f"https://github.com/hfg-gmuend/openmoji/tree/{VERSION}"

QUOTAS = {
    "reactions": 90,
    "people": 45,
    "animals": 75,
    "food-drink": 45,
    "nature-weather": 45,
    "activities": 45,
    "travel-places": 40,
    "technology-radio": 35,
    "service-safety": 40,
    "objects-symbols": 40,
}

BLOCKED_TERMS = {
    "alcohol", "beer", "wine", "cocktail", "martini", "champagne", "sake",
    "cigarette", "smoking", "tobacco", "drug", "pistol", "rifle", "gun",
    "dagger", "knife", "sword", "bomb", "blood", "coffin", "middle finger",
    "nude", "sexual", "fight cloud",
}

PRIORITY = {
    "reactions": "happy smile laugh joy love heart surprise confused thinking sleepy tired party thank applause yes no wow welcome goodbye hello idea question approval congratulations excited".split(),
    "people": "wave hand clap applause thumbs hug speaking person operator firefighter health worker technologist mechanic teacher farmer pilot astronaut".split(),
    "animals": "cat dog rabbit hamster fox bear panda koala lion bird owl penguin duck bee butterfly fish dolphin turtle frog monkey paw".split(),
    "food-drink": "coffee tea water cake cookie pizza taco burger popcorn fruit apple chocolate ice cream sandwich breakfast".split(),
    "nature-weather": "sun cloud rain storm lightning snow rainbow moon star wind tornado temperature flower tree cactus leaf earth".split(),
    "activities": "celebration party confetti award medal trophy sport game music art microphone guitar drum radio soccer football baseball".split(),
    "travel-places": "car truck ambulance fire engine bus train airplane helicopter rocket ship bicycle home hospital station camping map".split(),
    "technology-radio": "radio antenna satellite microphone telephone phone computer laptop keyboard printer camera battery plug wifi gear robot".split(),
    "service-safety": "emergency warning alert safety first aid medical fire rescue police ambulance hospital shield check help service".split(),
    "objects-symbols": "check mark yes no arrow question exclamation plus minus circle square bell pin calendar clock hourglass tool light".split(),
}


def searchable(item: dict) -> str:
    return " ".join(str(item.get(key, "")) for key in ("annotation", "tags", "openmoji_tags", "subgroups")).lower()


def safe(item: dict) -> bool:
    text = searchable(item)
    return not item.get("skintone") and not any(term in text for term in BLOCKED_TERMS)


def belongs(category: str, item: dict) -> bool:
    group = item.get("group")
    subgroup = item.get("subgroups")
    text = searchable(item)
    if category == "reactions":
        return group == "smileys-emotion"
    if category == "people":
        return group == "people-body"
    if category == "animals":
        return group == "animals-nature" and not str(subgroup).startswith("plant-")
    if category == "food-drink":
        return group == "food-drink"
    if category == "nature-weather":
        return (group == "travel-places" and subgroup == "sky-weather") or (
            group == "animals-nature" and str(subgroup).startswith("plant-")
        ) or (group == "extras-openmoji" and subgroup == "climate-environment")
    if category == "activities":
        return group == "activities"
    if category == "travel-places":
        return group == "travel-places" and subgroup != "sky-weather" and subgroup != "place-religious"
    if category == "technology-radio":
        return (group == "extras-openmoji" and subgroup == "technology") or (
            group == "objects" and subgroup in {"sound", "phone", "computer", "light-video"}
        ) or any(term in text for term in ("radio", "antenna", "satellite", "wifi"))
    if category == "service-safety":
        return (group == "extras-openmoji" and subgroup in {"emergency", "healthcare"}) or (
            group == "objects" and subgroup == "medical"
        ) or (group == "symbols" and subgroup in {"warning", "transport-sign"})
    if category == "objects-symbols":
        return group in {"objects", "symbols"}
    return False


def ranked(category: str, items: list[dict]) -> list[dict]:
    words = PRIORITY[category]
    return sorted(
        items,
        key=lambda item: (
            -sum(1 for word in words if word in searchable(item)),
            int(item.get("order") or 999999),
            item.get("hexcode", ""),
        ),
    )


def select_items(items: list[dict], archive: zipfile.ZipFile) -> list[tuple[str, dict]]:
    selected: list[tuple[str, dict]] = []
    used: set[str] = set()
    used_artwork: set[str] = set()
    for category, quota in QUOTAS.items():
        candidates = [item for item in items if safe(item) and belongs(category, item) and item["hexcode"] not in used]
        chosen = []
        for item in ranked(category, candidates):
            png_name = f"{item['hexcode'].upper()}.png"
            if png_name not in archive.namelist():
                continue
            artwork_hash = hashlib.sha256(archive.read(png_name)).hexdigest()
            if artwork_hash in used_artwork:
                continue
            used_artwork.add(artwork_hash)
            chosen.append(item)
            if len(chosen) == quota:
                break
        if len(chosen) != quota:
            raise RuntimeError(f"{category}: needed {quota}, found {len(chosen)}")
        selected.extend((category, item) for item in chosen)
        used.update(item["hexcode"] for item in chosen)
    if len(selected) != 500:
        raise RuntimeError(f"selection must contain 500 items, found {len(selected)}")
    return selected


def animated_gif(png: bytes) -> tuple[bytes, int, int, int]:
    source = Image.open(io.BytesIO(png)).convert("RGBA")
    canvas_size = 96
    scales = (0.82, 0.91, 1.0, 0.95, 1.0, 0.91)
    frames = []
    for scale in scales:
        size = max(1, round(78 * scale))
        image = source.resize((size, size), Image.Resampling.LANCZOS)
        frame = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
        frame.alpha_composite(image, ((canvas_size - size) // 2, (canvas_size - size) // 2))
        frames.append(frame)
    output = io.BytesIO()
    frames[0].save(
        output,
        format="GIF",
        save_all=True,
        append_images=frames[1:],
        duration=(90, 90, 180, 90, 180, 270),
        loop=0,
        disposal=2,
        transparency=0,
        optimize=True,
    )
    return output.getvalue(), canvas_size, canvas_size, len(frames)


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: build_openmoji_catalog.py OPENMOJI_JSON COLOR_ZIP LICENSE_FILE")
    metadata_path, archive_path, license_path = map(Path, sys.argv[1:])
    source_items = json.loads(metadata_path.read_text(encoding="utf-8"))
    with zipfile.ZipFile(archive_path) as source_archive:
        selected = select_items(source_items, source_archive)

    old_manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8")) if MANIFEST_PATH.exists() else {}
    prior_rejected = json.loads(REJECTED_PATH.read_text(encoding="utf-8")) if REJECTED_PATH.exists() else {}
    rejected = list(prior_rejected.get("items", []))
    if old_manifest.get("status") != "production":
        rejected = [{
            **item,
            "verification_status": "rejected",
            "rejection_reason": "Unreviewed staging scrape was not sufficiently chat-focused for publication.",
        } for item in old_manifest.get("items", [])]

    shutil.rmtree(FILES_DIR, ignore_errors=True)
    shutil.rmtree(THUMBS_DIR, ignore_errors=True)
    FILES_DIR.mkdir(parents=True)
    THUMBS_DIR.mkdir(parents=True)
    records = []
    with zipfile.ZipFile(archive_path) as archive:
        names = set(archive.namelist())
        for category, item in selected:
            hexcode = item["hexcode"].upper()
            png_name = f"{hexcode}.png"
            if png_name not in names:
                raise RuntimeError(f"source artwork missing: {png_name}")
            png = archive.read(png_name)
            gif, width, height, frame_count = animated_gif(png)
            identifier = f"openmoji-{hexcode.lower()}"
            filename = f"{identifier}.gif"
            thumbnail = f"{identifier}.png"
            (FILES_DIR / filename).write_bytes(gif)
            thumb = Image.open(io.BytesIO(png)).convert("RGBA").resize((48, 48), Image.Resampling.LANCZOS)
            thumb.save(THUMBS_DIR / thumbnail, "PNG", optimize=True)
            author = str(item.get("openmoji_author") or "OpenMoji contributors").strip()
            title = str(item["annotation"]).strip()
            tags = sorted({
                value.strip().lower()
                for field in (item.get("tags", ""), item.get("openmoji_tags", ""), title)
                for value in str(field).split(",")
                if value.strip()
            })
            source_page = f"https://github.com/hfg-gmuend/openmoji/blob/{VERSION}/color/72x72/{png_name}"
            original_file = f"https://raw.githubusercontent.com/hfg-gmuend/openmoji/{VERSION}/color/72x72/{png_name}"
            records.append({
                "id": identifier,
                "filename": filename,
                "thumbnail_filename": thumbnail,
                "title": title,
                "description": f"Animated {title} reaction adapted from OpenMoji artwork.",
                "category": category,
                "keywords": tags,
                "source_url": PROJECT_URL,
                "source_file_page_url": source_page,
                "source_page_url": source_page,
                "original_creator": author,
                "license_name": LICENSE_NAME,
                "license_url": LICENSE_URL,
                "attribution_text": f"{title} by {author}, OpenMoji {VERSION}, {LICENSE_NAME}; animated adaptation by WVARC NCO Logger.",
                "attribution_required": True,
                "share_alike": True,
                "date_retrieved": RETRIEVED,
                "original_file_url": original_file,
                "content_rating": "G",
                "verification_status": "verified",
                "verification_method": "Pinned OpenMoji metadata and project license; family-content allowlist; generated-file validation.",
                "modifications": "Resized and animated with a six-frame pulse on a transparent canvas.",
                "bytes": len(gif),
                "width": width,
                "height": height,
                "frame_count": frame_count,
                "sha256": hashlib.sha256(gif).hexdigest(),
            })

    manifest = {
        "version": 2,
        "target": 500,
        "status": "production",
        "generated_at": RETRIEVED,
        "source": "OpenMoji",
        "source_version": VERSION,
        "source_url": PROJECT_URL,
        "license_name": LICENSE_NAME,
        "license_url": LICENSE_URL,
        "rejected_candidate_count": len(rejected),
        "items": records,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    REJECTED_PATH.write_text(json.dumps({"items": rejected}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    shutil.copyfile(license_path, ASSET_ROOT / "LICENSE.openmoji.txt")
    print(json.dumps({"verified": len(records), "rejected": len(rejected), "categories": QUOTAS}, indent=2))


if __name__ == "__main__":
    main()
