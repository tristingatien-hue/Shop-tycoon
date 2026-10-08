#!/usr/bin/env python3
"""Phone horn v2 ("snail"): flat spiral throat section plus a round flanged bell.

The acoustic choices came from ../sim (see ../v2/DESIGN.md):
  * hypex flare, 350 Hz, T = 0.7: gain extends down to ~400 Hz, where v1 gave
    little below ~600 Hz. It needs ~440 mm of path, so the path is coiled.
  * The coil is a flat spiral with a tall, narrow channel. Bends only hurt the
    sound through the width in the bend plane, and that stays narrow (<= 48 mm).
  * Round bell with a flanged roll-over mouth, which cuts mouth reflections.

Parts (all print without supports on an Ender 3 Pro):
  tray.stl  spiral channel, open on top, prints base-down
  lid.stl   flat lid with throat hole and phone slot, prints plate-down
  bell.stl  round bell, prints mouth-up on its joint plate

    pip install numpy scipy trimesh manifold3d shapely matplotlib
    python3 horn2.py
"""
import math
import os
import sys

import numpy as np
import shapely.geometry as sg
import shapely.affinity as sa
import trimesh
from trimesh import transformations as tf

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sim"))
import hornsim  # noqa: E402

# ----------------------------------------------------------------------------
# Parameters (mm)
# ----------------------------------------------------------------------------
FC = 350.0          # flare frequency
T_HYPEX = 0.7       # hypex shape (1.0 = exponential, lower = slower start)
THROAT_A = 90.0     # 15 x 6 mm, matches the phone grille
MOUTH_D = 150.0     # bell mouth diameter before the roll-over
LIP_R = 12.0        # roll-over radius into the flange

S_SPIRAL = 300.0    # path length in the tray (rest is the bell)
EXIT_STRAIGHT = 60.0   # straight run so the bell starts clear of the coil
H0, W0 = 15.0, 6.0  # channel height / in-plane width at the throat
H_EXIT = 64.0       # channel height where it leaves the tray
R0 = 12.0           # inner wall radius at the start of the spiral
T_WALL = 3.2        # wall between spiral turns (8 perimeters at 0.4)
T_OUTER = 6.0       # outer tray wall (room for alignment pins)
LID_T = 4.0
BELL_WALL = 4.0
PLATE_T = 6.0       # bell joint plate
ROUND_LEN = 45.0    # bell length over which the rectangle becomes a circle

SLOT_T, SLOT_L, SLOT_DEPTH, SLOT_WALL = 14.0, 84.0, 35.0, 4.0
SPEAKER_OFFSET = 0.0  # grille centre minus phone centre along the bottom edge
PIN_D, PIN_DEPTH = 1.9, 6.0
DS = 0.5

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

X0 = 343000 / (2 * math.pi * FC)


def area(s):
    return THROAT_A * (math.cosh(s / X0) + T_HYPEX * math.sinh(s / X0)) ** 2


def mouth_s():
    target = math.pi * MOUTH_D ** 2 / 4
    lo, hi = 0.0, 2000.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if area(mid) < target else (lo, mid)
    return lo


L_TOTAL = mouth_s()
W_EXIT = area(S_SPIRAL) / H_EXIT


def w_at(s):
    s = max(s, 0.0)
    return W0 * (W_EXIT / W0) ** (min(s, S_SPIRAL) / S_SPIRAL)


def h_at(s):
    s = max(s, 0.0)
    return area(min(s, S_SPIRAL)) / w_at(s)


# ----------------------------------------------------------------------------
# Spiral layout (plan view). Channel = band between inner and outer wall.
# ----------------------------------------------------------------------------
def build_spiral():
    s, th = -15.0, 0.0           # closed end sits 15 mm before s=0 (under the grille)
    hist_th, hist_rout = [], []
    st = []
    s_end = S_SPIRAL - EXIT_STRAIGHT
    while s <= s_end:
        w = w_at(s)
        if th < 2 * math.pi:
            rin = R0 + (W0 + T_WALL) * th / (2 * math.pi)
        else:
            rin = float(np.interp(th - 2 * math.pi, hist_th, hist_rout)) + T_WALL
        rout = rin + w
        hist_th.append(th)
        hist_rout.append(rout)
        st.append(dict(s=s, th=th, rin=rin, rout=rout, w=w, h=h_at(s)))
        th += DS / (rin + w / 2)
        s += DS
    return st


def stations():
    """Return per-station inner/outer wall points (plan) plus h, s."""
    sp = build_spiral()
    out = []
    for d in sp:
        u = np.array([math.cos(d["th"]), math.sin(d["th"])])
        out.append(dict(s=d["s"], pin=d["rin"] * u, pout=d["rout"] * u, h=d["h"], w=d["w"]))
    # straight exit along the final tangent
    c1 = (out[-1]["pin"] + out[-1]["pout"]) / 2
    c0 = (out[-3]["pin"] + out[-3]["pout"]) / 2
    t = (c1 - c0) / np.linalg.norm(c1 - c0)
    nrm = np.array([-t[1], t[0]])
    if np.dot(nrm, out[-1]["pin"] - c1) < 0:
        nrm = -nrm
    s0 = out[-1]["s"]
    for k in range(1, int(EXIT_STRAIGHT / DS) + 1):
        s = s0 + k * DS
        c = c1 + t * (k * DS)
        w = w_at(s)
        out.append(dict(s=s, pin=c + nrm * w / 2, pout=c - nrm * w / 2, h=h_at(s), w=w))
    return out, t


def place(st, t):
    """Rotate/translate so the exit runs along +X and the exit face is at x=0."""
    ang = -math.atan2(t[1], t[0])
    R = np.array([[math.cos(ang), -math.sin(ang)], [math.sin(ang), math.cos(ang)]])
    for d in st:
        d["pin"], d["pout"] = R @ d["pin"], R @ d["pout"]
    end = (st[-1]["pin"] + st[-1]["pout"]) / 2
    for d in st:
        d["pin"], d["pout"] = d["pin"] - end, d["pout"] - end
    return st


def loft(sections):
    verts = np.array([p for sec in sections for p in sec])
    n = len(sections[0])
    faces = []
    for i in range(len(sections) - 1):
        a, b = n * i, n * (i + 1)
        for k in range(n):
            k2 = (k + 1) % n
            faces += [[a + k, b + k, b + k2], [a + k, b + k2, a + k2]]
    last = n * (len(sections) - 1)
    for k in range(1, n - 1):
        faces += [[0, k, k + 1], [last, last + k + 1, last + k]]
    m = trimesh.Trimesh(verts, faces, process=True)
    if m.volume < 0:
        m.invert()
    assert m.is_volume, "loft is not a closed volume"
    return m


def pin(x, y, z, axis, depth=PIN_DEPTH):
    c = trimesh.creation.cylinder(PIN_D / 2, 2 * depth, sections=20)
    if axis == "x":
        c.apply_transform(tf.rotation_matrix(math.pi / 2, [0, 1, 0]))
    c.apply_translation([x, y, z])
    return c


def bell_section(u, n_pts=96):
    """Bell interior cross-section at distance u from the joint, in (y, z) about the axis."""
    s = S_SPIRAL + u
    A = area(min(s, L_TOTAL))
    k = min(max(u / ROUND_LEN, 0.0), 1.0)
    k = k * k * (3 - 2 * k)
    n = 8.0 * (2 / 8.0) ** k            # superellipse exponent 8 -> 2
    aspect = (H_EXIT / W_EXIT) ** (1 - k)  # height / width
    g = math.gamma(1 + 1 / n) ** 2 / math.gamma(1 + 2 / n)
    a = math.sqrt(A / (4 * g * aspect))  # half-width
    b = a * aspect                        # half-height
    ang = np.linspace(0, 2 * math.pi, n_pts, endpoint=False)
    c, si = np.cos(ang), np.sin(ang)
    y = a * np.sign(c) * np.abs(c) ** (2 / n)
    z = b * np.sign(si) * np.abs(si) ** (2 / n)
    return y, z


def build_bell():
    u_m = L_TOTAL - S_SPIRAL
    us = list(np.arange(-1.0, u_m, 1.0)) + [u_m]
    secs, rmax = [], []
    for u in us:
        y, z = bell_section(max(u, 0.0))
        secs.append([[u, yy, zz] for yy, zz in zip(y, z)])
        rmax.append(float(np.max(np.hypot(y, z))))
    # roll-over: quarter torus from the mouth into a flat flange
    rm = MOUTH_D / 2
    ang = np.linspace(0, 2 * math.pi, 96, endpoint=False)
    for phi in np.linspace(0, math.pi / 2, 16)[1:]:
        r = rm + LIP_R * (1 - math.cos(phi))
        u = u_m + LIP_R * math.sin(phi)
        secs.append([[u, r * math.cos(t), r * math.sin(t)] for t in ang])
        us.append(u)
        rmax.append(r)
    secs.append([[us[-1] + 1, (rm + LIP_R + 0.5) * math.cos(t), (rm + LIP_R + 0.5) * math.sin(t)] for t in ang])
    inner = loft(secs)
    u_top = u_m + LIP_R

    # exterior: wall offset, never steeper than 45 deg when printed mouth-up
    grid = np.arange(0.0, u_top + 0.001, 1.0)
    rint = np.interp(grid, us, rmax)
    rext = rint + BELL_WALL
    rext[-1] = rm + LIP_R + 4.0
    for i in range(len(grid) - 2, -1, -1):
        rext[i] = max(rext[i], rext[i + 1] - 1.0)
    prof = [(0.0, 0.0)] + [(r, u) for r, u in zip(rext, grid)] + [(0.0, grid[-1])]
    outer = trimesh.creation.revolve(prof, sections=128)  # around Z, Z = u
    outer.apply_transform(tf.rotation_matrix(math.pi / 2, [0, 1, 0]))  # Z -> +X

    # joint plate (matches the tray exit face)
    pw = W_EXIT + 24
    pz0, pz1 = -H_EXIT / 2 - 20, H_EXIT / 2 + LID_T
    plate = trimesh.creation.box([PLATE_T, pw, pz1 - pz0],
                                 tf.translation_matrix([PLATE_T / 2, 0, (pz0 + pz1) / 2]))
    holes = [pin(0, y, -H_EXIT / 2 - 10, "x") for y in (-pw / 2 + 8, pw / 2 - 8)]
    bell = trimesh.boolean.difference([trimesh.boolean.union([outer, plate], engine="manifold"), inner] + holes,
                                      engine="manifold")
    return bell, u_top, rext.max()


def main():
    os.makedirs(OUT, exist_ok=True)
    st, t = stations()
    st = place(st, t)

    _, u_top, r_bell = build_bell()
    z_axis_above_base = max(r_bell, H_EXIT / 2 + 20)  # bell flange sits on the desk
    Z_TOP = z_axis_above_base + H_EXIT / 2           # channel top / lid underside

    # --- plan outline ---
    band = sg.Polygon([tuple(d["pin"]) for d in st] + [tuple(d["pout"]) for d in st[::-1]]).buffer(0)
    body2d = sg.Polygon(band.buffer(T_OUTER, join_style=1).exterior)
    body2d = body2d.intersection(sg.box(-1000, -1000, 0, 1000)).simplify(0.05)

    # --- phone slot position (grille over the first 15 mm of channel) ---
    g0 = next(d for d in st if d["s"] >= -7.5)
    gc = (g0["pin"] + g0["pout"]) / 2
    g1 = next(d for d in st if d["s"] >= -6.5)
    tan = (g1["pin"] + g1["pout"]) / 2 - gc
    tan /= np.linalg.norm(tan)
    ang = math.atan2(tan[1], tan[0])
    pc = gc + tan * SPEAKER_OFFSET
    slot_fp = sa.rotate(sg.box(-SLOT_L / 2 - SLOT_WALL, -SLOT_T / 2 - SLOT_WALL,
                               SLOT_L / 2 + SLOT_WALL, SLOT_T / 2 + SLOT_WALL), ang, use_radians=True)
    slot_fp = sa.translate(slot_fp, pc[0], pc[1])
    body2d = body2d.union(slot_fp.buffer(3, join_style=1)).simplify(0.05)
    assert body2d.bounds[2] <= 0.5, "phone slot reaches past the exit face; lengthen EXIT_STRAIGHT"

    # --- tray ---
    tray = trimesh.creation.extrude_polygon(body2d, Z_TOP)
    secs = []
    picks = st[:-1:2] + [st[-1]]
    for d in picks:
        zb = Z_TOP - d["h"]
        pi_, po = d["pin"], d["pout"]
        if d is st[-1]:
            pi_, po = pi_ + np.array([2.0, 0]), po + np.array([2.0, 0])
        secs.append([[pi_[0], pi_[1], zb], [po[0], po[1], zb], [po[0], po[1], Z_TOP + 1], [pi_[0], pi_[1], Z_TOP + 1]])
    channel = loft(secs)

    # lid pins along the outer wall; exit-face pins below the channel
    ring = band.buffer(T_OUTER / 2, join_style=1).exterior
    lid_pins = []
    for f in np.linspace(0.05, 0.85, 6):
        p = ring.interpolate(f, normalized=True)
        if p.x < -8:
            lid_pins.append((p.x, p.y))
    exit_c = (st[-1]["pin"] + st[-1]["pout"]) / 2
    pw = W_EXIT + 24
    face_pins = [pin(0, exit_c[1] + y, Z_TOP - H_EXIT - 10, "x") for y in (-pw / 2 + 8, pw / 2 - 8)]
    tray = trimesh.boolean.difference(
        [tray, channel] + [pin(x, y, Z_TOP, "z") for x, y in lid_pins] + face_pins, engine="manifold")

    # --- lid ---
    lid = trimesh.creation.extrude_polygon(body2d, LID_T)
    grille = trimesh.creation.box([15.0, W0, 3 * LID_T])
    grille.apply_transform(tf.rotation_matrix(ang, [0, 0, 1]))
    grille.apply_translation([gc[0], gc[1], LID_T / 2])
    housing = trimesh.creation.box([SLOT_L + 2 * SLOT_WALL, SLOT_T + 2 * SLOT_WALL, SLOT_DEPTH])
    slot = trimesh.creation.box([SLOT_L, SLOT_T, SLOT_DEPTH + 2])
    for m, z in ((housing, LID_T + SLOT_DEPTH / 2 - 0.01), (slot, LID_T + SLOT_DEPTH / 2 + 1)):
        m.apply_transform(tf.rotation_matrix(ang, [0, 0, 1]))
        m.apply_translation([pc[0], pc[1], z])
    lid = trimesh.boolean.union([lid, housing], engine="manifold")
    lid = trimesh.boolean.difference([lid, slot, grille] + [pin(x, y, 0, "z", LID_T - 1) for x, y in lid_pins],
                                     engine="manifold")

    # --- bell, placed for the assembled view ---
    bell, _, _ = build_bell()
    bell_asm = bell.copy()
    bell_asm.apply_translation([0, exit_c[1], Z_TOP - H_EXIT / 2])
    lid_asm = lid.copy()
    lid_asm.apply_translation([0, 0, Z_TOP])
    assembled = trimesh.util.concatenate([tray, lid_asm, bell_asm])

    bell_print = bell.copy()
    bell_print.apply_transform(tf.rotation_matrix(-math.pi / 2, [0, 1, 0]))  # +X -> +Z
    for m in (tray, lid, bell_print):
        m.apply_translation(-m.bounds[0])

    tray.export(os.path.join(OUT, "tray.stl"))
    lid.export(os.path.join(OUT, "lid.stl"))
    bell_print.export(os.path.join(OUT, "bell.stl"))
    assembled.export(os.path.join(OUT, "assembled_preview.stl"))

    # --- report ---
    rc_w = []
    sp = build_spiral()
    for d in sp:
        rc_w.append((d["rin"] + d["w"] / 2) / d["w"])
    turns = sp[-1]["th"] / (2 * math.pi)
    print(f"total path         {L_TOTAL:.0f} mm  (tray {S_SPIRAL:.0f}, bell {L_TOTAL - S_SPIRAL:.0f} + lip)")
    print(f"spiral             {turns:.2f} turns, min bend radius / width = {min(rc_w):.2f}")
    print(f"exit channel       {W_EXIT:.0f} wide x {H_EXIT:.0f} tall")
    ext = assembled.extents
    print(f"assembled          {ext[0]:.0f} deep x {ext[1]:.0f} wide x {ext[2]:.0f} tall (without phone)")
    total = 0
    for name, m in (("tray", tray), ("lid", lid), ("bell", bell_print)):
        sa_ = m.area / 2
        gr = 1.24 * (sa_ * 1.2 + max(m.volume - sa_ * 1.2, 0) * 0.15) / 1000
        total += gr
        e = m.extents
        print(f"{name:5s} {e[0]:4.0f} x {e[1]:4.0f} x {e[2]:4.0f} mm  watertight={m.is_watertight}  ~{gr:.0f} g @15% infill")
        assert e[0] <= 215 and e[1] <= 215 and e[2] <= 245, f"{name} does not fit the Ender 3 Pro"
    print(f"total ~{total:.0f} g PLA")

    render(st, body2d, assembled)


def render(st, body2d, assembled):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(1, 3, figsize=(17, 5.6), gridspec_kw=dict(width_ratios=[1, 1, 1.2]))
    x, y = body2d.exterior.xy
    ax[0].fill(x, y, color="#c8a46a", ec="#6b4f1d")
    band = np.array([d["pin"] for d in st] + [d["pout"] for d in st[::-1]])
    ax[0].fill(band[:, 0], band[:, 1], color="#1f1f1f")
    ax[0].set_aspect("equal")
    ax[0].set_title("Tray, top view (exit to the bell on the right)")

    # side silhouette of the assembly
    from matplotlib.collections import PolyCollection
    tri = assembled.triangles[:, :, [0, 2]]
    ax[1].add_collection(PolyCollection(tri, facecolors="#c8a46a", edgecolors="none"))
    ph = np.array([[-45, 0], [-45, 160], [-36, 160], [-36, 0]])  # phone stand-in
    ax[1].fill(ph[:, 0], ph[:, 1] + assembled.bounds[1][2] - SLOT_DEPTH + 2, color="#555", alpha=0.5)
    ax[1].autoscale()
    ax[1].set_aspect("equal")
    ax[1].set_title("Assembly, side view (grey = phone)")

    F = np.geomspace(250, 8000, 220)
    s1 = np.linspace(0, 233, 240)
    g1 = hornsim.gain_db(90 * np.exp(0.022 * s1), s1, F)
    s2 = np.linspace(0, L_TOTAL, 500)
    g2 = hornsim.gain_db([area(s) for s in s2], s2, F)
    sm = lambda g: np.convolve(g, np.ones(9) / 9, mode="same")
    ax[2].semilogx(F, sm(g1), label="v1 (rectangular, 600 Hz exp, 233 mm)")
    ax[2].semilogx(F, sm(g2), label=f"v2 (round, 350 Hz hypex, {L_TOTAL:.0f} mm)")
    ax[2].axvspan(250, 500, color="#999", alpha=0.15, label="phone speaker rolls off")
    ax[2].set_xlim(250, 8000)
    ax[2].set_xlabel("Hz")
    ax[2].set_ylabel("power gain vs bare speaker (dB, model)")
    ax[2].set_title("Simulated gain (1/6-oct smoothed)")
    ax[2].legend(fontsize=8)
    ax[2].grid(alpha=0.3, which="both")
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "preview.png"), dpi=105)


if __name__ == "__main__":
    main()
