# Luffy diamond-art coaster

Straw-hat Luffy coaster in the same style as the Gear 5 One Piece coaster
(100 mm disc, raised rim, raised outline art), with the clouds from the
original image kept as their own pockets. The art is outlines only, so the
recessed pockets can take diamond-art drills.

The outlines are traced straight from the image's own ink lines (XDoG line
filter), then redrawn at one printable wall width.

| | |
|---|---|
| Diameter | 100 mm |
| Base (floor) | 3.0 mm |
| Raised outlines/rim | +2.0 mm (5.0 mm total) |
| Outline wall width | ~1.0–1.2 mm |
| Rim width | 3.0 mm |
| Smallest pocket | 3.5 mm (anything a 3.0 mm drill can't fit is filled solid) |

Pocket depth (2 mm) fits standard 2.5–2.8 mm round or square drills on a
thin layer of glue or double-sided tape, with the walls sitting flush.

## Files

- `luffy_coaster.stl`: single-colour print
- `luffy_coaster_base.stl` + `luffy_coaster_lines.stl`: same coordinates,
  so you can load both as one object and give the outlines a different
  filament (or pause at 3.0 mm for a colour swap)
- `preview_3d.png`: what the print looks like
- `preview_colour_guide.png`: suggested drill colour for each pocket,
  taken from the image itself
- `preview_mask.png`: top-down outline mask (black = raised)

## Regenerating

```
pip install numpy scikit-image opencv-python-headless trimesh shapely mapbox_earcut
python3 make_coaster.py
```

Settings like `WALL_H`, `WALL_W`, `MIN_POCKET` and `MIN_CLOUD` are at the top of
`make_coaster.py`.

Print flat, with no supports needed. 0.2 mm layers work.
