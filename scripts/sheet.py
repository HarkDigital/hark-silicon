#!/usr/bin/env python3
"""Per-chapter contact sheets from a shot.mjs sweep.

  python3 scripts/sheet.py <shots-dir> [hero work services voices shield process contact]

Expects frames named <chapter>-<local>.png (desktop) and m-<chapter>-<local>.png
(--mobile) at locals 0.03 0.15 0.30 0.45 0.60 0.75 0.90 0.97, e.g. from:

  F=""; for c in hero work services voices shield process contact; do
    for l in 0.03 0.15 0.3 0.45 0.6 0.75 0.9 0.97; do F="$F,$c:$l"; done; done
  node scripts/shot.mjs --port=<no-HMR port> --out=<dir> --wait=2200 --frames=${F#,}
  node scripts/shot.mjs --port=<no-HMR port> --out=<dir> --wait=2200 --frames=${F#,} --mobile

Writes <dir>/S-<chapter>.png: desktop frames in a 4x2 grid, mobile row below.
"""
import os, sys
from PIL import Image, ImageDraw

d = sys.argv[1] if len(sys.argv) > 1 else 'shots'
chapters = sys.argv[2:] or ['hero', 'work', 'services', 'voices', 'shield', 'process', 'contact']
L = ['0.03', '0.15', '0.30', '0.45', '0.60', '0.75', '0.90', '0.97']
for c in chapters:
    sheet = Image.new('RGB', (1440, 450 + 390), 'white')
    for i, l in enumerate(L):
        for pre, size, pos in [('', (360, 225), ((i % 4) * 360, (i // 4) * 225)), ('m-', (180, 390), (i * 180, 450))]:
            f = os.path.join(d, f'{pre}{c}-{l}.png')
            if not os.path.exists(f):
                continue
            im = Image.open(f).convert('RGB').resize(size)
            dr = ImageDraw.Draw(im)
            dr.rectangle((0, size[1] - 16, 40, size[1]), fill='black')
            dr.text((3, size[1] - 14), l, fill=(255, 255, 0))
            sheet.paste(im, pos)
    out = os.path.join(d, f'S-{c}.png')
    sheet.save(out)
    print(out)
