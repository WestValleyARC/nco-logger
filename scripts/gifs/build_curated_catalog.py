#!/usr/bin/env python3
"""Build reaction GIFs from license-verified Commons footage plus selected OpenMoji icons."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


ROOT = Path(__file__).resolve().parents[2]
GIF_ROOT = ROOT / "assets" / "gifs"
FILES = GIF_ROOT / "files"
THUMBNAILS = GIF_ROOT / "thumbnails"
MANIFEST = GIF_ROOT / "metadata" / "manifest.json"
REJECTED = GIF_ROOT / "metadata" / "rejected.json"
SOURCES = Path(__file__).with_name("curated_sources.json")
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
RETRIEVED = "2026-09-06"
USER_AGENT = "WVARC-NCO-Logger-GIF-Curator/1.0 (https://github.com/WestValleyARC/nco-logger)"

LIVE_ALLOCATION = {
    "reactions": 10,
    "funny": 6,
    "celebration": 2,
    "classic-film": 7,
    "hello-goodbye": 2,
    "thanks-support": 3,
}
CARTOON_ALLOCATIONS = [
    {"animals": 14, "funny": 5, "celebration": 4, "classic-film": 5, "hello-goodbye": 2},
    {"animals": 14, "funny": 5, "celebration": 4, "classic-film": 5, "hello-goodbye": 2},
    {"animals": 12, "funny": 3, "celebration": 2, "classic-film": 2, "hello-goodbye": 1},
    {"funny": 4, "celebration": 12, "classic-film": 12, "hello-goodbye": 2},
    {"funny": 3, "celebration": 8, "classic-film": 6, "hello-goodbye": 3},
]
CATEGORY_TERMS = {
    "reactions": ["reaction", "laugh", "yes", "no", "wow", "what", "surprised", "confused", "thinking", "wait", "waiting", "agree", "disagree"],
    "funny": ["funny", "laugh", "comedy", "humor", "silly", "oops", "reaction"],
    "celebration": ["celebrate", "celebration", "congrats", "congratulations", "cheer", "dance", "applause", "clap", "good job"],
    "classic-film": ["classic", "film", "movie", "vintage", "silent film", "reaction", "scene"],
    "animals": ["animal", "cat", "funny animal", "cartoon", "reaction"],
    "hello-goodbye": ["hello", "hi", "welcome", "goodbye", "bye", "wave", "see you"],
    "thanks-support": ["thanks", "thank you", "support", "help", "appreciate", "good job", "you got this"],
    "radio-tech": ["radio", "ham", "amateur radio", "antenna", "signal", "communications", "technology"],
    "weather": ["weather", "storm", "lightning", "rain", "cloud", "forecast"],
    "animated-icons": ["icon", "emoji", "animated"],
}
LICENSE_URLS = {
    "Public domain": "https://creativecommons.org/publicdomain/mark/1.0/",
    "CC0": "https://creativecommons.org/publicdomain/zero/1.0/",
}
ALLOWED_LICENSE = re.compile(r"^(?:Public domain|CC0|CC BY(?:-SA)?(?: |$))", re.I)


def plain(value: object) -> str:
    text = re.sub(r"<[^>]+>", " ", html.unescape(str(value or "")))
    return re.sub(r"\s+", " ", text).strip()


def slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized[:52].rstrip("-")


def commons_metadata(titles: list[str]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for offset in range(0, len(titles), 10):
        params = urllib.parse.urlencode({
            "action": "query",
            "titles": "|".join(titles[offset:offset + 10]),
            "prop": "videoinfo",
            "viprop": "url|size|mime|derivatives|extmetadata",
            "format": "json",
            "formatversion": "2",
        })
        request = urllib.request.Request(f"{COMMONS_API}?{params}", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=90) as response:
            payload = json.load(response)
        for page in payload.get("query", {}).get("pages", []):
            if page.get("missing") or not page.get("videoinfo"):
                raise RuntimeError(f"Commons source missing: {page.get('title')}")
            result[page["title"]] = page["videoinfo"][0]
        time.sleep(0.2)
    return result


def download(url: str, destination: Path) -> None:
    if destination.exists() and destination.stat().st_size > 1024:
        return
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def derivative(info: dict) -> str:
    for item in info.get("derivatives", []):
        if item.get("transcodekey") == "240p.vp9.webm":
            return item["src"]
    raise RuntimeError(f"No 240p Commons derivative for {info.get('descriptionurl')}")


def gif_motion_score(filename: Path, minimum_mean: float = 35) -> float:
    image = Image.open(filename)
    frames = []
    try:
        for frame_index in range(min(getattr(image, "n_frames", 1), 20)):
            image.seek(frame_index)
            frames.append(image.convert("L").resize((80, 60)))
    except EOFError:
        pass
    if len(frames) < 8:
        return 0
    first_stats = ImageStat.Stat(frames[0])
    if first_stats.mean[0] < minimum_mean or first_stats.stddev[0] < 12:
        return 0
    return sum(ImageStat.Stat(ImageChops.difference(a, b)).mean[0] for a, b in zip(frames, frames[1:])) / (len(frames) - 1)


def render_clip(ffmpeg: Path, video: Path, start: float, destination: Path,
                minimum_mean: float = 35, minimum_motion: float = 1.25) -> bool:
    filters = (
        "fps=8,scale=240:-2:flags=lanczos,split[s0][s1];"
        "[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3"
    )
    command = [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", "2.5",
        "-i", str(video), "-an", "-filter_complex", filters, "-loop", "0", "-y", str(destination),
    ]
    subprocess.run(command, check=True)
    if destination.stat().st_size > 2_000_000 or gif_motion_score(destination, minimum_mean) < minimum_motion:
        destination.unlink(missing_ok=True)
        return False
    return True


def create_thumbnail(gif_path: Path, thumbnail_path: Path) -> tuple[int, int, int]:
    image = Image.open(gif_path)
    width, height = image.size
    frames = getattr(image, "n_frames", 1)
    preview = image.convert("RGB")
    preview.thumbnail((240, 150), Image.Resampling.LANCZOS)
    preview.save(thumbnail_path, "PNG", optimize=True)
    return width, height, frames


def category_sequence(allocation: dict[str, int]) -> list[str]:
    remaining = dict(allocation)
    sequence: list[str] = []
    while any(remaining.values()):
        for category in allocation:
            if remaining[category]:
                sequence.append(category)
                remaining[category] -= 1
    return sequence


def candidate_times(duration: float, wanted: int) -> list[float]:
    start = max(8.0, duration * 0.035)
    end = max(start + 3, duration * 0.965 - 2.5)
    if wanted <= 2:
        return [start + (end - start) * (index + 0.5) / 9 for index in range(9)]
    step = (end - start) / wanted
    primary = [start + step * (index + 0.5) for index in range(wanted)]
    fallbacks = [
        start + step * (index + offset)
        for offset in (0.2, 0.8)
        for index in range(wanted)
        if start + step * (index + offset) <= end - 2.5
    ]
    return primary + fallbacks


def license_details(info: dict) -> tuple[str, str, bool]:
    metadata = info.get("extmetadata", {})
    name = plain(metadata.get("LicenseShortName", {}).get("value"))
    if not ALLOWED_LICENSE.match(name) or any(term in name.lower() for term in ("noncommercial", "no derivatives", "gfdl")):
        raise RuntimeError(f"Rejected incompatible license {name!r} for {info.get('descriptionurl')}")
    url = plain(metadata.get("LicenseUrl", {}).get("value")) or LICENSE_URLS.get(name, "")
    if url.startswith("http://"):
        url = "https://" + url.removeprefix("http://")
    if not url.startswith("https://"):
        raise RuntimeError(f"Missing HTTPS license URL for {info.get('descriptionurl')}")
    required = plain(metadata.get("AttributionRequired", {}).get("value")).lower() == "true"
    return name, url, required


def retain_openmoji(old_manifest: dict, backup: Path) -> tuple[list[dict], list[dict]]:
    priorities = ["radio", "antenna", "satellite", "weather", "storm", "sun", "heart", "laugh", "applause", "thumb", "hello", "thanks", "warning"]
    icon_candidates = [item for item in old_manifest["items"] if item["id"].startswith("openmoji-")]
    ranked = sorted(icon_candidates, key=lambda item: (
        -sum(term in " ".join([item["title"], *item["keywords"]]).lower() for term in priorities),
        item["id"],
    ))
    retained = []
    if len(ranked) < 50:
        raise RuntimeError(f"Expected at least 50 OpenMoji records, found {len(ranked)}")
    for item in ranked[:50]:
        updated = dict(item)
        updated["category"] = "animated-icons"
        updated["keywords"] = sorted(set(item["keywords"] + CATEGORY_TERMS["animated-icons"]))
        shutil.copy2(backup / "files" / item["filename"], FILES / item["filename"])
        shutil.copy2(backup / "thumbnails" / item["thumbnail_filename"], THUMBNAILS / item["thumbnail_filename"])
        retained.append(updated)
    return retained, ranked[50:]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", type=Path, required=True)
    parser.add_argument("--cache", type=Path, default=Path("/tmp/nco-gif-source-cache"))
    args = parser.parse_args()
    if not args.ffmpeg.is_file():
        raise SystemExit(f"ffmpeg not found: {args.ffmpeg}")

    source_config = json.loads(SOURCES.read_text(encoding="utf-8"))
    source_titles = sum(source_config.values(), [])
    metadata = commons_metadata(source_titles)
    old_manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    old_rejected = json.loads(REJECTED.read_text(encoding="utf-8")) if REJECTED.exists() else {"items": []}
    args.cache.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="nco-gif-icons-") as temp:
        backup = Path(temp)
        shutil.copytree(FILES, backup / "files")
        shutil.copytree(THUMBNAILS, backup / "thumbnails")
        shutil.rmtree(FILES)
        shutil.rmtree(THUMBNAILS)
        FILES.mkdir()
        THUMBNAILS.mkdir()
        records, removed_icons = retain_openmoji(old_manifest, backup)

    plans: list[tuple[str, dict[str, int], str]] = []
    plans.extend((title, LIVE_ALLOCATION, "public-domain-film") for title in source_config["live_action"])
    plans.extend((title, CARTOON_ALLOCATIONS[index], "public-domain-film") for index, title in enumerate(source_config["cartoons"]))
    plans.extend((title, {"radio-tech": 1}, "licensed-footage") for title in source_config["radio"])
    plans.extend((title, {"weather": 1}, "licensed-footage") for title in source_config["weather"])

    source_counts: dict[str, int] = {}
    for title, allocation, source_type in plans:
        info = metadata[title]
        license_name, license_url, attribution_required = license_details(info)
        source_url = derivative(info)
        source_key = slug(title.removeprefix("File:").rsplit(".", 1)[0])
        video_path = args.cache / f"{source_key}.webm"
        print(f"Downloading/verifying {title}", flush=True)
        download(source_url, video_path)
        categories = category_sequence(allocation)
        times = candidate_times(float(info["duration"]), len(categories))
        metadata_fields = info.get("extmetadata", {})
        creator = plain(metadata_fields.get("Artist", {}).get("value")) or "Unknown Commons contributor"
        film_title = plain(metadata_fields.get("ObjectName", {}).get("value")) or title.removeprefix("File:")
        created = 0
        for start in times:
            if created >= len(categories):
                break
            category = categories[created]
            identifier = f"commons-{source_key[:38]}-{created + 1:02d}"
            gif_name = f"{identifier}.gif"
            gif_path = FILES / gif_name
            minimum_mean = 8 if category == "weather" else (15 if category == "radio-tech" else 35)
            minimum_motion = 0.15 if category == "weather" else (0.35 if category == "radio-tech" else 1.25)
            if not render_clip(args.ffmpeg, video_path, start, gif_path, minimum_mean, minimum_motion):
                continue
            thumbnail_name = f"{identifier}.png"
            width, height, frame_count = create_thumbnail(gif_path, THUMBNAILS / thumbnail_name)
            clip_end = round(start + 2.5, 3)
            source_page = info["descriptionurl"]
            label = category.replace("-", " ").title()
            number = source_counts.get(film_title, 0) + 1
            source_counts[film_title] = number
            attribution = f"{film_title} by {creator}; {license_name}; clip and GIF adaptation by WVARC NCO Logger."
            data = gif_path.read_bytes()
            records.append({
                "id": identifier,
                "filename": gif_name,
                "thumbnail_filename": thumbnail_name,
                "title": f"{label} — {film_title} {number}",
                "description": f"A short {label.lower()} moment adapted from {film_title}.",
                "category": category,
                "keywords": sorted(set(CATEGORY_TERMS[category] + [film_title.lower(), creator.lower()])),
                "source": f"Wikimedia Commons — {film_title}",
                "source_type": source_type,
                "source_url": source_page,
                "source_file_page_url": f"{source_page}#clip-{start:.3f}-{clip_end:.3f}",
                "source_page_url": source_page,
                "original_creator": creator,
                "license_name": license_name,
                "license_url": license_url,
                "attribution_text": attribution,
                "attribution_required": attribution_required,
                "share_alike": "BY-SA" in license_name.upper(),
                "date_retrieved": RETRIEVED,
                "original_file_url": source_url,
                "source_clip_start_seconds": round(start, 3),
                "source_clip_end_seconds": clip_end,
                "source_derivative_key": f"{source_page}@{start:.3f}-{clip_end:.3f}",
                "content_rating": "G/PG",
                "verification_status": "verified",
                "verification_method": "Commons file-page license metadata checked against allowlist; source interval and generated file validated; curated for family-friendly chat.",
                "modifications": "Extracted a 2.5-second silent segment, resized to 240px width, reduced to 8 fps and a 96-color palette, and encoded as a looping GIF.",
                "bytes": len(data),
                "width": width,
                "height": height,
                "frame_count": frame_count,
                "sha256": hashlib.sha256(data).hexdigest(),
            })
            created += 1
        if created != len(categories):
            raise RuntimeError(f"{title}: created {created} of {len(categories)} required clips")

    if len(records) != 500:
        raise RuntimeError(f"Expected 500 records, produced {len(records)}")
    categories = list(dict.fromkeys(item["category"] for item in records))
    if categories[0] != "animated-icons":
        raise RuntimeError("retained icon ordering changed unexpectedly")
    category_order = ["reactions", "funny", "celebration", "classic-film", "animals", "hello-goodbye", "thanks-support", "radio-tech", "weather", "animated-icons"]
    records.sort(key=lambda item: (category_order.index(item["category"]), item["id"]))
    revised_rejections = [{
        **item,
        "verification_status": "rejected",
        "rejection_reason": "Removed during content revision so animated emoji artwork no longer dominates the reaction-GIF catalog.",
    } for item in removed_icons]
    rejected_by_id = {item["id"]: item for item in old_rejected.get("items", [])}
    rejected_by_id.update({item["id"]: item for item in revised_rejections})
    rejected_items = list(rejected_by_id.values())
    manifest = {
        "version": 3,
        "target": 500,
        "status": "production",
        "generated_at": RETRIEVED,
        "source": "Wikimedia Commons and OpenMoji",
        "source_url": "https://commons.wikimedia.org/",
        "license_name": "Public Domain and Creative Commons",
        "license_url": "https://commons.wikimedia.org/wiki/Commons:Licensing",
        "default_category": "reactions",
        "categories": category_order,
        "rejected_candidate_count": len(rejected_items),
        "items": records,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    REJECTED.write_text(json.dumps({"version": 2, "items": rejected_items}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Built {len(records)} verified GIFs from {len(plans)} footage sources and OpenMoji", flush=True)


if __name__ == "__main__":
    main()
