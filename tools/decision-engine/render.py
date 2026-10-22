"""Offline preview: painter's-algorithm render of dumped GLB triangles, two views.
Usage: python3 -I render.py <dumpDir> <out.png> <title>
"""
import json, sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

d, out, title = sys.argv[1], sys.argv[2], sys.argv[3]
prims = json.load(open(os.path.join(d, "prims.json")))
TRI, COL = [], []
for p in prims:
    P = np.fromfile(os.path.join(d, p["base"] + ".pos.bin"), dtype=np.float32).reshape(-1, 3)
    I = np.fromfile(os.path.join(d, p["base"] + ".idx.bin"), dtype=np.uint32).reshape(-1, 3)
    tri = P[I]  # (n,3,3)
    if p["texFile"] and p["hasUv"]:
        UV = np.fromfile(os.path.join(d, p["base"] + ".uv.bin"), dtype=np.float32).reshape(-1, 2)
        img = np.asarray(Image.open(os.path.join(d, p["texFile"])).convert("RGB"), dtype=np.float32) / 255
        c = UV[I].mean(axis=1) % 1.0
        h, w = img.shape[:2]
        col = img[(c[:, 1] * (h - 1)).astype(int), (c[:, 0] * (w - 1)).astype(int)]
    else:
        col = np.tile(np.array(p["color"][:3], dtype=np.float32), (len(tri), 1))
    TRI.append(tri); COL.append(col)
TRI = np.concatenate(TRI); COL = np.concatenate(COL)

lo, hi = TRI.reshape(-1, 3).min(0), TRI.reshape(-1, 3).max(0)
centre, size = (lo + hi) / 2, (hi - lo).max()
S = 560
panels = []
for yaw in (0.0, np.pi * 0.75):
    cy, sy = np.cos(yaw), np.sin(yaw)
    R = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], dtype=np.float32)
    T = (TRI - centre) @ R.T
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    light = np.clip(np.abs(n @ np.array([0.35, 0.55, 0.75])), 0.15, 1.0)
    rgb = np.clip(COL * (0.35 + 0.75 * light[:, None]), 0, 1)
    order = np.argsort(T[:, :, 2].mean(1))  # far (−z) first
    xy = T[:, :, :2] / size * (S * 0.9) * np.array([1, -1]) + S / 2
    im = Image.new("RGB", (S, S), (236, 232, 224))
    dr = ImageDraw.Draw(im)
    for k in order:
        c = tuple((rgb[k] * 255).astype(int))
        dr.polygon([tuple(v) for v in xy[k]], fill=c)
    panels.append(im)
canvas = Image.new("RGB", (S * 2, S + 44), (255, 255, 255))
for i, p in enumerate(panels):
    canvas.paste(p, (i * S, 44))
ImageDraw.Draw(canvas).text((12, 12), f"{title} · {len(TRI):,} triangles", fill=(20, 20, 20),
                            font=ImageFont.load_default(size=22))
canvas.save(out)
print(out, len(TRI))
