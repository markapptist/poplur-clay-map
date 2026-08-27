"""Build Poplur 2026's body-fitted Arc jacket for both avatar bodies.

Run with Blender, not CPython:
  blender --background --factory-startup --python scripts/build-atelier-jackets.py

The jacket shell is cut from each avatar's own weighted surface. That keeps
the shoulder, armhole and sleeve axes identical to the live 65-bone body while
the small, explicit ease offset makes it read as cloth rather than body paint.
"""

from __future__ import annotations

from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))

from atelier_garment_common import (
    GarmentMeshBuilder,
    imported_body_and_armature,
    pbr_material,
    reset_scene,
)


ROOT = Path(__file__).resolve().parents[1]
MODEL_ROOT = ROOT / "public" / "wardrobe-models"
JACKETS = (
    ("Female", "Poplur_Female_Morph.glb", "Poplur_Atelier_Jacket_Female.glb"),
    ("Male", "Poplur_Male_Morph.glb", "Poplur_Atelier_Jacket_Male.glb"),
)


def bone(armature, name: str):
    result = armature.data.bones.get(name)
    if result is None:
        raise RuntimeError(f"Poplur armature is missing required bone {name}")
    return result


def weights_at_z(armature, z: float):
    """Two-bone torso weights derived from this body's authored landmarks."""
    landmarks = (
        (bone(armature, "pelvis").head_local.z, "pelvis"),
        (bone(armature, "spine_01").head_local.z, "spine_01"),
        (bone(armature, "spine_02").head_local.z, "spine_02"),
        (bone(armature, "spine_03").head_local.z, "spine_03"),
        (bone(armature, "neck_01").head_local.z, "neck_01"),
    )
    if z <= landmarks[0][0]:
        return {landmarks[0][1]: 1.0}
    for (lower_z, lower_name), (upper_z, upper_name) in zip(landmarks, landmarks[1:]):
        if z <= upper_z:
            blend = max(0.0, min(1.0, (z - lower_z) / max(1e-6, upper_z - lower_z)))
            return {lower_name: 1.0 - blend, upper_name: blend}
    return {"neck_01": 1.0}


def body_section(body, z: float, *, x_limit: float, band: float = 0.028):
    """Return a close ellipse around a horizontal body section."""
    points = [
        vertex.co for vertex in body.data.vertices
        if abs(vertex.co.z - z) <= band and abs(vertex.co.x) <= x_limit
    ]
    if len(points) < 8 and band < 0.06:
        return body_section(body, z, x_limit=x_limit, band=0.06)
    if len(points) < 8:
        raise RuntimeError(f"Could not measure Poplur body section at z={z:.4f}")
    minimum_y = min(point.y for point in points)
    maximum_y = max(point.y for point in points)
    center_y = (minimum_y + maximum_y) * 0.5
    return (
        max(abs(point.x) for point in points),
        center_y - minimum_y,
        maximum_y - center_y,
        center_y,
    )


def arm_section(body, x: float, z_hint: float, *, band: float = 0.025, z_band: float = 0.105):
    """Return Y/Z radii around one rest-pose arm section."""
    sign = 1.0 if x >= 0.0 else -1.0
    points = [
        vertex.co for vertex in body.data.vertices
        if (
            vertex.co.x * sign > 0.0
            and abs(vertex.co.x - x) <= band
            and abs(vertex.co.z - z_hint) <= z_band
        )
    ]
    if len(points) < 8 and band < 0.05:
        return arm_section(body, x, z_hint, band=0.05, z_band=z_band)
    if len(points) < 8:
        raise RuntimeError(f"Could not measure Poplur arm section at x={x:.4f}")
    minimum_y = min(point.y for point in points)
    maximum_y = max(point.y for point in points)
    minimum_z = min(point.z for point in points)
    maximum_z = max(point.z for point in points)
    return (
        (maximum_y - minimum_y) * 0.5,
        (maximum_z - minimum_z) * 0.5,
        (minimum_y + maximum_y) * 0.5,
        (minimum_z + maximum_z) * 0.5,
    )


def front_surface_y(body, x: float, z: float) -> float:
    points = [
        vertex.co for vertex in body.data.vertices
        if abs(vertex.co.x - x) <= 0.045 and abs(vertex.co.z - z) <= 0.045
    ]
    if not points:
        points = [
            vertex.co for vertex in body.data.vertices
            if abs(vertex.co.x - x) <= 0.075 and abs(vertex.co.z - z) <= 0.075
        ]
    if not points:
        raise RuntimeError(f"Could not locate jacket front near ({x:.3f}, {z:.3f})")
    # Imported Poplur bodies face -Y.
    return min(point.y for point in points)


def front_envelope_y(body, z: float, x_limit: float) -> float:
    points = [
        vertex.co for vertex in body.data.vertices
        if abs(vertex.co.z - z) <= 0.030 and abs(vertex.co.x) <= x_limit
    ]
    if not points:
        raise RuntimeError(f"Could not measure jacket front envelope at z={z:.3f}")
    return min(point.y for point in points)


def profile_section(points, z: float, *, x_limit: float, band: float = 0.027):
    section = [point for point in points if abs(point.z - z) <= band and abs(point.x) <= x_limit]
    if len(section) < 8:
        section = [point for point in points if abs(point.z - z) <= 0.055 and abs(point.x) <= x_limit]
    if len(section) < 8:
        raise RuntimeError(f"Could not measure profile section at z={z:.3f}")
    return max(abs(point.x) for point in section)


def profile_front(points, x: float, z: float) -> float:
    section = [
        point.y for point in points
        if abs(point.x - x) <= 0.045 and abs(point.z - z) <= 0.045
    ]
    if not section:
        section = [
            point.y for point in points
            if abs(point.x - x) <= 0.075 and abs(point.z - z) <= 0.075
        ]
    if not section:
        raise RuntimeError(f"Could not measure profile front at ({x:.3f}, {z:.3f})")
    return min(section)


def tailored_front_positions(profile_points, armature, hem_z: float):
    shoulder_x = abs(bone(armature, "upperarm_l").head_local.x)
    upper_z = bone(armature, "neck_01").head_local.z - 0.024
    lower_z = hem_z + 0.004
    row_count = 12
    column_count = 17
    rows_data = []
    for row_index in range(row_count):
        mix = row_index / (row_count - 1)
        z = lower_z + (upper_z - lower_z) * mix
        hem_blend = max(0.0, min(1.0, (0.24 - mix) / 0.24))
        measured_x = profile_section(
            profile_points, z, x_limit=shoulder_x + 0.050,
        )
        # The first two rows form one continuous outer hem. The earlier
        # shoulder-capped front receded behind the waistband between the side
        # ring and centre panel, producing alternating blue/grey tabs.
        half_width = min(
            measured_x + 0.010 + 0.040 * hem_blend,
            shoulder_x + 0.070,
        )
        envelope = min(
            point.y for point in profile_points
            if abs(point.z - z) <= 0.030 and abs(point.x) <= half_width
        )
        rows_data.append([z, half_width, envelope])

    # Replace anatomical under-bust changes with one broad tailored arc from
    # waist to chest to neckline. This is evaluated independently per morph.
    lower_envelope = rows_data[0][2]
    upper_envelope = rows_data[-1][2]
    chest_envelope = min(row[2] for row in rows_data)
    peak_mix = 0.64
    for index, row in enumerate(rows_data):
        mix = index / (len(rows_data) - 1)
        if mix <= peak_mix:
            local = mix / peak_mix
            smooth = local * local * (3.0 - 2.0 * local)
            row[2] = lower_envelope + (chest_envelope - lower_envelope) * smooth
        else:
            local = (mix - peak_mix) / (1.0 - peak_mix)
            smooth = local * local * (3.0 - 2.0 * local)
            row[2] = chest_envelope + (upper_envelope - chest_envelope) * smooth

    positions = []
    for row_index, (z, half_width, envelope_y) in enumerate(rows_data):
        mix = row_index / (len(rows_data) - 1)
        hem_blend = max(0.0, min(1.0, (0.24 - mix) / 0.24))
        for column_index in range(column_count):
            u = -1.0 + 2.0 * column_index / (column_count - 1)
            x = half_width * u
            # The row envelope is already the frontmost body point. Keeping
            # the cross-body curve below 4 mm guarantees at least 14 mm of
            # clearance while preventing left/right anatomical cup outlines.
            y = envelope_y - (0.018 + 0.032 * hem_blend) + 0.004 * u * u
            positions.append((x, y, z))
    return positions, row_count, column_count


def add_tailored_front_panel(builder, body, armature, hem_z: float, *, material: int):
    """Lay one continuous, tapered jacket front over the anatomical shell."""
    positions, row_count, column_count = tailored_front_positions(
        [vertex.co for vertex in body.data.vertices], armature, hem_z,
    )
    indices = [
        builder.vertex(position, weights_at_z(armature, position[2]))
        for position in positions
    ]
    rows = [
        indices[index * column_count:(index + 1) * column_count]
        for index in range(row_count)
    ]
    for lower, upper in zip(rows, rows[1:]):
        for column_index in range(column_count - 1):
            builder.face((
                lower[column_index],
                lower[column_index + 1],
                upper[column_index + 1],
                upper[column_index],
            ), material)
    return indices


def vertex_weight_map(garment):
    group_names = {group.index: group.name for group in garment.vertex_groups}
    return {
        vertex.index: {
            group_names[membership.group]: membership.weight
            for membership in vertex.groups
            if membership.group in group_names
        }
        for vertex in garment.data.vertices
    }


def component_top_by_vertex(mesh):
    """Map each vertex to the top of its disconnected source-body piece."""
    neighbours = [set() for _ in mesh.vertices]
    for polygon in mesh.polygons:
        vertices = tuple(polygon.vertices)
        for first, second in zip(vertices, vertices[1:] + vertices[:1]):
            neighbours[first].add(second)
            neighbours[second].add(first)
    result = [float("-inf")] * len(mesh.vertices)
    visited = set()
    for start in range(len(mesh.vertices)):
        if start in visited:
            continue
        stack = [start]
        component = []
        visited.add(start)
        while stack:
            current = stack.pop()
            component.append(current)
            for neighbour in neighbours[current]:
                if neighbour not in visited:
                    visited.add(neighbour)
                    stack.append(neighbour)
        top = max(mesh.vertices[index].co.z for index in component)
        for index in component:
            result[index] = top
    return result


def structure_front_panel(body, jacket, armature) -> None:
    """Bridge the bust/pec surface with a softly curved tailored envelope.

    A direct body offset is excellent for animation clearance but can trace
    anatomy too literally.  For each authored profile independently, this
    moves only recessed front vertices out to that profile's own frontmost
    chest envelope.  Peak vertices are never pulled inward, so the result adds
    structure without sacrificing clearance on Muscle/Curvy bodies.
    """
    body_keys = body.data.shape_keys.key_blocks
    jacket_keys = jacket.data.shape_keys.key_blocks
    lower_z = bone(armature, "spine_02").head_local.z + 0.005
    upper_z = bone(armature, "spine_03").tail_local.z - 0.012
    chest_half = min(0.235, abs(bone(armature, "upperarm_l").head_local.x) + 0.060)
    for profile_name in ("Basis", "Muscle", "YouthfulAdult"):
        source = body_keys.get(profile_name)
        target = jacket_keys.get(profile_name)
        if source is None or target is None:
            raise RuntimeError(f"Poplur jacket is missing profile {profile_name}")

        envelope_points = [
            point.co for point in source.data
            if lower_z - 0.020 <= point.co.z <= upper_z + 0.020
            and abs(point.co.x) <= chest_half
        ]
        if not envelope_points:
            raise RuntimeError(f"Could not measure {profile_name} jacket front envelope")
        envelope_y = min(point.y for point in envelope_points)
        middle_z = (lower_z + upper_z) * 0.5
        half_height = (upper_z - lower_z) * 0.5
        for vertex_index, source_point in enumerate(source.data):
            co = source_point.co
            if not (lower_z <= co.z <= upper_z and co.y < 0.015 and abs(co.x) < chest_half):
                continue
            horizontal = abs(co.x) / chest_half
            vertical = abs(co.z - middle_z) / half_height
            desired_y = envelope_y - 0.012 + 0.010 * horizontal ** 2 + 0.008 * vertical ** 2
            current_y = target.data[vertex_index].co.y
            if desired_y >= current_y:
                continue
            vertical_blend = min(
                1.0,
                (co.z - lower_z) / 0.035,
                (upper_z - co.z) / 0.035,
            )
            side_blend = min(1.0, (chest_half - abs(co.x)) / 0.040)
            blend = max(0.0, vertical_blend * side_blend * 0.92)
            target.data[vertex_index].co.y = current_y + (desired_y - current_y) * blend


def build_fitted_shell(body, armature, primary):
    """Cut a close jacket from the body's own morphable weighted surface."""
    jacket = body.copy()
    jacket.data = body.data.copy()
    bpy.context.collection.objects.link(jacket)
    jacket.name = "PoplurAtelierArcJacket"
    jacket.data.name = "PoplurAtelierArcJacket"
    jacket["poplur_slot"] = "top"
    jacket["poplur_tint_material"] = "PoplurAtelierTint"
    jacket["poplur_collection"] = "Poplur 2026 / Arc One"

    pelvis_z = bone(armature, "pelvis").head_local.z
    shoulder_x = abs(bone(armature, "upperarm_l").head_local.x)
    neck_z = bone(armature, "neck_01").head_local.z
    hand_x = abs(bone(armature, "hand_l").head_local.x)
    # Cover the waistband without extending into disconnected source-body
    # panels below the hip; those read as pointed tabs in the phone view.
    hem_z = pelvis_z + 0.020
    cuff_x = hand_x - 0.035
    all_weights = vertex_weight_map(jacket)
    component_tops = component_top_by_vertex(jacket.data)
    torso_groups = {
        "pelvis", "spine_01", "spine_02", "spine_03",
        "clavicle_l", "clavicle_r", "neck_01",
    }
    arm_groups = {"upperarm_l", "lowerarm_l", "upperarm_r", "lowerarm_r"}

    # Offset every authored profile by the same cloth allowance. The morph
    # deltas therefore remain equivalent to the body while the Basis stays
    # 10-20 mm clear through torso, elbow and wrist deformation.
    normals = [vertex.normal.copy().normalized() for vertex in jacket.data.vertices]
    key_blocks = jacket.data.shape_keys.key_blocks if jacket.data.shape_keys else []
    for vertex in jacket.data.vertices:
        weights = all_weights[vertex.index]
        torso_weight = sum(weights.get(name, 0.0) for name in torso_groups)
        arm_weight = sum(weights.get(name, 0.0) for name in arm_groups)
        distance = abs(vertex.co.x)
        if arm_weight > torso_weight and distance > shoulder_x * 0.90:
            progress = max(0.0, min(1.0, (distance - shoulder_x) / max(1e-6, cuff_x - shoulder_x)))
            ease = 0.009 * (1.0 - progress) + 0.006 * progress
        else:
            chest = max(0.0, 1.0 - abs(vertex.co.z - (neck_z - 0.16)) / 0.20)
            ease = 0.008 + 0.003 * chest
        if key_blocks:
            for key in key_blocks:
                key.data[vertex.index].co += normals[vertex.index] * ease
        else:
            vertex.co += normals[vertex.index] * ease

    keep = set()
    for vertex in jacket.data.vertices:
        weights = all_weights[vertex.index]
        torso_weight = sum(weights.get(name, 0.0) for name in torso_groups)
        arm_weight = sum(weights.get(name, 0.0) for name in arm_groups)
        is_torso = (
            vertex.co.z >= hem_z + 0.130
            and vertex.co.z <= neck_z + 0.035
            and abs(vertex.co.x) <= shoulder_x + 0.075
        )
        is_sleeve = (
            abs(vertex.co.x) >= shoulder_x * 0.72
            and abs(vertex.co.x) <= cuff_x + 0.006
            and arm_weight >= 0.12
        )
        if is_torso or is_sleeve:
            # The source superhero mesh has separate leg panels reaching into
            # the jacket hem. Keep only upper-body components so those pieces
            # cannot appear as triangular tabs over the trousers.
            if component_tops[vertex.index] >= neck_z - 0.13:
                keep.add(vertex.index)

    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = jacket
    jacket.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for vertex in jacket.data.vertices:
        vertex.select = vertex.index not in keep
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    jacket.data.update()
    minimum_vertices = 1_200
    if len(jacket.data.vertices) < minimum_vertices:
        raise RuntimeError(f"Fitted jacket selection is unexpectedly small: {len(jacket.data.vertices)}")

    jacket.data.materials.clear()
    jacket.data.materials.append(primary)
    for polygon in jacket.data.polygons:
        polygon.material_index = 0
        polygon.use_smooth = True
    modifier = next((item for item in jacket.modifiers if item.type == "ARMATURE"), None)
    if modifier is None:
        modifier = jacket.modifiers.new("PoplurArmature", "ARMATURE")
    modifier.object = armature
    modifier.use_deform_preserve_volume = True
    jacket.parent = armature
    return jacket, hem_z, cuff_x


def build_tailoring_details(body, armature, hem_z: float, cuff_x: float, materials):
    primary, accent, rib = materials
    builder = GarmentMeshBuilder()

    # A narrow knitted hem finishes the body-derived shell without changing
    # its silhouette.  The previous deep outer band and separate front panel
    # read as a rigid box in the live front view even though they cleared the
    # body, so every radius here stays within the shell's real cloth ease.
    panel_stations = (
        (hem_z - 0.008, 0.018),
        (hem_z + 0.045, 0.014),
        (hem_z + 0.095, 0.011),
        (hem_z + 0.145, 0.010),
    )

    lower_panel = []
    for z, ease in sorted(set(panel_stations)):
        panel_x, panel_front, panel_back, panel_y = body_section(body, z, x_limit=0.31)
        lower_panel.append((
            z,
            panel_x + ease,
            panel_front + ease + 0.020,
            panel_back + ease,
            panel_y,
        ))
    builder.z_tube(
        lower_panel,
        weights=lambda z: weights_at_z(armature, z),
        material=0,
        segments=36,
    )

    # The collar is measured from the actual neck section, with only 11 mm of
    # radial allowance. It replaces the former oversized floating cone.
    neck = bone(armature, "neck_01")
    collar_bottom = neck.head_local.z - 0.006
    collar_top = min(neck.tail_local.z - 0.008, collar_bottom + 0.036)
    neck_x, neck_front, neck_back, neck_y = body_section(
        body, collar_bottom + 0.010, x_limit=0.095, band=0.020,
    )
    builder.z_tube([
        (collar_bottom, neck_x + 0.007, neck_front + 0.007, neck_back + 0.007, neck_y),
        (collar_top, neck_x + 0.006, neck_front + 0.006, neck_back + 0.006, neck_y),
    ], weights=lambda z: weights_at_z(armature, z), material=0, segments=32)

    # Two broad lapel edges frame the new V opening. They are sampled against
    # the body surface, share the live torso weights, and stay close enough to
    # read as cloth rather than floating decorative props.
    lapel_tip_z = bone(armature, "spine_03").head_local.z + 0.055
    lapel_top_z = collar_bottom + 0.008
    for sign in (-1, 1):
        lapel_points = []
        for x, z in (
            (sign * 0.012, lapel_tip_z),
            (sign * 0.070, lapel_tip_z + (lapel_top_z - lapel_tip_z) * 0.48),
            (sign * 0.102, lapel_top_z),
        ):
            lapel_points.append((x, front_surface_y(body, x, z) - 0.027, z))
        builder.ribbon(
            lapel_points,
            half_width=0.009,
            weights=lambda point: weights_at_z(armature, point[2]),
            material=1,
        )

    # Slim pocket welts and a centre closure make the silhouette legible at
    # phone size without relying on a texture atlas or another runtime asset.
    pocket_z = hem_z + 0.205
    for sign in (-1, 1):
        pocket_points = []
        for x in (sign * 0.045, sign * 0.120):
            pocket_points.append((x, front_surface_y(body, x, pocket_z) - 0.025, pocket_z + sign * x * 0.025))
        builder.ribbon(
            pocket_points,
            half_width=0.0045,
            weights=lambda point: weights_at_z(armature, point[2]),
            material=1,
        )

    # Thin, body-measured cuffs stop before the hand joint and keep the hand
    # fully visible. The adjacent sleeve surface already tapers with the arm.
    for sign, side in ((1, "l"), (-1, "r")):
        x = sign * cuff_x
        lowerarm = bone(armature, f"lowerarm_{side}")
        radius_y, radius_z, center_y, center_z = arm_section(body, x, lowerarm.head_local.z)
        builder.x_tube([
            (x - sign * 0.028, radius_y + 0.006, radius_z + 0.006, center_y, center_z),
            (x, radius_y + 0.006, radius_z + 0.006, center_y, center_z),
        ], weights=lambda _x, side=side: {f"lowerarm_{side}": 1.0}, material=2, segments=28)

        # A narrow armhole band follows the upper-arm root; it defines the
        # sleeve join without extending the shoulder silhouette sideways.
        upperarm = bone(armature, f"upperarm_{side}")
        armhole_x = upperarm.head_local.x + sign * 0.038
        hole_y, hole_z, hole_center_y, hole_center_z = arm_section(
            body, armhole_x, upperarm.head_local.z,
        )
        builder.x_tube([
            (armhole_x - sign * 0.004, hole_y + 0.009, hole_z + 0.009, hole_center_y, hole_center_z),
            (armhole_x + sign * 0.004, hole_y + 0.010, hole_z + 0.010, hole_center_y, hole_center_z),
        ], weights=lambda _x, side=side: {
            f"clavicle_{side}": 0.28,
            f"upperarm_{side}": 0.72,
        }, material=1, segments=28)

    # Original asymmetric Arc seam. Every point is sampled against the front
    # body surface, so the ribbon cannot float in front of a slimmer torso.
    spine_01_z = bone(armature, "spine_01").head_local.z
    spine_02_z = bone(armature, "spine_02").head_local.z
    spine_03_z = bone(armature, "spine_03").head_local.z
    arc_xz = [
        (-0.050, collar_bottom - 0.010),
        (-0.068, spine_03_z + 0.055),
        (-0.034, spine_02_z + 0.035),
        (0.012, spine_01_z + 0.038),
        (0.045, hem_z + 0.024),
    ]
    arc_points = [
        (x, front_envelope_y(body, z, 0.22) - 0.032, z)
        for x, z in arc_xz
    ]
    builder.ribbon(
        arc_points,
        half_width=0.0035,
        weights=lambda point: weights_at_z(armature, point[2]),
        material=1,
    )

    details = builder.build(
        name="PoplurAtelierArcDetails",
        materials=[primary, accent, rib],
        body=body,
        armature=armature,
        slot="top",
        tint_material="PoplurAtelierTint",
        collection="Poplur 2026 / Arc One",
    )
    return details


def export_jacket(armature, garments, output) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for garment in garments:
        garment.select_set(True)
    bpy.context.view_layer.objects.active = garments[0]
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


def build(label: str, source_file: str, output_file: str) -> None:
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(MODEL_ROOT / source_file))
    body, armature = imported_body_and_armature()

    primary = pbr_material(
        "PoplurAtelierTint", (0.18, 0.42, 0.82, 1.0),
        roughness=0.58, metallic=0.0, coat=0.03, sheen=0.18,
    )
    accent = pbr_material(
        "PoplurAtelierArc", (0.085, 0.055, 0.115, 1.0),
        roughness=0.60, metallic=0.0, coat=0.02,
    )
    rib = pbr_material(
        "PoplurAtelierRib", (0.075, 0.045, 0.095, 1.0),
        roughness=0.62, metallic=0.0, sheen=0.22,
    )

    shell, hem_z, cuff_x = build_fitted_shell(body, armature, primary)
    details = build_tailoring_details(body, armature, hem_z, cuff_x, (primary, accent, rib))
    output = MODEL_ROOT / output_file
    export_jacket(armature, (shell, details), output)
    print(
        f"Built {label} fitted Arc jacket: {output} "
        f"({len(shell.data.vertices)} shell + {len(details.data.vertices)} detail vertices)"
    )


for spec in JACKETS:
    build(*spec)
