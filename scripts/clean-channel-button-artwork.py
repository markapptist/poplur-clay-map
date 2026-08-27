#!/usr/bin/env python3
"""Remove the stray connector bars from the approved channel-button PNGs.

The source renders include a dark bridge between the chevron tips. It reads as
an extra horizontal line in the up/down rail and becomes a vertical gray strip
when the same artwork is rotated for the map's left/right controls. Keep the
rounded clay chevrons unchanged, clear only those bridge polygons in the 1024
masters, then reproduce the checked-in 512/256 runtime assets with the same
Lanczos resize used to create them originally.
"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
MASTER_DIR = ROOT / "src/side-control-icons/dev-assets/1024/global_navigation"
RUNTIME_DIR = ROOT / "public/poplur-side-buttons/assets"

# Coordinates are in the 1024px masters. Each quadrilateral follows the open
# space between the chevron's inner edges, so it cannot trim the rounded tips.
BRIDGE_MASKS = {
    "channel_up.png": [(409, 698), (613, 698), (708, 784), (314, 784)],
    "channel_down.png": [(260, 236), (767, 236), (711, 266), (318, 266)],
}


for filename, polygon in BRIDGE_MASKS.items():
    master_path = MASTER_DIR / filename
    image = Image.open(master_path).convert("RGBA")
    if image.size != (1024, 1024):
        raise SystemExit(f"Unexpected channel master size: {master_path} is {image.size}")

    ImageDraw.Draw(image).polygon(polygon, fill=(0, 0, 0, 0))
    image.save(master_path, optimize=True)

    for size in (512, 256):
        destination = RUNTIME_DIR / str(size) / "global_navigation" / filename
        image.resize((size, size), Image.Resampling.LANCZOS).save(destination, optimize=True)
        print(f"wrote {destination.relative_to(ROOT)}")
