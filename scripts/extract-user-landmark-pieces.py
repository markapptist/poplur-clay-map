#!/usr/bin/env python3
"""Extract the six user-approved Poplur landmark pieces from their source sheet.

The source is archived verbatim, then each landmark is cut out with a
border-connected black matte.  This preserves the deliberately black plinths
and outlines that a global colour key would erase.  Two deterministic sizes
are emitted: 96 px for the world overview and 320 px for the zoom thumb.
"""

from __future__ import annotations

import argparse
from collections import deque
from hashlib import sha256
import json
from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ARCHIVED_SOURCE = ROOT / "scripts/landmark-art/source/user-landmark-gamepieces.png"
OUTPUT_DIR = ROOT / "public/sprites/world-landmarks/pieces"
MANIFEST_PATH = ROOT / "src/worldLandmarkPieceManifest.json"

# Coordinates are right/bottom exclusive and deliberately do not overlap.
CROPS: dict[str, tuple[int, int, int, int]] = {
    "cn-tower": (0, 32, 390, 733),
    "eiffel": (390, 32, 790, 733),
    "statue-liberty": (790, 32, 1183, 733),
    "big-ben": (0, 733, 380, 1329),
    "sydney-opera": (380, 733, 780, 1329),
    "golden-gate": (780, 733, 1183, 1329),
}


def file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def border_connected_background(rgb: np.ndarray) -> np.ndarray:
    """Return the near-black background connected to any crop edge."""

    height, width, _ = rgb.shape
    maximum = rgb.max(axis=2)
    minimum = rgb.min(axis=2)
    # The sheet's background is black with mild compression/noise.  Restrict
    # by both luminance and chroma so pink glow and coloured silhouettes stay.
    candidate = (maximum <= 28) & ((maximum - minimum) <= 16)
    background = np.zeros((height, width), dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(y: int, x: int) -> None:
        if candidate[y, x] and not background[y, x]:
            background[y, x] = True
            queue.append((y, x))

    for x in range(width):
        enqueue(0, x)
        enqueue(height - 1, x)
    for y in range(height):
        enqueue(y, 0)
        enqueue(y, width - 1)

    while queue:
        y, x = queue.popleft()
        if y > 0:
            enqueue(y - 1, x)
        if y + 1 < height:
            enqueue(y + 1, x)
        if x > 0:
            enqueue(y, x - 1)
        if x + 1 < width:
            enqueue(y, x + 1)

    return background


def largest_component(mask: np.ndarray) -> np.ndarray:
    """Discard detached sheet noise while keeping the connected piece/glow."""

    height, width = mask.shape
    seen = np.zeros_like(mask)
    largest: list[tuple[int, int]] = []

    for start_y, start_x in zip(*np.nonzero(mask & ~seen), strict=True):
        if seen[start_y, start_x]:
            continue
        seen[start_y, start_x] = True
        queue = [(int(start_y), int(start_x))]
        component: list[tuple[int, int]] = []
        while queue:
            y, x = queue.pop()
            component.append((y, x))
            for next_y, next_x in (
                (y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1),
                (y - 1, x - 1), (y - 1, x + 1),
                (y + 1, x - 1), (y + 1, x + 1),
            ):
                if (
                    0 <= next_y < height
                    and 0 <= next_x < width
                    and mask[next_y, next_x]
                    and not seen[next_y, next_x]
                ):
                    seen[next_y, next_x] = True
                    queue.append((next_y, next_x))
        if len(component) > len(largest):
            largest = component

    result = np.zeros_like(mask)
    if largest:
        ys, xs = zip(*largest, strict=True)
        result[np.asarray(ys), np.asarray(xs)] = True
    return result


def extract_piece(sheet: Image.Image, crop_box: tuple[int, int, int, int]) -> Image.Image:
    crop = sheet.crop(crop_box).convert("RGB")
    rgb = np.asarray(crop, dtype=np.uint8)
    foreground = largest_component(~border_connected_background(rgb))
    alpha = Image.fromarray((foreground * 255).astype(np.uint8), mode="L")
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=0.8))
    rgba = crop.convert("RGBA")
    rgba.putalpha(alpha)
    bbox = rgba.getbbox()
    if bbox is None:
        raise RuntimeError(f"Empty matte for crop {crop_box}")
    return rgba.crop(bbox)


def normalize(piece: Image.Image, size: int) -> Image.Image:
    side_margin = max(2, round(size * 0.035))
    top_margin = max(2, round(size * 0.025))
    bottom_margin = max(2, round(size * 0.025))
    available_width = size - side_margin * 2
    available_height = size - top_margin - bottom_margin
    scale = min(available_width / piece.width, available_height / piece.height)
    target = (
        max(1, round(piece.width * scale)),
        max(1, round(piece.height * scale)),
    )
    resized = piece.resize(target, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - target[0]) // 2
    y = size - bottom_margin - target[1]
    canvas.alpha_composite(resized, (x, y))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="User-provided six-landmark PNG sheet")
    args = parser.parse_args()

    source = args.source.expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"Source sheet does not exist: {source}")

    with Image.open(source) as source_image:
        if source_image.size != (1183, 1329):
            raise SystemExit(f"Unexpected source size {source_image.size}; expected 1183x1329")
        sheet = source_image.convert("RGB")

    ARCHIVED_SOURCE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, ARCHIVED_SOURCE)

    manifest: dict[str, object] = {
        "source": str(ARCHIVED_SOURCE.relative_to(ROOT)),
        "sourceSha256": file_sha256(ARCHIVED_SOURCE),
        "sourceSize": [sheet.width, sheet.height],
        "matte": "border-connected-near-black-largest-component-feather-0.8",
        "pieces": {},
    }
    entries: dict[str, object] = manifest["pieces"]  # type: ignore[assignment]

    for landmark_id, crop_box in CROPS.items():
        piece = extract_piece(sheet, crop_box)
        outputs: dict[str, object] = {}
        for size in (96, 320):
            output = OUTPUT_DIR / f"{landmark_id}-piece-s{size}.png"
            normalize(piece, size).save(output, format="PNG", optimize=True)
            outputs[str(size)] = {
                "path": str(output.relative_to(ROOT / "public")),
                "sha256": file_sha256(output),
                "width": size,
                "height": size,
            }
        entries[landmark_id] = {
            "crop": list(crop_box),
            "outputs": outputs,
        }

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
