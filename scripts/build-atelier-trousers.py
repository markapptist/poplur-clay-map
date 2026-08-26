"""Build Poplur 2026's fitted Arc tailored trousers for both body rigs.

Run with Blender, not CPython:
  blender --background --factory-startup --python scripts/build-atelier-trousers.py

Every pattern station was measured against its matching Poplur body. The
lower leg stays within a small, directional tailoring allowance instead of
using the old oversized cylinders or copying the source superhero leg panels.
"""

from __future__ import annotations

from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))

from atelier_garment_common import (
    GarmentMeshBuilder,
    export_skinned_garment,
    imported_body_and_armature,
    pbr_material,
    reset_scene,
)


ROOT = Path(__file__).resolve().parents[1]
MODEL_ROOT = ROOT / "public" / "wardrobe-models"

# Ring formats:
# waist: (z, x radius, front radius, back radius, centre y)
# leg:   (z, inner x, outer x, front radius, back radius, centre y)
PROFILES = {
    "Female": {
        "source": "Poplur_Female_Morph.glb",
        "output": "Poplur_Atelier_Trousers_Female.glb",
        "waist": (
            (1.025, 0.166, 0.132, 0.115, 0.025),
            (1.085, 0.158, 0.120, 0.120, 0.001),
        ),
        "legs": (
            (1.055, 0.000, 0.166, 0.132, 0.115, 0.020),
            (0.970, 0.000, 0.200, 0.137, 0.137, 0.030),
            (0.880, 0.005, 0.225, 0.140, 0.140, 0.030),
            (0.790, 0.012, 0.225, 0.140, 0.140, 0.026),
            (0.655, 0.025, 0.225, 0.125, 0.125, 0.030),
            (0.515, 0.040, 0.205, 0.105, 0.105, 0.057),
            (0.370, 0.050, 0.200, 0.082, 0.082, 0.093),
            (0.235, 0.064, 0.178, 0.063, 0.063, 0.093),
            (0.120, 0.070, 0.172, 0.054, 0.054, 0.083),
        ),
        "front_bridge": (
            (1.055, 0.095, -0.105),
            (0.965, 0.108, -0.105),
            (0.875, 0.116, -0.096),
            (0.795, 0.118, -0.087),
            (0.735, 0.014, -0.078),
        ),
        "back_bridge": (
            (1.055, 0.095, 0.137),
            (0.965, 0.108, 0.145),
            (0.875, 0.116, 0.147),
            (0.795, 0.118, 0.136),
            (0.735, 0.014, 0.124),
        ),
    },
    "Male": {
        "source": "Poplur_Male_Morph.glb",
        "output": "Poplur_Atelier_Trousers_Male.glb",
        "waist": (
            (1.045, 0.162, 0.124, 0.122, 0.015),
            (1.105, 0.157, 0.120, 0.118, 0.008),
        ),
        "legs": (
            # Tuck the upper pattern edge beneath the fitted jacket instead
            # of letting the two shells cross at the shared waist seam.
            (1.075, 0.000, 0.158, 0.122, 0.120, 0.015),
            (0.985, 0.000, 0.185, 0.130, 0.135, 0.024),
            (0.890, 0.005, 0.195, 0.112, 0.118, 0.026),
            (0.795, 0.012, 0.198, 0.110, 0.110, 0.023),
            (0.655, 0.022, 0.208, 0.105, 0.105, 0.032),
            (0.510, 0.048, 0.194, 0.085, 0.085, 0.044),
            (0.365, 0.052, 0.209, 0.086, 0.086, 0.085),
            (0.235, 0.076, 0.192, 0.065, 0.065, 0.087),
            (0.125, 0.070, 0.175, 0.059, 0.059, 0.081),
        ),
        "front_bridge": (
            (1.075, 0.095, -0.104),
            (0.980, 0.102, -0.111),
            (0.885, 0.108, -0.099),
            (0.800, 0.115, -0.089),
            (0.735, 0.014, -0.080),
        ),
        "back_bridge": (
            (1.075, 0.095, 0.140),
            (0.980, 0.102, 0.157),
            (0.885, 0.108, 0.146),
            (0.800, 0.115, 0.135),
            (0.735, 0.014, 0.124),
        ),
    },
}


def waist_weights(z: float):
    blend = max(0.0, min(1.0, (z - 0.94) / 0.18))
    return {"pelvis": 1.0 - 0.40 * blend, "spine_01": 0.40 * blend}


def leg_weights(side: str, z: float):
    thigh = f"thigh_{side}"
    calf = f"calf_{side}"
    if z >= 0.78:
        blend = min(1.0, (z - 0.78) / 0.18)
        return {"pelvis": 0.62 * blend, thigh: 1.0 - 0.62 * blend}
    if z >= 0.57:
        return {thigh: 1.0}
    if z >= 0.41:
        blend = (0.57 - z) / 0.16
        return {thigh: 1.0 - blend, calf: blend}
    return {calf: 1.0}


def add_bridge(builder, rows, material: int) -> None:
    column_count = 11
    row_vertices = []
    for z, half_width, y in rows:
        weights = waist_weights(z)
        edge_delta = 0.010 if y < 0.0 else -0.010
        row_vertices.append([
            builder.vertex((
                half_width * (-1.0 + 2.0 * column / (column_count - 1)),
                y + edge_delta * (-1.0 + 2.0 * column / (column_count - 1)) ** 2,
                z,
            ), weights)
            for column in range(column_count)
        ])
    for lower, upper in zip(row_vertices, row_vertices[1:]):
        for column in range(column_count - 1):
            builder.face((
                lower[column],
                lower[column + 1],
                upper[column + 1],
                upper[column],
            ), material)


def add_pressed_crease(builder, rings, sign: int, side: str, material: int) -> None:
    points = []
    for z, inner_x, outer_x, front, _back, center_y in rings[2:]:
        x = sign * (inner_x + outer_x) * 0.5
        points.append((x, center_y - front - 0.002, z))
    builder.ribbon(
        points,
        half_width=0.0016,
        weights=lambda point: leg_weights(side, point[2]),
        material=material,
    )


def build(label: str, profile) -> None:
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(MODEL_ROOT / profile["source"]))
    body, armature = imported_body_and_armature()

    primary = pbr_material(
        "PoplurAtelierBottomTint", (0.10, 0.075, 0.15, 1.0),
        roughness=0.70, metallic=0.0, coat=0.0, sheen=0.20,
    )
    accent = pbr_material(
        "PoplurAtelierTrouserArc", (0.055, 0.050, 0.060, 1.0),
        roughness=0.76, metallic=0.0, coat=0.0,
    )
    builder = GarmentMeshBuilder()

    yoke = profile.get("yoke")
    if yoke:
        builder.z_tube(
            list(yoke),
            weights=waist_weights,
            material=0,
            segments=44,
        )
        leg_rings = tuple(ring for ring in profile["legs"] if ring[0] <= yoke[-1][0] + 1e-6)
    else:
        builder.z_tube(
            list(profile["waist"]),
            weights=waist_weights,
            material=0,
            segments=40,
        )
        add_bridge(builder, profile["front_bridge"], 0)
        add_bridge(builder, profile["back_bridge"], 0)
        leg_rings = profile["legs"]

    for sign, side in ((1, "l"), (-1, "r")):
        builder.side_z_tube(
            list(leg_rings),
            side=sign,
            weights=lambda z, side=side: leg_weights(side, z),
            material=0,
            segments=36,
        )
        add_pressed_crease(builder, leg_rings, sign, side, 1)

    fly_source = (
        [(z, center_y - front) for z, _x, front, _back, center_y in yoke[:4]]
        if yoke else
        [(z, y) for z, _half_width, y in profile["front_bridge"][:4]]
    )
    builder.ribbon(
        [(0.0, y - 0.002, z) for z, y in fly_source],
        half_width=0.0016,
        weights=lambda point: waist_weights(point[2]),
        material=1,
    )

    trousers = builder.build(
        name="PoplurAtelierArcTailoredTrousers",
        materials=[primary, accent],
        body=body,
        armature=armature,
        slot="bottom",
        tint_material="PoplurAtelierBottomTint",
        collection="Poplur 2026 / Arc One",
    )
    output = MODEL_ROOT / profile["output"]
    export_skinned_garment(armature, trousers, output)
    print(f"Built {label} fitted Arc trousers: {output} ({len(trousers.data.vertices)} vertices)")


for label, profile in PROFILES.items():
    build(label, profile)
