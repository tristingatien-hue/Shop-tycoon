"""Luffy diamond-art coaster generator.

Turns source.jpg into a 3D-printable coaster in the same style as the
Gear 5 One Piece coaster: flat disc, raised rim, raised outline art and
speed lines. Unlike the Gear 5 version, almost nothing is a solid raised
fill -- the art is reduced to thin walls so the recessed pockets between
them can be filled with diamond-art drills for colour.

Outputs (in this folder):
  luffy_coaster.stl         single print, one colour
  luffy_coaster_base.stl    base disc only   } same coordinates, load both
  luffy_coaster_lines.stl   raised walls only} for a two-colour swap
  preview_mask.png          top-down view (white = raised)
  preview_colour_guide.png  pockets tinted with the suggested drill colours

Run:  python3 make_coaster.py
Needs: pip install pillow numpy opencv-python-headless trimesh shapely mapbox_earcut
"""
import cv2
import numpy as np
import trimesh
from shapely.geometry import Polygon
from shapely.ops import unary_union

# ---- physical design (mm) ----
DIAMETER = 100.0     # matches the One Piece coaster
BASE_H = 3.0         # solid floor under the drills
WALL_H = 2.0         # raised art height above the floor (drills ~1.3-1.7 mm + glue)
RIM_W = 3.0          # outer rim width
WALL_W = 1.0         # outline wall width (2.5 nozzle widths at 0.4 mm)
MIN_POCKET = 3.0     # pockets narrower than this can't hold a 2.5-2.8 mm drill -> filled solid
PX_PER_MM = 10       # working raster resolution

N = int(DIAMETER * PX_PER_MM)
R = N // 2


def mm(v):
    return max(1, int(round(v * PX_PER_MM)))


def disc(radius):
    m = np.zeros((N, N), np.uint8)
    cv2.circle(m, (R, R), int(radius), 255, -1)
    return m


def k(d):
    d = max(1, d)
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (d, d))


def load_art():
    src = cv2.imread("source.jpg")
    # Frame: face/hat centred, shoulders at the bottom edge like the reference.
    h, w = src.shape[:2]
    side = int(min(h, w) * 0.98)
    x0, y0 = (w - side) // 2, (h - side) // 2 + 4
    src = src[y0:y0 + side, x0:x0 + side]
    return cv2.resize(src, (N, N), interpolation=cv2.INTER_CUBIC)


def figure_mask(img):
    """Luffy silhouette (everything that isn't blue sky / white cloud)."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    hch, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    sky = ((hch > 85) & (hch < 130) & (s > 25)) | ((s < 50) & (v > 140))
    fig = (~sky).astype(np.uint8) * 255
    fig = cv2.morphologyEx(fig, cv2.MORPH_OPEN, k(mm(1.5)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(fig)
    big = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    fig = (lab == big).astype(np.uint8) * 255
    # fill enclosed holes (teeth, eye whites read as "cloud")
    # (only pockets not reachable from sky along the bottom edge or the
    # top/left/right sides -- pad so every border-touching sky patch connects)
    ff = cv2.copyMakeBorder(fig, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    cv2.floodFill(ff, None, (0, 0), 255)
    ff = ff[1:-1, 1:-1]
    fig = fig | cv2.bitwise_not(ff)
    return cv2.morphologyEx(fig, cv2.MORPH_CLOSE, k(mm(2)))


# zone ids
SKIN, HAT, HAIR, TEETH, SHIRT, BUTTON = range(6)
ZONE_NAMES = ["skin", "straw hat", "hair", "teeth", "shirt", "buttons"]
# suggested drill colours for the guide (BGR)
ZONE_BGR = [(140, 175, 235), (110, 200, 240), (40, 30, 30), (245, 245, 245), (35, 35, 200), (40, 200, 245)]


def keep_blobs(m, min_mm2):
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    keep = st[:, cv2.CC_STAT_AREA] >= min_mm2 * PX_PER_MM ** 2
    keep[0] = False
    return keep[lab]


def colour_regions(img, fig):
    """Split the figure into flat zones by simple colour rules."""
    f = cv2.GaussianBlur(img, (0, 0), 3).astype(np.float32)
    B, G, Rc = f[..., 0], f[..., 1], f[..., 2]
    hsv = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 3), cv2.COLOR_BGR2HSV)
    hh, ss, vv = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    inf = fig > 0
    smooth = cv2.GaussianBlur(img, (0, 0), 8).astype(np.float32)
    gr = smooth[..., 1] / (smooth[..., 2] + 1)

    z = np.full((N, N), SKIN, np.int32)
    red = ((hh < 8) | (hh > 165)) & (ss > 110) & (vv > 40)
    shirt = cv2.morphologyEx(red.astype(np.uint8) * 255, cv2.MORPH_CLOSE, k(mm(5)))
    shirt[: int(N * 0.55)] = 0  # nothing red above the shoulders except the hat band
    z[(shirt > 0) & inf] = SHIRT
    # shirt rim-light along the outer edge belongs to the shirt
    rim = (cv2.dilate(shirt, k(mm(6))) > 0) & (ss < 90) & (np.arange(N)[:, None] > N * 0.6)
    z[rim & inf] = SHIRT
    hat = ((gr > 0.74) & (Rc > 120)).astype(np.uint8) * 255
    hat = cv2.morphologyEx(hat, cv2.MORPH_OPEN, k(mm(1.5)))
    hat &= fig
    n, lab, st, _ = cv2.connectedComponentsWithStats(hat)
    if n > 1:  # the hat is one piece; yellow halos round the teeth are not
        hat = (lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])).astype(np.uint8) * 255
    z[(hat > 0) & (z != SHIRT)] = HAT
    teeth = (ss < 45) & (vv > 140)
    z[teeth & inf] = TEETH
    hair = (np.maximum(np.maximum(B, G), Rc) < 75) & ~red
    hair_m = cv2.morphologyEx(hair.astype(np.uint8) * 255, cv2.MORPH_OPEN, k(mm(0.8)))
    z[(hair_m > 0) & inf & (np.arange(N)[:, None] < N * 0.62)] = HAIR
    button = (hh > 15) & (hh < 35) & (ss > 170) & (vv > 90)
    z[button & inf & (np.arange(N)[:, None] > N * 0.8)] = BUTTON

    # majority filter, then fold specks into their surroundings
    stack = np.stack([cv2.blur((z == i).astype(np.float32), (mm(1.5),) * 2) for i in range(6)])
    z = np.argmax(stack, 0)
    for i in range(6):
        m = ((z == i) & inf).astype(np.uint8) * 255
        speck = (m > 0) & ~keep_blobs(m, 8.0)
        if speck.any():
            dil = cv2.dilate(np.where(speck, 0, z + 1).astype(np.uint8), k(mm(2.5)))
            z[speck] = np.maximum(dil[speck].astype(np.int32) - 1, 0)
    z[~inf] = -1
    return z, None


def art_lines(img, fig):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(cv2.bilateralFilter(img, 7, 40, 7), cv2.COLOR_BGR2GRAY)
    inside = cv2.erode(fig, k(mm(1.5)))
    regions, _ = colour_regions(img, fig)

    # Face detail (eyes, nose, scar, tooth gaps, collarbones): thin strokes
    # darker than their surroundings, only on skin/teeth -- the straw weave,
    # shirt folds and hair strands would just be noise
    ink = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, k(mm(2.5)))
    ink = ((ink > 38) & (inside > 0)).astype(np.uint8) * 255
    ink[~np.isin(regions, [SKIN, TEETH])] = 0
    ink[cv2.dilate((~np.isin(regions, [SKIN, TEETH])).astype(np.uint8), k(mm(1.5))) > 0] = 0
    lines = ink

    # Zone borders (hat/hair/skin/teeth/shirt/buttons) incl. the silhouette,
    # since the region map is -1 outside the figure
    edges = np.zeros((N, N), np.uint8)
    edges[:, 1:] |= (regions[:, 1:] != regions[:, :-1]).astype(np.uint8)
    edges[1:, :] |= (regions[1:, :] != regions[:-1, :]).astype(np.uint8)
    lines |= edges * 255

    # Normalise every wall to one printable width. Closing first merges the
    # double walls you get where an ink line sits on a zone border.
    lines = cv2.morphologyEx(lines, cv2.MORPH_CLOSE, k(mm(1.4)))
    sk = prune(skeletonize(lines), mm(4))
    walls = cv2.dilate(sk, k(mm(WALL_W) + 2))
    walls = (cv2.GaussianBlur(walls, (0, 0), mm(0.4)) > 127).astype(np.uint8) * 255  # smooth jaggies
    return walls, regions


def skeletonize(m):
    from skimage.morphology import skeletonize as sk
    return (sk(m > 0).astype(np.uint8)) * 255


def prune(sk, min_len):
    """Drop skeleton specks shorter than min_len pixels."""
    n, lab, stats, _ = cv2.connectedComponentsWithStats(sk, connectivity=8)
    keep = stats[:, cv2.CC_STAT_AREA] >= min_len
    keep[0] = False
    return (keep[lab]).astype(np.uint8) * 255


def speed_lines(fig):
    """Horizontal speed lines on the open sky, like the Gear 5 coaster."""
    m = np.zeros((N, N), np.uint8)
    rng = np.random.default_rng(7)
    ys = np.linspace(R - 0.70 * R, R + 0.70 * R, 8)
    for y in ys:
        left = R - np.sqrt(max(R ** 2 - (y - R) ** 2, 0)) + mm(RIM_W)
        length = mm(rng.uniform(12, 22))
        x1 = int(left + mm(rng.uniform(1, 6)))
        cv2.line(m, (x1, int(y)), (x1 + length, int(y)), 255, mm(WALL_W * 1.2))
        # mirror on the right side
        right = R + np.sqrt(max(R ** 2 - (y - R) ** 2, 0)) - mm(RIM_W)
        x2 = int(right - mm(rng.uniform(1, 6)))
        cv2.line(m, (x2 - length, int(y)), (x2, int(y)), 255, mm(WALL_W * 1.2))
    # keep a clear gap between speed lines and the figure
    m[cv2.dilate(fig, k(mm(4))) > 0] = 0
    return m


def fill_tiny_pockets(raised, inner):
    """Pockets too small for a drill become solid raised fill."""
    open_ = cv2.bitwise_and(cv2.bitwise_not(raised), inner)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(open_, connectivity=4)
    # a pocket survives if a MIN_POCKET circle fits somewhere inside it
    fits = cv2.erode(open_, k(mm(MIN_POCKET)))
    ok = np.zeros(n, bool)
    ok[np.unique(lab[fits > 0])] = True
    small = (~ok[lab]) & (open_ > 0)
    raised = raised.copy()
    raised[small] = 255
    return raised


def to_polys(mask, simplify=0.06):
    cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    polys = []
    if hier is None:
        return polys
    hier = hier[0]
    for i, c in enumerate(cs):
        if hier[i][3] != -1 or len(c) < 3:
            continue
        holes = []
        j = hier[i][2]
        while j != -1:
            if len(cs[j]) >= 3:
                holes.append(cs[j][:, 0, :])
            j = hier[j][0]
        p = Polygon(c[:, 0, :], holes).buffer(0)
        if not p.is_empty:
            polys.append(p)
    geom = unary_union(polys)
    # pixel -> mm, image y down -> model y up, centred
    from shapely import affinity
    geom = affinity.affine_transform(geom, [1 / PX_PER_MM, 0, 0, -1 / PX_PER_MM, -R / PX_PER_MM, R / PX_PER_MM])
    # simplify, then grow 0.02 mm so no two holes share a vertex (keeps the extrusion manifold)
    return geom.simplify(simplify).buffer(0.02, join_style=2)


def extrude(geom, z0, h):
    parts = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
    meshes = []
    for p in parts:
        if p.area < 0.05:
            continue
        m = trimesh.creation.extrude_polygon(p, h)
        m.apply_translation([0, 0, z0])
        meshes.append(m)
    return trimesh.util.concatenate(meshes)


def render_3d(raised, outer):
    """Quick shaded top-down render of the printed part."""
    hgt = np.where(raised > 0, BASE_H + WALL_H, BASE_H).astype(np.float32) * PX_PER_MM
    hgt = cv2.GaussianBlur(hgt, (0, 0), 1.2)
    gy, gx = np.gradient(hgt)
    nrm = np.dstack([-gx, -gy, np.ones_like(hgt)])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    light = np.array([-0.5, -0.6, 0.62]); light /= np.linalg.norm(light)
    shade = np.clip(nrm @ light, 0, 1) * 0.75 + 0.25
    shade[raised == 0] *= 0.9
    out = (np.dstack([shade] * 3) * np.array([175, 172, 168])).astype(np.uint8)
    out[outer == 0] = (245, 245, 245)
    cv2.imwrite("preview_3d.png", out)


def main():
    img = load_art()
    fig = figure_mask(img)
    outer = disc(R - 1)
    inner = disc(R - mm(RIM_W))
    fig &= cv2.erode(inner, k(mm(4)))  # figure stays clear of the rim except where it runs off-edge

    walls, regions = art_lines(img, fig)
    raised = walls | speed_lines(fig)
    raised &= inner
    raised |= cv2.subtract(outer, inner)  # rim
    raised = fill_tiny_pockets(raised, inner)

    cv2.imwrite("preview_mask.png", 255 - raised)

    # colour guide: pockets tinted with the suggested drill colour per zone
    pocket = (raised == 0) & (outer > 0)
    guide = np.full((N, N, 3), 255, np.uint8)
    guide[pocket] = (235, 190, 120)  # sky
    for i, col in enumerate(ZONE_BGR):
        guide[pocket & (regions == i)] = col
    guide[raised > 0] = (60, 60, 60)
    guide[outer == 0] = 255
    cv2.imwrite("preview_colour_guide.png", guide)
    render_3d(raised, outer)

    base = Polygon([(np.cos(t) * DIAMETER / 2, np.sin(t) * DIAMETER / 2)
                    for t in np.linspace(0, 2 * np.pi, 256, endpoint=False)])
    base_m = extrude(base, 0, BASE_H)
    lines_m = extrude(to_polys(raised), BASE_H - 0.01, WALL_H + 0.01)
    base_m.export("luffy_coaster_base.stl")
    lines_m.export("luffy_coaster_lines.stl")
    trimesh.util.concatenate([base_m, lines_m]).export("luffy_coaster.stl")
    print("faces:", len(base_m.faces) + len(lines_m.faces),
          "bounds:", trimesh.util.concatenate([base_m, lines_m]).bounds.round(2).tolist())


if __name__ == "__main__":
    main()
