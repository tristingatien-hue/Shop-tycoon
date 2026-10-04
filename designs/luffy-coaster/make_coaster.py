"""Luffy diamond-art coaster generator.

Turns source.jpg into a 3D-printable coaster in the same style as the
Gear 5 One Piece coaster: flat disc, raised rim, raised outline art.
Only outlines are raised, so the recessed pockets between them can be
filled with diamond-art drills for colour. The clouds in the sky are
kept as their own pockets.

Approach: the anime frame already contains clean ink lines, so the art is
traced straight from the image with an XDoG line filter (no colour
segmentation), then every stroke is redrawn at one printable wall width.
Clouds are soft-shaded, so they get their own smoothed outline.

Outputs (in this folder):
  luffy_coaster.stl         single print, one colour
  luffy_coaster_base.stl    base disc only   } same coordinates, load both
  luffy_coaster_lines.stl   raised walls only} for a two-colour swap
  preview_mask.png          top-down view (black = raised)
  preview_3d.png            shaded render of the print
  preview_colour_guide.png  pockets tinted with suggested drill colours

Run:  python3 make_coaster.py
Needs: pip install numpy opencv-python-headless scikit-image trimesh shapely mapbox_earcut
"""
import cv2
import numpy as np
import trimesh
from shapely import affinity
from shapely.geometry import Polygon
from shapely.ops import unary_union
from skimage.morphology import skeletonize

# ---- physical design (mm) ----
DIAMETER = 100.0     # matches the One Piece coaster
BASE_H = 3.0         # solid floor under the drills
WALL_H = 2.0         # raised art height above the floor (drills ~1.3-1.7 mm + glue)
RIM_W = 3.0          # outer rim width
WALL_W = 1.0         # outline wall width (2.5 nozzle widths at 0.4 mm)
MIN_POCKET = 3.0     # pockets that can't fit a drill this wide are filled solid
MIN_CLOUD = 40.0     # clouds smaller than this (mm^2) are dropped
PX_PER_MM = 10       # working raster resolution

N = int(DIAMETER * PX_PER_MM)
R = N // 2


def mm(v):
    return max(1, int(round(v * PX_PER_MM)))


def k(d):
    d = max(1, int(d))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (d, d))


def disc(radius):
    m = np.zeros((N, N), np.uint8)
    cv2.circle(m, (R, R), int(radius), 255, -1)
    return m


def drop_small(m, min_px):
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    keep = st[:, cv2.CC_STAT_AREA] >= min_px
    keep[0] = False
    return keep[lab].astype(np.uint8) * 255


def load_art():
    src = cv2.imread("source.jpg")
    return cv2.resize(src, (N, N), interpolation=cv2.INTER_CUBIC)


def sky_masks(img):
    """Return (figure, cloud) masks. Sky = blue or near-white low saturation."""
    hsv = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 2), cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    sky = ((h > 85) & (h < 130) & (s > 25)) | ((s < 50) & (v > 140))
    fig = (~sky).astype(np.uint8) * 255
    fig = cv2.morphologyEx(fig, cv2.MORPH_OPEN, k(mm(1.5)))
    n, lab, st, _ = cv2.connectedComponentsWithStats(fig)
    fig = (lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])).astype(np.uint8) * 255
    # fill enclosed holes (teeth read as "cloud")
    ff = cv2.copyMakeBorder(fig, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    cv2.floodFill(ff, None, (0, 0), 255)
    fig = fig | cv2.bitwise_not(ff[1:-1, 1:-1])
    fig = cv2.morphologyEx(fig, cv2.MORPH_CLOSE, k(mm(2)))

    # Clouds: the bright, low-saturation parts of the sky, smoothed into
    # soft rounded shapes and kept clear of the figure
    cl = cv2.GaussianBlur(img, (0, 0), mm(0.8))
    hsv = cv2.cvtColor(cl, cv2.COLOR_BGR2HSV)
    cloud = ((hsv[..., 1] < 30) & (hsv[..., 2] > 180)).astype(np.uint8) * 255
    cloud = cv2.morphologyEx(cloud, cv2.MORPH_OPEN, k(mm(2.5)))
    cloud = cv2.morphologyEx(cloud, cv2.MORPH_CLOSE, k(mm(3)))
    cloud = (cv2.GaussianBlur(cloud, (0, 0), mm(1.0)) > 127).astype(np.uint8) * 255
    cloud[fig > 0] = 0
    cloud = cv2.morphologyEx(cloud, cv2.MORPH_OPEN, k(mm(3)))
    cloud = drop_small(cloud, MIN_CLOUD * PX_PER_MM ** 2)
    return fig, cloud


def xdog_lines(img, sigma=2.5, k_ratio=1.6, tau=0.98, eps=-0.01, phi=200, boost=False):
    """Extended difference-of-Gaussians: clean ink-style line art."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if boost:  # local contrast boost so lines in dark areas register
        g = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(g)
    g = g.astype(np.float32) / 255
    d = cv2.GaussianBlur(g, (0, 0), sigma) - tau * cv2.GaussianBlur(g, (0, 0), sigma * k_ratio)
    x = np.where(d > eps, 1.0, 1.0 + np.tanh(phi * (d - eps)))
    return (x < 0.5).astype(np.uint8) * 255


def art_walls(img, fig, cloud):
    ink = xdog_lines(img)
    # the dark red hoodie hides its folds and drawstrings from the plain
    # filter; trace it again with a contrast boost, but only on the hoodie
    hsv = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 3), cv2.COLOR_BGR2HSV)
    red = (((hsv[..., 0] < 8) | (hsv[..., 0] > 165)) & (hsv[..., 1] > 110)).astype(np.uint8) * 255
    red = cv2.morphologyEx(red, cv2.MORPH_CLOSE, k(mm(5)))
    red[: int(N * 0.6)] = 0
    ink |= xdog_lines(img, boost=True) & cv2.erode(red, k(mm(1)))
    ink[cv2.dilate(fig, k(mm(1.0))) == 0] = 0      # sky texture isn't art
    ink |= cv2.morphologyEx(fig, cv2.MORPH_GRADIENT, k(3))   # silhouette
    # cloud outlines, except where a cloud meets the figure (the silhouette
    # already draws that edge; a second line beside it would leave a sliver)
    cl_edge = cv2.morphologyEx(cloud, cv2.MORPH_GRADIENT, k(3))
    cl_edge[cv2.dilate(fig, k(mm(1.5))) > 0] = 0
    ink |= drop_small(cl_edge, mm(3))
    ink = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, k(mm(0.5)))
    ink = drop_small(ink, mm(1.5) ** 2)

    # Redraw every stroke at one printable width: centre line -> wall
    sk = skeletonize(ink > 0).astype(np.uint8) * 255
    sk = drop_small(sk, mm(2.0))                    # specks/short hatching
    walls = cv2.dilate(sk, k(mm(WALL_W)))
    walls = (cv2.GaussianBlur(walls, (0, 0), mm(0.25)) > 110).astype(np.uint8) * 255
    return walls


def fill_tiny_pockets(raised, inner):
    """Pockets that can't fit a drill anywhere become solid raised fill
    (like the solid areas on the Gear 5 coaster)."""
    open_ = cv2.bitwise_and(cv2.bitwise_not(raised), inner)
    n, lab, _, _ = cv2.connectedComponentsWithStats(open_, connectivity=4)
    fits = cv2.erode(open_, k(mm(MIN_POCKET)))
    ok = np.zeros(n, bool)
    ok[np.unique(lab[fits > 0])] = True
    out = raised.copy()
    out[(~ok[lab]) & (open_ > 0)] = 255
    return out


def to_polys(mask, simplify=0.05):
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
    geom = affinity.affine_transform(geom, [1 / PX_PER_MM, 0, 0, -1 / PX_PER_MM, -R / PX_PER_MM, R / PX_PER_MM])
    # grow 0.02 mm so no two holes share a vertex (keeps the extrusion manifold)
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
    light = np.array([-0.5, -0.6, 0.62])
    light /= np.linalg.norm(light)
    shade = np.clip(nrm @ light, 0, 1) * 0.75 + 0.25
    shade[raised == 0] *= 0.9
    out = (np.dstack([shade] * 3) * np.array([175, 172, 168])).astype(np.uint8)
    out[outer == 0] = (245, 245, 245)
    cv2.imwrite("preview_3d.png", out)


def colour_guide(img, raised, outer):
    """Each pocket tinted with the image's own average colour there."""
    pocket = ((raised == 0) & (outer > 0)).astype(np.uint8)
    n, lab = cv2.connectedComponents(pocket, connectivity=4)
    flat = cv2.pyrMeanShiftFiltering(img, 8, 30)
    guide = np.full((N, N, 3), 255, np.uint8)
    for i in range(1, n):
        m = lab == i
        guide[m] = np.median(flat[m], axis=0)
    guide[raised > 0] = (60, 60, 60)
    guide[outer == 0] = 255
    cv2.imwrite("preview_colour_guide.png", guide)


def main():
    img = load_art()
    fig, cloud = sky_masks(img)
    outer = disc(R - 1)
    inner = disc(R - mm(RIM_W))

    raised = art_walls(img, fig, cloud) & inner
    raised |= cv2.subtract(outer, inner)  # rim
    raised = fill_tiny_pockets(raised, inner)

    cv2.imwrite("preview_mask.png", 255 - raised)
    render_3d(raised, outer)
    colour_guide(img, raised, outer)

    base = Polygon([(np.cos(t) * DIAMETER / 2, np.sin(t) * DIAMETER / 2)
                    for t in np.linspace(0, 2 * np.pi, 256, endpoint=False)])
    base_m = extrude(base, 0, BASE_H)
    lines_m = extrude(to_polys(raised), BASE_H - 0.01, WALL_H + 0.01)
    base_m.export("luffy_coaster_base.stl")
    lines_m.export("luffy_coaster_lines.stl")
    both = trimesh.util.concatenate([base_m, lines_m])
    both.export("luffy_coaster.stl")
    print("faces:", len(both.faces), "bounds:", both.bounds.round(2).tolist())


if __name__ == "__main__":
    main()
