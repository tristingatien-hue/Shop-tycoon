#!/usr/bin/env python3
"""Passive phone horn speaker: parametric model.

Builds the folded exponential horn from the planning notes (throat 15 x 6 mm,
mouth 150 x 100 mm, ~233 mm path, area = 90 * e^(0.022 * s)) and exports two
clamshell halves ready for slicing on an Ender 3 Pro.

    pip install numpy trimesh manifold3d shapely matplotlib
    python3 horn.py            # writes STLs + previews into ./out

Every dimension is a named parameter below. Change a number and re-run.
"""
import math
import os

import numpy as np
import shapely.geometry as sg
import trimesh

# ----------------------------------------------------------------------------
# Parameters (mm)
# ----------------------------------------------------------------------------
THROAT_H = 6.0      # throat size along the phone's thickness (in the side view)
THROAT_W = 15.0     # throat size along the phone's bottom edge
MOUTH_H = 100.0     # mouth height
MOUTH_W = 150.0     # mouth width
PATH_LEN = 233.0    # centreline length, throat to mouth
FLARE_M = 0.022     # area = THROAT_H*THROAT_W * e^(FLARE_M * s)  (~600 Hz cutoff)

WALL = 5.0          # wall around the channel in the side view (fits alignment pins)
DROP = 10.0         # straight vertical run below the throat before the bend
BEND_R = 36.0       # outer-wall bend radius (centreline radius >= 2x channel)

SLOT_T = 14.0       # phone slot thickness (phone + case)
SLOT_L = 84.0       # phone slot length (phone width + case + clearance)
SLOT_DEPTH = 40.0   # how deep the phone sits
SLOT_WALL = 4.0
SPEAKER_OFFSET = 0.0  # grille centre minus phone centre, along the bottom edge.
                      # Measure your phone; + moves the phone toward -Y.

PIN_D = 1.9         # alignment holes for 1.75 mm filament dowels
PIN_DEPTH = 6.0     # per half
STEP = 0.25         # path sampling step

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")

# ----------------------------------------------------------------------------
# Flare: split growth so the section goes 6x15 -> 100x150 exactly at PATH_LEN
# ----------------------------------------------------------------------------
K_H = math.log(MOUTH_H / THROAT_H) / PATH_LEN
K_W = math.log(MOUTH_W / THROAT_W) / PATH_LEN


def h_at(s):
    return THROAT_H * math.exp(K_H * s)


def w_at(s):
    return THROAT_W * math.exp(K_W * s)


def area_target(s):
    return THROAT_H * THROAT_W * math.exp(FLARE_M * s)


# ----------------------------------------------------------------------------
# Guide curve = back/bottom wall of the channel (X forward, Z up).
# Vertical drop at x=0, quarter bend, then a flat floor at z=WALL.
# ----------------------------------------------------------------------------
Z_FLOOR = WALL
Z_BEND = Z_FLOOR + BEND_R
Z_THROAT = Z_BEND + DROP


def guide(u):
    """Point and inward normal at guide arc-length u."""
    if u <= DROP:
        return np.array([0.0, Z_THROAT - u]), np.array([1.0, 0.0])
    u -= DROP
    arc = math.pi / 2 * BEND_R
    if u <= arc:
        a = u / BEND_R  # 0 -> pi/2
        centre = np.array([BEND_R, Z_BEND])
        p = centre + BEND_R * np.array([-math.cos(a), -math.sin(a)])
        return p, (centre - p) / BEND_R
    u -= arc
    return np.array([BEND_R + u, Z_FLOOR]), np.array([0.0, 1.0])


def build_stations():
    """March the guide, accumulating centreline length s, until s == PATH_LEN."""
    stations = []
    u, s = 0.0, 0.0
    p, n = guide(0.0)
    prev_c = p + n * h_at(0.0) / 2
    while True:
        h = h_at(s)
        p, n = guide(u)
        c = p + n * h / 2
        s += float(np.linalg.norm(c - prev_c))
        prev_c = c
        h = h_at(min(s, PATH_LEN))
        stations.append((min(s, PATH_LEN), p.copy(), n.copy(), h, w_at(min(s, PATH_LEN))))
        if s >= PATH_LEN:
            return stations
        u += STEP


def loft(sections):
    """Closed mesh from a list of 4-point rectangular sections."""
    verts = np.array([pt for sec in sections for pt in sec])
    faces = []
    for i in range(len(sections) - 1):
        a, b = 4 * i, 4 * (i + 1)
        for k in range(4):
            k2 = (k + 1) % 4
            faces += [[a + k, b + k, b + k2], [a + k, b + k2, a + k2]]
    last = 4 * (len(sections) - 1)
    faces += [[0, 1, 2], [0, 2, 3], [last, last + 2, last + 1], [last, last + 3, last + 2]]
    mesh = trimesh.Trimesh(verts, faces, process=True)
    if mesh.volume < 0:
        mesh.invert()
    assert mesh.is_volume, "channel loft is not a closed volume"
    return mesh


def section(p, n, h, w, y0=0.0):
    """Rectangle across the channel: from guide point p, inward by h, width w."""
    q = p + n * h
    return [
        [p[0], y0 - w / 2, p[1]],
        [q[0], y0 - w / 2, q[1]],
        [q[0], y0 + w / 2, q[1]],
        [p[0], y0 + w / 2, p[1]],
    ]


def main():
    os.makedirs(OUT, exist_ok=True)
    st = build_stations()
    s_end, p_end, _, h_end, w_end = st[-1]
    x_mouth = p_end[0]

    # --- channel solid (extended past both ends so the cuts are clean) ---
    secs = [section(p + np.array([0, 2.0]), n, h, w) for (_, p, n, h, w) in st[:1]]
    secs += [section(p, n, h, w) for (_, p, n, h, w) in st[::2]]
    secs.append(section(p_end + np.array([20.0, 0]), st[-1][2], h_end, w_end))
    channel = loft(secs)

    # --- side silhouette of the body ---
    inner = [tuple(p + n * h) for (_, p, n, h, _) in st]
    outer = [tuple(p) for (_, p, _, _, _) in st]
    band = sg.Polygon(outer + inner[::-1]).buffer(0)
    body2d = band.buffer(WALL, join_style=1)
    slot_x0 = THROAT_H / 2 - SLOT_T / 2
    tower = sg.box(slot_x0 - SLOT_WALL, Z_THROAT - WALL,
                   slot_x0 + SLOT_T + SLOT_WALL, Z_THROAT + SLOT_DEPTH)
    body2d = body2d.union(tower)
    body2d = body2d.intersection(sg.box(-100, 0, x_mouth, 400))  # flat base, flat mouth
    body2d = body2d.simplify(0.05)

    body_w = MOUTH_W + 2 * WALL
    body = trimesh.creation.extrude_polygon(body2d, body_w)
    # extrude_polygon builds in XY and extrudes along Z; turn that into X-Z / Y.
    body.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0]))
    body.apply_translation([0, body_w / 2, 0])

    # --- phone slot, throat neck ---
    slot_y = -SPEAKER_OFFSET
    slot = trimesh.creation.box(
        [SLOT_T, SLOT_L, SLOT_DEPTH + 10],
        trimesh.transformations.translation_matrix(
            [slot_x0 + SLOT_T / 2, slot_y, Z_THROAT + (SLOT_DEPTH + 10) / 2]))
    assert abs(slot_y) + SLOT_L / 2 <= body_w / 2 - 2, "slot runs out of the body"

    # --- alignment pin holes, along the wall band, both sides of the channel ---
    pins = []
    for i in range(0, len(st), int(45 / STEP)):
        _, p, n, h, _ = st[i]
        for pt in (p - n * WALL / 2, p + n * (h + WALL / 2)):
            if pt[0] < x_mouth - 6 and pt[1] > 3:
                cyl = trimesh.creation.cylinder(PIN_D / 2, 2 * PIN_DEPTH, sections=24)
                cyl.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0]))
                cyl.apply_translation([pt[0], 0, pt[1]])
                pins.append(cyl)

    solid = trimesh.boolean.difference([body, channel, slot] + pins, engine="manifold")

    # --- clamshell split on the horn's centre plane ---
    big = 1000
    keep_pos = trimesh.creation.box([big, big, big], trimesh.transformations.translation_matrix([0, big / 2, 0]))
    keep_neg = trimesh.creation.box([big, big, big], trimesh.transformations.translation_matrix([0, -big / 2, 0]))
    half_a = trimesh.boolean.intersection([solid, keep_pos], engine="manifold")
    half_b = trimesh.boolean.intersection([solid, keep_neg], engine="manifold")

    # Print orientation: flat outer face on the bed, split face (open channel) up.
    half_a.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))
    half_b.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0]))
    for m in (half_a, half_b):
        m.apply_translation(-m.bounds[0])

    solid.export(os.path.join(OUT, "horn_assembled.stl"))
    half_a.export(os.path.join(OUT, "horn_half_A.stl"))
    half_b.export(os.path.join(OUT, "horn_half_B.stl"))

    # --- report ---
    print(f"centreline length      {s_end:.1f} mm")
    print(f"mouth (h x w)          {h_end:.1f} x {w_end:.1f} mm = {h_end * w_end:,.0f} mm^2"
          f" (target {area_target(PATH_LEN):,.0f})")
    print(f"centreline bend radius {BEND_R - h_at(DROP + math.pi / 4 * BEND_R) / 2:.1f} mm"
          f" vs channel {h_at(DROP + math.pi / 4 * BEND_R):.1f} mm")
    ext = solid.bounds[1] - solid.bounds[0]
    print(f"assembled (x,y,z)      {ext[0]:.0f} x {ext[1]:.0f} x {ext[2]:.0f} mm")
    for name, m in (("A", half_a), ("B", half_b)):
        e = m.extents
        sa = m.area / 2  # approx. one side of each wall gets perimeters
        grams = 1.24 * (sa * 1.2 + max(m.volume - sa * 1.2, 0) * 0.40) / 1000
        print(f"half {name}: {e[0]:.0f} x {e[1]:.0f} x {e[2]:.0f} mm, watertight={m.is_watertight},"
              f" solid {m.volume / 1000:.0f} cm^3, ~{grams:.0f} g PLA at 40% gyroid")
    print(f"pin holes per half     {len(pins)}")

    render(st, body2d)


def render(st, body2d):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(1, 2, figsize=(13, 5.5))
    x, z = body2d.exterior.xy
    ax[0].fill(x, z, color="#c8a46a", ec="#6b4f1d")
    inner = [p + n * h for (_, p, n, h, _) in st]
    outer = [p for (_, p, _, _, _) in st]
    chan = np.array(outer + inner[::-1])
    ax[0].fill(chan[:, 0], chan[:, 1], color="#1f1f1f")
    cl = np.array([p + n * h / 2 for (_, p, n, h, _) in st])
    ax[0].plot(cl[:, 0], cl[:, 1], "--", color="#f0a030", lw=1, label="centreline")
    ax[0].set_aspect("equal")
    ax[0].set_title("Side section (phone slot top-left, mouth right)")
    ax[0].legend(loc="upper right")
    s = np.array([t[0] for t in st])
    ax[1].plot(s, [t[3] * t[4] for t in st], label="model h x w")
    ax[1].plot(s, [area_target(v) for v in s], "--", label="90 e^(0.022 s)")
    ax[1].set_yscale("log")
    ax[1].set_xlabel("distance along centreline (mm)")
    ax[1].set_ylabel("area (mm^2)")
    ax[1].set_title("Flare check")
    ax[1].legend()
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "preview_section.png"), dpi=110)



if __name__ == "__main__":
    main()
