# Luffy diamond-art coaster

Straw-hat Luffy coaster in the same style as the Gear 5 One Piece coaster
(100 mm disc, raised rim, raised art, speed lines). The art is outlines only,
so the recessed pockets can take diamond-art drills.

| | |
|---|---|
| Diameter | 100 mm |
| Base (floor) | 3.0 mm |
| Raised outlines/rim | +2.0 mm (5.0 mm total) |
| Outline wall width | ~1.0 mm (0.8 mm min) |
| Rim width | 3.0 mm |
| Smallest pocket | 3.5 mm (anything under 3.0 mm is filled solid) |

Pocket depth (2 mm) fits standard 2.5–2.8 mm round or square drills on a
thin layer of glue or double-sided tape, with the walls sitting flush.

## Files

- `luffy_coaster.stl`: single-colour print
- `luffy_coaster_base.stl` + `luffy_coaster_lines.stl`: same coordinates,
  so you can load both as one object and give the outlines a different
  filament (or pause at 3.0 mm for a colour swap)
- `preview_3d.png`: what the print looks like
- `preview_colour_guide.png`: suggested drill colour for each pocket
  (sky blue, straw yellow, skin, black hair, white teeth, red shirt,
  yellow button)
- `preview_mask.png`: top-down outline mask (black = raised)

## Regenerating

```
pip install pillow numpy scikit-image opencv-python-headless trimesh shapely mapbox_earcut
python3 make_coaster.py
```

Settings like `WALL_H`, `WALL_W` and `MIN_POCKET` are at the top of
`make_coaster.py`.

Print flat, with no supports needed. 0.2 mm layers work.
