"""Shared, zero-license-cost garment authoring helpers for Poplur Atelier.

The helpers deliberately produce ordinary skinned glTF meshes. They do not
ship Blender or run a cloth solver on a user's phone. Blender is only the
offline authoring tool; Poplur loads the compact exported garment and rebinds
it to the already-live 65-bone body skeleton.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import cos, pi, sin
from typing import Callable, Iterable

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


WeightMap = dict[str, float]
WeightFn = Callable[[float], WeightMap]


def set_principled_input(bsdf, names: tuple[str, ...], value) -> None:
    for name in names:
        socket = bsdf.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def pbr_material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    roughness: float,
    metallic: float = 0.0,
    coat: float = 0.0,
    sheen: float = 0.0,
):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    material.use_backface_culling = False
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        set_principled_input(bsdf, ("Coat Weight", "Clearcoat"), coat)
        set_principled_input(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.22)
        set_principled_input(bsdf, ("Sheen Weight", "Sheen"), sheen)
    return material


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def imported_body_and_armature():
    armature = next(item for item in bpy.context.scene.objects if item.type == "ARMATURE")
    body = max(
        (
            item for item in bpy.context.scene.objects
            if item.type == "MESH" and item.find_armature() == armature
        ),
        key=lambda item: len(item.data.vertices),
    )
    return body, armature


def normalised(weights: WeightMap) -> WeightMap:
    positive = {name: max(0.0, value) for name, value in weights.items() if value > 1e-6}
    total = sum(positive.values())
    if total <= 1e-8:
        raise RuntimeError("Garment vertex has no deformation weights")
    return {name: value / total for name, value in positive.items()}


@dataclass
class GarmentMeshBuilder:
    vertices: list[tuple[float, float, float]] = field(default_factory=list)
    faces: list[tuple[int, ...]] = field(default_factory=list)
    face_materials: list[int] = field(default_factory=list)
    vertex_weights: list[WeightMap] = field(default_factory=list)

    def vertex(self, point: Iterable[float], weights: WeightMap) -> int:
        index = len(self.vertices)
        self.vertices.append(tuple(float(value) for value in point))
        self.vertex_weights.append(normalised(weights))
        return index

    def face(self, indices: Iterable[int], material: int) -> None:
        self.faces.append(tuple(indices))
        self.face_materials.append(material)

    def z_tube(
        self,
        rings: list[tuple[float, float, float, float, float]],
        *,
        weights: WeightFn,
        material: int,
        segments: int = 32,
        center_x: float = 0.0,
    ) -> None:
        """Add a vertical tube.

        Rings are ``(z, x_radius, front_radius, back_radius, center_y)``.
        Poplur's imported reference body faces -Y, so front and back depth can
        be shaped independently instead of forcing a cylindrical silhouette.
        """
        loops: list[list[int]] = []
        for z, radius_x, front, back, center_y in rings:
            loop = []
            for segment in range(segments):
                angle = 2 * pi * segment / segments
                direction_y = sin(angle)
                radius_y = back if direction_y >= 0 else front
                loop.append(self.vertex(
                    (
                        center_x + radius_x * cos(angle),
                        center_y + radius_y * direction_y,
                        z,
                    ),
                    weights(z),
                ))
            loops.append(loop)
        for lower, upper in zip(loops, loops[1:]):
            for segment in range(segments):
                following = (segment + 1) % segments
                self.face((lower[segment], lower[following], upper[following], upper[segment]), material)

    def x_tube(
        self,
        rings: list[tuple[float, float, float, float, float]],
        *,
        weights: WeightFn,
        material: int,
        segments: int = 24,
    ) -> None:
        """Add a sleeve-like tube along X.

        Rings are ``(x, y_radius, z_radius, center_y, center_z)``.
        """
        loops: list[list[int]] = []
        for x, radius_y, radius_z, center_y, center_z in rings:
            loop = []
            for segment in range(segments):
                angle = 2 * pi * segment / segments
                loop.append(self.vertex(
                    (x, center_y + radius_y * cos(angle), center_z + radius_z * sin(angle)),
                    weights(x),
                ))
            loops.append(loop)
        for inner, outer in zip(loops, loops[1:]):
            for segment in range(segments):
                following = (segment + 1) % segments
                self.face((inner[segment], outer[segment], outer[following], inner[following]), material)

    def side_z_tube(
        self,
        rings: list[tuple[float, float, float, float, float, float]],
        *,
        side: int,
        weights: WeightFn,
        material: int,
        segments: int = 32,
    ) -> None:
        """Add one tailored leg from explicit inner and outer pattern edges.

        Rings are ``(z, inner_x, outer_x, front_radius, back_radius,
        center_y)``. Unlike an ordinary centred cylinder this retains a real
        crotch gap while allowing the outside seam to bow and taper.
        """
        loops: list[list[int]] = []
        for z, inner_x, outer_x, front, back, center_y in rings:
            center_abs = (inner_x + outer_x) * 0.5
            radius_x = (outer_x - inner_x) * 0.5
            loop = []
            for segment in range(segments):
                angle = 2 * pi * segment / segments
                direction_y = sin(angle)
                radius_y = back if direction_y >= 0 else front
                loop.append(self.vertex(
                    (
                        side * (center_abs + radius_x * cos(angle)),
                        center_y + radius_y * direction_y,
                        z,
                    ),
                    weights(z),
                ))
            loops.append(loop)
        for upper, lower in zip(loops, loops[1:]):
            for segment in range(segments):
                following = (segment + 1) % segments
                self.face((upper[segment], upper[following], lower[following], lower[segment]), material)

    def ribbon(
        self,
        points: list[tuple[float, float, float]],
        *,
        half_width: float,
        weights: Callable[[tuple[float, float, float]], WeightMap],
        material: int,
    ) -> None:
        """Add a front-facing ribbon following an X/Z polyline."""
        pairs: list[tuple[int, int]] = []
        for index, point in enumerate(points):
            previous = Vector(points[max(0, index - 1)])
            following = Vector(points[min(len(points) - 1, index + 1)])
            tangent = (following - previous).normalized()
            normal = Vector((-tangent.z, 0.0, tangent.x)).normalized() * half_width
            center = Vector(point)
            pairs.append((
                self.vertex(center - normal, weights(point)),
                self.vertex(center + normal, weights(point)),
            ))
        for first, second in zip(pairs, pairs[1:]):
            self.face((first[0], second[0], second[1], first[1]), material)

    def build(
        self,
        *,
        name: str,
        materials: list,
        body,
        armature,
        slot: str,
        tint_material: str,
        collection: str,
    ):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update(calc_edges=True)
        garment = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(garment)
        garment["poplur_slot"] = slot
        garment["poplur_tint_material"] = tint_material
        garment["poplur_collection"] = collection
        for material in materials:
            garment.data.materials.append(material)
        for polygon, material_index in zip(garment.data.polygons, self.face_materials):
            polygon.material_index = material_index
            polygon.use_smooth = True

        # Create every group in armature order so glTF keeps the exact body
        # skin contract even though a garment only deforms against a subset.
        groups = {bone.name: garment.vertex_groups.new(name=bone.name) for bone in armature.data.bones}
        for vertex_index, weights in enumerate(self.vertex_weights):
            for group_name, weight in weights.items():
                group = groups.get(group_name)
                if group is None:
                    raise RuntimeError(f"Poplur armature is missing required bone {group_name}")
                group.add((vertex_index,), weight, "REPLACE")

        add_body_profile_shape_keys(body, garment)
        modifier = garment.modifiers.new("PoplurArmature", "ARMATURE")
        modifier.object = armature
        modifier.use_deform_preserve_volume = True
        garment.parent = armature
        return garment


def barycentric_weights(point: Vector, a: Vector, b: Vector, c: Vector) -> tuple[float, float, float]:
    edge_ab = b - a
    edge_ac = c - a
    offset = point - a
    d00 = edge_ab.dot(edge_ab)
    d01 = edge_ab.dot(edge_ac)
    d11 = edge_ac.dot(edge_ac)
    d20 = offset.dot(edge_ab)
    d21 = offset.dot(edge_ac)
    denominator = d00 * d11 - d01 * d01
    if abs(denominator) < 1e-12:
        distances = ((point - a).length_squared, (point - b).length_squared, (point - c).length_squared)
        nearest = min(range(3), key=distances.__getitem__)
        return tuple(1.0 if index == nearest else 0.0 for index in range(3))
    weight_b = (d11 * d20 - d01 * d21) / denominator
    weight_c = (d00 * d21 - d01 * d20) / denominator
    values = [max(0.0, min(1.0, value)) for value in (1.0 - weight_b - weight_c, weight_b, weight_c)]
    total = sum(values)
    return tuple(value / total for value in values)


def add_body_profile_shape_keys(body, garment) -> None:
    """Project the body's two authored profile deltas onto garment geometry."""
    shape_keys = body.data.shape_keys
    profile_names = ("Muscle", "YouthfulAdult")
    if not shape_keys or shape_keys.key_blocks.get("Basis") is None:
        raise RuntimeError("Poplur body is missing its authored profile shape keys")
    if any(shape_keys.key_blocks.get(name) is None for name in profile_names):
        raise RuntimeError(f"Poplur body must provide {profile_names}")

    body.data.calc_loop_triangles()
    body_points = [vertex.co.copy() for vertex in body.data.vertices]
    triangles = [tuple(triangle.vertices) for triangle in body.data.loop_triangles]
    surface = BVHTree.FromPolygons(body_points, triangles, all_triangles=True)
    garment_to_body = body.matrix_world.inverted() @ garment.matrix_world
    body_delta_to_garment = garment.matrix_world.inverted().to_3x3() @ body.matrix_world.to_3x3()
    bindings = []
    for vertex in garment.data.vertices:
        nearest, _normal, triangle_index, _distance = surface.find_nearest(garment_to_body @ vertex.co)
        if nearest is None or triangle_index is None:
            raise RuntimeError(f"Could not bind garment vertex {vertex.index} to Poplur body")
        triangle = triangles[triangle_index]
        bindings.append((triangle, barycentric_weights(nearest, *(body_points[index] for index in triangle))))

    body_basis = shape_keys.key_blocks["Basis"]
    garment_basis = garment.shape_key_add(name="Basis", from_mix=False)
    for profile_name in profile_names:
        source_profile = shape_keys.key_blocks[profile_name]
        garment_profile = garment.shape_key_add(name=profile_name, from_mix=False)
        for garment_index, (triangle, weights) in enumerate(bindings):
            delta = Vector()
            for source_index, weight in zip(triangle, weights):
                delta += (source_profile.data[source_index].co - body_basis.data[source_index].co) * weight
            garment_profile.data[garment_index].co = garment_basis.data[garment_index].co + body_delta_to_garment @ delta


def export_skinned_garment(armature, garment, output) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    garment.select_set(True)
    bpy.context.view_layer.objects.active = garment
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_skins=True,
        export_morph=True,
        export_morph_normal=True,
        export_extras=True,
        export_animations=False,
        export_materials="EXPORT",
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
