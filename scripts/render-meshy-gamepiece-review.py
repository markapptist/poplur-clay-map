"""Render a deterministic review image for an isolated Meshy landmark GLB.

Run with Blender, for example:

    blender --background --python scripts/render-meshy-gamepiece-review.py -- \
      scripts/.meshy-gamepiece-out/optimized/eiffel.glb \
      scripts/.meshy-gamepiece-out/optimized/eiffel-review.png

The camera is derived from the imported bounds, so every landmark receives the
same honest three-quarter product view before it can replace a live map asset.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import bpy
from mathutils import Vector


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--yaw", type=float, default=38.0)
    parser.add_argument("--pitch", type=float, default=18.0)
    parser.add_argument("--size", type=int, default=640)
    return parser.parse_args(__import__("sys").argv[__import__("sys").argv.index("--") + 1 :])


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def bounds() -> tuple[Vector, Vector]:
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            minimum.x = min(minimum.x, world.x)
            minimum.y = min(minimum.y, world.y)
            minimum.z = min(minimum.z, world.z)
            maximum.x = max(maximum.x, world.x)
            maximum.y = max(maximum.y, world.y)
            maximum.z = max(maximum.z, world.z)
    if not all(math.isfinite(value) for value in (*minimum, *maximum)):
        raise RuntimeError("Imported landmark contains no renderable mesh")
    return minimum, maximum


def aim(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def area_light(name: str, location: tuple[float, float, float], energy: float, size: float) -> None:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    aim(obj, Vector((0.0, 0.0, 0.35)))


def render(model: Path, output: Path, *, yaw: float, pitch: float, size: int) -> None:
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(model.resolve()))
    minimum, maximum = bounds()
    center = (minimum + maximum) * 0.5
    height = maximum.z - minimum.z
    extent = max(maximum.x - minimum.x, maximum.y - minimum.y, height)

    # Ground the import and centre it without altering individual mesh nodes.
    for obj in [item for item in bpy.context.scene.objects if item.parent is None]:
        obj.location -= Vector((center.x, center.y, minimum.z))
    target = Vector((0.0, 0.0, height * 0.47))

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = True
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.color = (0.025, 0.025, 0.035)

    camera_data = bpy.data.cameras.new("ReviewCamera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = extent * 1.24
    camera = bpy.data.objects.new("ReviewCamera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera_distance = extent * 2.85
    yaw_radians = math.radians(yaw)
    pitch_radians = math.radians(pitch)
    camera.location = Vector((
        math.sin(yaw_radians) * camera_distance,
        -math.cos(yaw_radians) * camera_distance,
        target.z + math.tan(pitch_radians) * camera_distance,
    ))
    aim(camera, target)
    scene.camera = camera

    area_light("Key", (extent * 1.7, -extent * 2.0, height * 1.55), 900.0, extent * 2.2)
    area_light("Fill", (-extent * 1.5, -extent * 0.7, height * 0.9), 500.0, extent * 2.0)
    area_light("Rim", (0.0, extent * 1.7, height * 1.3), 650.0, extent * 1.7)

    output.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output.resolve())
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    args = arguments()
    render(args.model, args.output, yaw=args.yaw, pitch=args.pitch, size=args.size)
