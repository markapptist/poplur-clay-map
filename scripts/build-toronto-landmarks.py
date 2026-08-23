#!/usr/bin/env python3
"""Build Poplur's mobile Toronto landmark GLBs in Blender 4.5.

The geometry, UVs and tiny embedded PBR maps are generated deterministically;
there are no external source files and no network calls.  Run through Blender:

  blender --background --factory-startup \
    --python scripts/build-toronto-landmarks.py -- --asset all

Validate existing exports without rebuilding them:

  blender --background --factory-startup \
    --python scripts/build-toronto-landmarks.py -- \
    --validate-only public/landmarks/cn-tower.glb \
                    public/landmarks/rogers-centre.glb
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
import tempfile
from pathlib import Path
from typing import Callable, Iterable, Sequence

try:
    import bpy
    from mathutils import Matrix, Vector
except ImportError as exc:  # pragma: no cover - helpful when invoked by Python
    raise SystemExit("Run this script with Blender 4.5, not system Python.") from exc


TAU = math.tau
TEXTURE_SIZE = 64
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPO_ROOT / "public" / "landmarks"
TEXTURE_TEMP = tempfile.TemporaryDirectory(prefix="poplur-toronto-pbr-")
TEXTURE_TEMP_PATH = Path(TEXTURE_TEMP.name)

RGBA = tuple[float, float, float, float]
PixelFn = Callable[[int, int, int], RGBA]


def blender_args() -> list[str]:
    """Return arguments following Blender's required ``--`` separator."""

    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--asset",
        choices=("all", "cn-tower", "rogers-centre"),
        default="all",
        help="Asset to generate (default: both).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Destination directory (default: public/landmarks).",
    )
    parser.add_argument(
        "--validate-only",
        type=Path,
        nargs="+",
        help="Import and inspect GLBs without rebuilding them.",
    )
    return parser.parse_args(blender_args())


def reset_scene() -> None:
    """Return Blender to a predictable empty data state."""

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(collection):
            collection.remove(datablock)
    bpy.context.scene.world.color = (0.02, 0.02, 0.025)
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 1
    bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"


def clamp01(value: float) -> float:
    return min(1.0, max(0.0, value))


def varied(base: Sequence[float], amount: float) -> tuple[float, float, float]:
    return tuple(clamp01(channel + amount) for channel in base[:3])  # type: ignore[return-value]


def surface_pixel(
    base: Sequence[float],
    kind: str,
) -> PixelFn:
    """Create a small, tileable, deterministic surface-detail function."""

    def pixel(x: int, y: int, size: int) -> RGBA:
        u = x / size
        v = y / size
        # A deterministic pseudo-noise field.  It is deliberately low contrast:
        # material zoning does the visual work while the map stays Snapchat-clean.
        grain = (
            math.sin((x * 17 + y * 31) * 0.37)
            + math.sin((x * 7 - y * 13) * 0.61)
        ) * 0.5
        delta = grain * 0.012

        if kind == "concrete":
            delta += math.sin((u * 3.0 + v * 2.0) * TAU) * 0.018
        elif kind == "glass":
            # Opaque blue-black glass with narrow mullion glints.
            delta += 0.025 * math.cos(v * TAU)
            if x % 8 in (0, 1):
                delta += 0.085
        elif kind == "metal":
            delta += math.sin(v * 38.0 * TAU) * 0.018
        elif kind == "roof":
            delta += math.sin((u + v) * 5.0 * TAU) * 0.014
            if x % 16 == 0 or y % 16 == 0:
                delta -= 0.055
        elif kind == "emissive":
            delta += math.sin(u * TAU) * 0.025
        elif kind == "beacon":
            delta += math.sin((u + v) * TAU) * 0.018
        return (*varied(base, delta), 1.0)

    return pixel


def normal_pixel(kind: str) -> PixelFn:
    """Return a shallow tangent-space normal detail map."""

    amplitude = 0.055 if kind == "concrete" else 0.035

    def pixel(x: int, y: int, size: int) -> RGBA:
        dx = math.sin((x * 13 + y * 3) * 0.43) * amplitude
        dy = math.sin((y * 11 - x * 5) * 0.39) * amplitude
        z = math.sqrt(max(0.0, 1.0 - dx * dx - dy * dy))
        return (0.5 + dx * 0.5, 0.5 + dy * 0.5, 0.5 + z * 0.5, 1.0)

    return pixel


def make_image(name: str, pixel_fn: PixelFn, *, non_color: bool = False) -> bpy.types.Image:
    """Create a tiny image file that the exporter embeds into the GLB.

    Blender's ``Image.pack()`` packs a generated image's initial black buffer
    in background mode, even after its live pixel buffer changes.  Saving then
    reloading the deterministic PNG makes the authored pixels authoritative.
    The temporary PNGs live outside the repository and are deleted on exit.
    """

    generated = bpy.data.images.new(name, width=TEXTURE_SIZE, height=TEXTURE_SIZE, alpha=True)
    generated.file_format = "PNG"
    generated.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    pixels: list[float] = []
    for y in range(TEXTURE_SIZE):
        for x in range(TEXTURE_SIZE):
            pixels.extend(pixel_fn(x, y, TEXTURE_SIZE))
    generated.pixels.foreach_set(pixels)
    generated.update()
    image_path = TEXTURE_TEMP_PATH / f"{name}.png"
    generated.filepath_raw = str(image_path)
    generated.save()
    loaded = bpy.data.images.load(str(image_path), check_existing=False)
    bpy.data.images.remove(generated)
    loaded.name = name
    loaded.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return loaded


def make_pbr_material(
    name: str,
    base: Sequence[float],
    kind: str,
    *,
    metallic: float,
    roughness: float,
    normal_kind: str | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    """Create a glTF-friendly Principled material with embedded map(s)."""

    if not name.startswith("PoplurPBR_"):
        raise ValueError(f"Authored materials must carry the PoplurPBR_ marker: {name}")

    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*base[:3], 1.0)
    material.use_backface_culling = False
    material["poplur_authored_pbr"] = True

    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (620, 0)
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.location = (280, 0)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Alpha"].default_value = 1.0
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    color_image = make_image(f"{name}_BaseColor_64", surface_pixel(base, kind))
    color_texture = nodes.new("ShaderNodeTexImage")
    color_texture.name = f"{name}_BaseColor"
    color_texture.label = "Embedded 64px colour detail"
    color_texture.image = color_image
    color_texture.interpolation = "Linear"
    color_texture.extension = "REPEAT"
    color_texture.location = (-360, 80)
    links.new(color_texture.outputs["Color"], shader.inputs["Base Color"])

    if normal_kind:
        normal_image = make_image(
            f"{name}_Normal_64",
            normal_pixel(normal_kind),
            non_color=True,
        )
        normal_texture = nodes.new("ShaderNodeTexImage")
        normal_texture.name = f"{name}_Normal"
        normal_texture.image = normal_image
        normal_texture.interpolation = "Linear"
        normal_texture.extension = "REPEAT"
        normal_texture.location = (-360, -180)
        normal_map = nodes.new("ShaderNodeNormalMap")
        normal_map.inputs["Strength"].default_value = 0.32
        normal_map.location = (-40, -180)
        links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])

    if emission_strength > 0.0:
        emission_input = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
        strength_input = shader.inputs.get("Emission Strength")
        if emission_input:
            links.new(color_texture.outputs["Color"], emission_input)
        if strength_input:
            strength_input.default_value = emission_strength

    return material


def set_active(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_transform(obj: bpy.types.Object) -> None:
    set_active(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def assign_material(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(material)


def smooth_mesh(obj: bpy.types.Object) -> None:
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def add_bevel(obj: bpy.types.Object, width: float, segments: int = 1) -> None:
    if width <= 0:
        return
    set_active(obj)
    modifier = obj.modifiers.new("Micro bevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def add_cylinder(
    name: str,
    radius: float,
    depth: float,
    z: float,
    material: bpy.types.Material,
    *,
    vertices: int = 24,
    scale_xy: tuple[float, float] = (1.0, 1.0),
    bevel: float = 0.0,
    smooth: bool = True,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        end_fill_type="NGON",
        location=(0.0, 0.0, z),
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale.x, obj.scale.y = scale_xy
    apply_transform(obj)
    assign_material(obj, material)
    add_bevel(obj, bevel)
    if smooth:
        smooth_mesh(obj)
    return obj


def add_cone(
    name: str,
    radius1: float,
    radius2: float,
    depth: float,
    z: float,
    material: bpy.types.Material,
    *,
    vertices: int = 24,
    scale_xy: tuple[float, float] = (1.0, 1.0),
    bevel: float = 0.0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        end_fill_type="NGON",
        location=(0.0, 0.0, z),
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale.x, obj.scale.y = scale_xy
    apply_transform(obj)
    assign_material(obj, material)
    add_bevel(obj, bevel)
    smooth_mesh(obj)
    return obj


def add_uv_sphere(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
    *,
    segments: int = 20,
    rings: int = 8,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    apply_transform(obj)
    assign_material(obj, material)
    smooth_mesh(obj)
    return obj


def add_box(
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    material: bpy.types.Material,
    *,
    rotation_z: float = 0.0,
    bevel: float = 0.0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    obj.rotation_euler.z = rotation_z
    apply_transform(obj)
    assign_material(obj, material)
    add_bevel(obj, bevel)
    return obj


def add_tower_fin(
    name: str,
    angle: float,
    material: bpy.types.Material,
) -> bpy.types.Object:
    """Create one of the CN Tower's three tapered concrete buttress fins."""

    z0, z1 = 2.0, 248.0
    vertices = [
        (-1.8, -2.7, z0),
        (10.8, -2.7, z0),
        (10.8, 2.7, z0),
        (-1.8, 2.7, z0),
        (-1.0, -1.35, z1),
        (4.2, -1.35, z1),
        (4.2, 1.35, z1),
        (-1.0, 1.35, z1),
    ]
    faces = [
        (0, 1, 2, 3),
        (4, 7, 6, 5),
        (0, 4, 5, 1),
        (1, 5, 6, 2),
        (2, 6, 7, 3),
        (4, 0, 3, 7),
    ]
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.rotation_euler.z = angle
    assign_material(obj, material)
    set_active(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.04)
    bpy.ops.object.mode_set(mode="OBJECT")
    add_bevel(obj, 0.22, 1)
    return obj


def create_dome_patch(
    name: str,
    start_angle: float,
    end_angle: float,
    inner_radius: float,
    radial_steps: int,
    angular_steps: int,
    base_z: float,
    rise: float,
    size_xy: tuple[float, float],
    material: bpy.types.Material,
) -> bpy.types.Object:
    """Build one UV-mapped ellipsoidal dome patch in the XY ground plane."""

    vertices: list[tuple[float, float, float]] = []
    vertex_uvs: list[tuple[float, float]] = []
    faces: list[tuple[int, ...]] = []
    ring_starts: list[int] = []

    has_center = inner_radius <= 1e-8
    if has_center:
        vertices.append((0.0, 0.0, base_z + rise))
        vertex_uvs.append((0.5, 0.5))
        first_r = 1
    else:
        first_r = 0

    for ring in range(first_r, radial_steps + 1):
        t = ring / radial_steps
        radius = inner_radius + (1.0 - inner_radius) * t
        ring_starts.append(len(vertices))
        z = base_z + rise * math.sqrt(max(0.0, 1.0 - radius * radius))
        for segment in range(angular_steps + 1):
            a_t = segment / angular_steps
            angle = start_angle + (end_angle - start_angle) * a_t
            x = math.cos(angle) * radius * size_xy[0]
            y = math.sin(angle) * radius * size_xy[1]
            vertices.append((x, y, z))
            vertex_uvs.append((0.5 + x / (size_xy[0] * 2.0), 0.5 + y / (size_xy[1] * 2.0)))

    stride = angular_steps + 1
    if has_center:
        first = ring_starts[0]
        for segment in range(angular_steps):
            faces.append((0, first + segment, first + segment + 1))

    for ring_index in range(len(ring_starts) - 1):
        lower = ring_starts[ring_index]
        upper = ring_starts[ring_index + 1]
        for segment in range(angular_steps):
            faces.append(
                (
                    lower + segment,
                    upper + segment,
                    upper + segment + 1,
                    lower + segment + 1,
                )
            )

    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            uv_layer.data[loop_index].uv = vertex_uvs[vertex_index]
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign_material(obj, material)
    smooth_mesh(obj)
    return obj


def parent_objects(root: bpy.types.Object, objects: Iterable[bpy.types.Object]) -> None:
    for obj in objects:
        if obj is not root:
            obj.parent = root


def create_cn_materials() -> dict[str, bpy.types.Material]:
    return {
        "concrete": make_pbr_material(
            "PoplurPBR_CN_Concrete",
            (0.56, 0.58, 0.61),
            "concrete",
            metallic=0.0,
            roughness=0.78,
            normal_kind="concrete",
        ),
        "glass": make_pbr_material(
            "PoplurPBR_CN_OpaqueDarkGlass",
            (0.035, 0.075, 0.12),
            "glass",
            metallic=0.18,
            roughness=0.16,
        ),
        "metal": make_pbr_material(
            "PoplurPBR_CN_BrushedMetal",
            (0.62, 0.65, 0.69),
            "metal",
            metallic=0.52,
            roughness=0.34,
        ),
        "pink": make_pbr_material(
            "PoplurPBR_CN_PinkLight",
            (0.93, 0.12, 0.48),
            "emissive",
            metallic=0.08,
            roughness=0.28,
            emission_strength=0.72,
        ),
        "beacon": make_pbr_material(
            "PoplurPBR_CN_AviationBeacon",
            (0.65, 0.025, 0.045),
            "beacon",
            metallic=0.18,
            roughness=0.32,
            emission_strength=0.35,
        ),
    }


def build_cn_tower() -> bpy.types.Object:
    mats = create_cn_materials()
    root = bpy.data.objects.new("CN_Tower_Root", None)
    root["poplur_pbr"] = "snaplike-toronto-v1"
    root["landmark"] = "CN Tower"
    root["height_m"] = 553.0
    root["static_scene"] = True
    root["up_axis"] = "Y after glTF export"
    bpy.context.collection.objects.link(root)

    pieces: list[bpy.types.Object] = []
    pieces.append(add_cylinder("CN_Base_Plint", 10.5, 2.0, 1.0, mats["concrete"], vertices=24, bevel=0.28))
    pieces.append(add_cone("CN_Main_Shaft", 6.1, 2.3, 336.0, 170.0, mats["concrete"], vertices=18, bevel=0.08))
    for index, angle in enumerate((0.0, TAU / 3.0, 2.0 * TAU / 3.0), start=1):
        pieces.append(add_tower_fin(f"CN_Buttress_Fin_{index}", angle, mats["concrete"]))

    # Main observation deck: concrete/metal structure, opaque glazing and a
    # narrow pink underside glow.  The proportions follow the real silhouette.
    pieces.extend(
        [
            add_cone("CN_Deck_Lower_Collar", 5.2, 10.8, 5.0, 331.5, mats["metal"], vertices=32),
            add_cone("CN_Deck_Lower_Skirt", 10.8, 13.0, 4.0, 336.0, mats["metal"], vertices=32),
            add_cylinder("CN_Deck_Pink_Underside", 13.25, 0.72, 338.35, mats["pink"], vertices=32),
            add_cylinder("CN_Deck_Observation_Glass", 13.0, 5.6, 341.5, mats["glass"], vertices=32),
            add_cylinder("CN_Deck_Metal_Mullion", 13.1, 0.55, 344.25, mats["metal"], vertices=32),
            add_cylinder("CN_Deck_Restaurant_Glass", 11.7, 4.2, 346.7, mats["glass"], vertices=32),
            add_cone("CN_Deck_Roof", 11.7, 7.0, 4.0, 350.8, mats["metal"], vertices=32),
        ]
    )

    pieces.append(add_cone("CN_Upper_Shaft", 2.15, 1.55, 93.0, 399.5, mats["concrete"], vertices=14))
    pieces.extend(
        [
            add_cone("CN_SkyPod_Lower", 2.0, 4.6, 2.6, 445.6, mats["metal"], vertices=24),
            add_cylinder("CN_SkyPod_Glass", 4.75, 4.4, 449.0, mats["glass"], vertices=24),
            add_cylinder("CN_SkyPod_Pink_Ring", 4.9, 0.45, 450.95, mats["pink"], vertices=24),
            add_cone("CN_SkyPod_Roof", 4.7, 2.0, 2.4, 452.4, mats["metal"], vertices=24),
            add_cone("CN_Antenna_Lower", 1.15, 0.55, 73.0, 490.5, mats["metal"], vertices=12),
            add_cone("CN_Antenna_Upper", 0.55, 0.15, 26.0, 540.0, mats["metal"], vertices=10),
        ]
    )
    for index, z in enumerate((476.0, 508.0, 538.0), start=1):
        pieces.append(add_cylinder(f"CN_Antenna_Beacon_Band_{index}", 0.72 if index < 3 else 0.42, 1.0, z, mats["beacon"], vertices=12))
    pieces.append(add_uv_sphere("CN_Top_Beacon", (0.0, 0.0, 552.0), (1.0, 1.0, 1.0), mats["pink"], segments=12, rings=6))

    parent_objects(root, pieces)
    return root


def create_rc_materials() -> dict[str, bpy.types.Material]:
    return {
        "concrete": make_pbr_material(
            "PoplurPBR_RC_Concrete",
            (0.48, 0.50, 0.53),
            "concrete",
            metallic=0.0,
            roughness=0.77,
            normal_kind="concrete",
        ),
        "glass": make_pbr_material(
            "PoplurPBR_RC_OpaqueDarkGlass",
            (0.025, 0.065, 0.105),
            "glass",
            metallic=0.16,
            roughness=0.17,
        ),
        "metal": make_pbr_material(
            "PoplurPBR_RC_BrushedMetal",
            (0.38, 0.42, 0.47),
            "metal",
            metallic=0.76,
            roughness=0.29,
        ),
        "roof_white": make_pbr_material(
            "PoplurPBR_RC_RoofWarmWhite",
            (0.69, 0.70, 0.69),
            "roof",
            metallic=0.12,
            roughness=0.53,
            normal_kind="roof",
        ),
        "roof_silver": make_pbr_material(
            "PoplurPBR_RC_RoofSilver",
            (0.55, 0.58, 0.61),
            "roof",
            metallic=0.35,
            roughness=0.42,
            normal_kind="roof",
        ),
        "pink": make_pbr_material(
            "PoplurPBR_RC_PinkLight",
            (0.94, 0.11, 0.47),
            "emissive",
            metallic=0.08,
            roughness=0.28,
            emission_strength=0.66,
        ),
    }


def build_rogers_centre() -> bpy.types.Object:
    mats = create_rc_materials()
    root = bpy.data.objects.new("Rogers_Centre_Root", None)
    root["poplur_pbr"] = "snaplike-toronto-v1"
    root["landmark"] = "Rogers Centre / SkyDome"
    root["height_m"] = 60.0
    root["static_scene"] = True
    root["up_axis"] = "Y after glTF export"
    bpy.context.collection.objects.link(root)

    pieces: list[bpy.types.Object] = []
    ellipse = (1.0, 0.805)
    pieces.extend(
        [
            add_cylinder("RC_Foundation", 106.0, 3.0, 1.5, mats["metal"], vertices=48, scale_xy=ellipse, bevel=0.35),
            add_cylinder("RC_Lower_Concrete_Bowl", 104.0, 10.0, 8.0, mats["concrete"], vertices=48, scale_xy=ellipse, bevel=0.55),
            add_cylinder("RC_Concourse_Glass", 102.5, 5.0, 15.5, mats["glass"], vertices=48, scale_xy=ellipse),
            add_cylinder("RC_Pink_Concourse_Line", 103.0, 0.62, 18.25, mats["pink"], vertices=48, scale_xy=ellipse),
            add_cone("RC_Upper_Concrete_Bowl", 102.0, 96.0, 14.0, 25.5, mats["concrete"], vertices=48, scale_xy=ellipse, bevel=0.28),
            add_cylinder("RC_Roof_Base_Trim", 97.0, 2.2, 33.2, mats["metal"], vertices=48, scale_xy=ellipse),
        ]
    )

    # Dark shell under four slightly separated roof panels makes the genuine
    # retractable seams legible without alpha, shadows or expensive effects.
    pieces.append(
        create_dome_patch(
            "RC_Roof_UnderShell",
            0.0,
            TAU,
            0.0,
            radial_steps=8,
            angular_steps=48,
            base_z=33.3,
            rise=24.0,
            size_xy=(96.0, 77.0),
            material=mats["metal"],
        )
    )
    gap = math.radians(1.4)
    for index in range(4):
        start = index * TAU / 4.0 + gap
        end = (index + 1) * TAU / 4.0 - gap
        pieces.append(
            create_dome_patch(
                f"RC_Retractable_Roof_Panel_{index + 1}",
                start,
                end,
                0.14,
                radial_steps=7,
                angular_steps=14,
                base_z=34.0,
                rise=24.9,
                size_xy=(95.5, 76.5),
                material=mats["roof_white"] if index % 2 == 0 else mats["roof_silver"],
            )
        )
    pieces.append(
        create_dome_patch(
            "RC_Roof_Centre_Cap",
            0.0,
            TAU,
            0.0,
            radial_steps=3,
            angular_steps=32,
            base_z=34.3,
            rise=25.7,
            size_xy=(15.0, 12.0),
            material=mats["roof_white"],
        )
    )

    # Four glazed entrances and restrained Poplur signs provide readable scale
    # and a touch of the pink identity at street level.
    entrance_specs = (
        ("North", (0.0, 85.0, 7.0), (26.0, 3.0, 8.0), 0.0, (0.0, 86.8, 10.7), (11.0, 1.0, 1.2)),
        ("South", (0.0, -85.0, 7.0), (26.0, 3.0, 8.0), 0.0, (0.0, -86.8, 10.7), (11.0, 1.0, 1.2)),
        ("East", (106.0, 0.0, 7.0), (3.0, 20.0, 8.0), 0.0, (107.8, 0.0, 10.7), (1.0, 9.0, 1.2)),
        ("West", (-106.0, 0.0, 7.0), (3.0, 20.0, 8.0), 0.0, (-107.8, 0.0, 10.7), (1.0, 9.0, 1.2)),
    )
    for label, location, dimensions, rotation, sign_location, sign_dimensions in entrance_specs:
        pieces.append(add_box(f"RC_{label}_Glass_Entrance", location, dimensions, mats["glass"], rotation_z=rotation, bevel=0.28))
        pieces.append(add_box(f"RC_{label}_Pink_Sign", sign_location, sign_dimensions, mats["pink"], rotation_z=rotation, bevel=0.16))

    parent_objects(root, pieces)
    return root


def ensure_mesh_contract() -> None:
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not mesh_objects:
        raise RuntimeError("Asset contains no mesh objects")
    for obj in mesh_objects:
        if not obj.data.uv_layers:
            raise RuntimeError(f"{obj.name} has no UV map")
        if not obj.data.materials:
            raise RuntimeError(f"{obj.name} has no material")
        for material in obj.data.materials:
            if material and not material.name.startswith("PoplurPBR_"):
                raise RuntimeError(f"{obj.name} uses unmarked material {material.name}")


def export_glb(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ensure_mesh_contract()
    bpy.context.scene["poplur_pipeline"] = "toronto-landmarks-v1"
    bpy.context.scene["static_scene"] = True
    result = bpy.ops.export_scene.gltf(
        filepath=str(path),
        check_existing=False,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_keep_originals=False,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_extras=True,
        export_unused_images=False,
        export_unused_textures=False,
        use_selection=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"glTF export failed: {result}")


def glb_json(path: Path) -> dict:
    with path.open("rb") as stream:
        header = stream.read(12)
        if len(header) != 12:
            raise RuntimeError(f"{path} is not a complete GLB")
        magic, version, _length = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2:
            raise RuntimeError(f"{path} is not glTF 2.0")
        chunk_length, chunk_type = struct.unpack("<II", stream.read(8))
        if chunk_type != 0x4E4F534A:
            raise RuntimeError(f"{path} has no leading JSON chunk")
        return json.loads(stream.read(chunk_length).decode("utf-8").rstrip(" \t\r\n\0"))


def world_bounds(objects: Iterable[bpy.types.Object]) -> tuple[Vector, Vector]:
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    found = False
    for obj in objects:
        if obj.type != "MESH":
            continue
        found = True
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            minimum.x = min(minimum.x, world.x)
            minimum.y = min(minimum.y, world.y)
            minimum.z = min(minimum.z, world.z)
            maximum.x = max(maximum.x, world.x)
            maximum.y = max(maximum.y, world.y)
            maximum.z = max(maximum.z, world.z)
    if not found:
        raise RuntimeError("Imported GLB has no mesh bounds")
    return minimum, maximum


def validate_glb(path: Path) -> dict:
    path = path.resolve()
    if not path.exists():
        raise FileNotFoundError(path)
    document = glb_json(path)
    if len(document.get("scenes", [])) != 1:
        raise RuntimeError(f"{path.name}: expected exactly one scene")
    if document.get("animations"):
        raise RuntimeError(f"{path.name}: static asset unexpectedly contains animation")
    if document.get("cameras"):
        raise RuntimeError(f"{path.name}: asset unexpectedly contains a camera")
    if not document.get("textures") or not document.get("images"):
        raise RuntimeError(f"{path.name}: authored PBR textures were not embedded")
    if any("bufferView" not in image for image in document.get("images", [])):
        raise RuntimeError(f"{path.name}: one or more images are external instead of GLB-embedded")
    material_names = [material.get("name", "") for material in document.get("materials", [])]
    if not material_names or any(not name.startswith("PoplurPBR_") for name in material_names):
        raise RuntimeError(f"{path.name}: missing PoplurPBR_ material marker")

    reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(path), import_pack_images=True)
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    base_color_images = [
        image
        for image in bpy.data.images
        if "_BaseColor_64" in image.name and image.size[0] > 0
    ]
    if not base_color_images:
        raise RuntimeError(f"{path.name}: imported asset has no base-colour image data")
    for image in base_color_images:
        pixels = list(image.pixels[:])
        rgb = [value for index, value in enumerate(pixels) if index % 4 != 3]
        if not rgb or max(rgb) <= 0.02 or sum(rgb) / len(rgb) <= 0.01:
            raise RuntimeError(f"{path.name}: {image.name} is blank/black")
    vertex_count = sum(len(obj.data.vertices) for obj in mesh_objects)
    triangle_count = 0
    uv_mesh_count = 0
    for obj in mesh_objects:
        obj.data.calc_loop_triangles()
        triangle_count += len(obj.data.loop_triangles)
        uv_mesh_count += int(bool(obj.data.uv_layers))
    if uv_mesh_count != len(mesh_objects):
        raise RuntimeError(f"{path.name}: one or more imported meshes lost UVs")

    minimum, maximum = world_bounds(mesh_objects)
    if abs(minimum.z) > 0.02:
        raise RuntimeError(f"{path.name}: Blender round-trip floor is {minimum.z:.4f}, expected 0")
    dimensions = maximum - minimum
    sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    report = {
        "asset": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256,
        "scene_count": len(document.get("scenes", [])),
        "node_count": len(document.get("nodes", [])),
        "mesh_count": len(document.get("meshes", [])),
        "primitive_count": sum(len(mesh.get("primitives", [])) for mesh in document.get("meshes", [])),
        "vertex_count": vertex_count,
        "triangle_count": triangle_count,
        "material_count": len(document.get("materials", [])),
        "texture_count": len(document.get("textures", [])),
        "image_count": len(document.get("images", [])),
        "nonblack_basecolor_image_count": len(base_color_images),
        "all_images_embedded": True,
        "animation_count": len(document.get("animations", [])),
        "all_meshes_uv_mapped": True,
        "all_materials_marked": True,
        "opaque_materials": all(
            material.get("alphaMode", "OPAQUE") == "OPAQUE"
            for material in document.get("materials", [])
        ),
        "roundtrip_blender_bounds_m": {
            "min": [round(value, 4) for value in minimum],
            "max": [round(value, 4) for value in maximum],
            "size": [round(value, 4) for value in dimensions],
        },
        "gltf_up_axis": "Y (export_yup=True)",
    }
    if not report["opaque_materials"]:
        raise RuntimeError(f"{path.name}: a material is not OPAQUE")
    print("ASSET_REPORT " + json.dumps(report, sort_keys=True))
    return report


def build_asset(asset: str, output_dir: Path) -> Path:
    reset_scene()
    if asset == "cn-tower":
        build_cn_tower()
        output = output_dir / "cn-tower.glb"
    elif asset == "rogers-centre":
        build_rogers_centre()
        output = output_dir / "rogers-centre.glb"
    else:  # guarded by argparse
        raise ValueError(asset)
    export_glb(output)
    return output


def main() -> None:
    args = parse_args()
    if args.validate_only:
        for path in args.validate_only:
            validate_glb(path if path.is_absolute() else REPO_ROOT / path)
        return

    selected = ("cn-tower", "rogers-centre") if args.asset == "all" else (args.asset,)
    output_dir = args.output_dir if args.output_dir.is_absolute() else REPO_ROOT / args.output_dir
    built = [build_asset(asset, output_dir) for asset in selected]
    for path in built:
        validate_glb(path)


if __name__ == "__main__":
    main()
