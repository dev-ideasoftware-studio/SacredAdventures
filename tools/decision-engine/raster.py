"""Per-pixel textured z-buffer rasterizer for dumped GLB triangles (fair preview of low-poly variants).
Usage: python3 -I raster.py <dumpDir> <out.png> <title>
Same camera, framing and lighting as render.py so images line up.
"""
import json, sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

d, out, title = sys.argv[1], sys.argv[2], sys.argv[3]
prims = json.load(open(os.path.join(d, "prims.json")))
data = []
allP = []
for p in prims:
    P = np.fromfile(os.path.join(d, p["base"] + ".pos.bin"), dtype=np.float32).reshape(-1, 3)
    I = np.fromfile(os.path.join(d, p["base"] + ".idx.bin"), dtype=np.uint32).reshape(-1, 3)
    UV = np.fromfile(os.path.join(d, p["base"] + ".uv.bin"), dtype=np.float32).reshape(-1, 2) if p["hasUv"] else None
    tex = (np.asarray(Image.open(os.path.join(d, p["texFile"])).convert("RGB"), dtype=np.float32) / 255
           if p["texFile"] else None)
    data.append((P[I], UV[I] if UV is not None else None, tex, np.array(p["color"][:3], np.float32)))
    allP.append(P[I].reshape(-1, 3))
allP = np.concatenate(allP)
lo, hi = allP.min(0), allP.max(0)
centre, size = (lo + hi) / 2, (hi - lo).max()
S = 560
panels = []
for yaw in (0.0, np.pi * 0.75):
    cy, sy = np.cos(yaw), np.sin(yaw)
    R = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], dtype=np.float32)
    zbuf = np.full((S, S), -np.inf, np.float32)
    img = np.empty((S, S, 3), np.float32); img[:] = np.array([236, 232, 224]) / 255
    for tri, uv, tex, base in data:
        T = (tri - centre) @ R.T
        n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
        shade = 0.35 + 0.75 * np.clip(np.abs(n @ np.array([0.35, 0.55, 0.75])), 0.15, 1.0)
        X = T[:, :, 0] / size * (S * 0.9) + S / 2
        Y = -T[:, :, 1] / size * (S * 0.9) + S / 2
        Z = T[:, :, 2]
        for k in range(len(T)):
            x0, x1 = int(max(0, np.floor(X[k].min()))), int(min(S - 1, np.ceil(X[k].max())))
            y0, y1 = int(max(0, np.floor(Y[k].min()))), int(min(S - 1, np.ceil(Y[k].max())))
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            (ax, bx, cx), (ay, by, cy_) = X[k], Y[k]
            den = (by - cy_) * (ax - cx) + (cx - bx) * (ay - cy_)
            if abs(den) < 1e-9:
                continue
            w0 = ((by - cy_) * (xs - cx) + (cx - bx) * (ys - cy_)) / den
            w1 = ((cy_ - ay) * (xs - cx) + (ax - cx) * (ys - cy_)) / den
            w2 = 1 - w0 - w1
            m = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            if not m.any():
                continue
            z = w0 * Z[k, 0] + w1 * Z[k, 1] + w2 * Z[k, 2]
            yy, xx = (ys[m] - 0.5).astype(int), (xs[m] - 0.5).astype(int)
            zm = z[m]
            vis = zm > zbuf[yy, xx]
            if not vis.any():
                continue
            yy, xx, zm = yy[vis], xx[vis], zm[vis]
            if tex is not None and uv is not None:
                u = (w0[m][vis] * uv[k, 0, 0] + w1[m][vis] * uv[k, 1, 0] + w2[m][vis] * uv[k, 2, 0]) % 1.0
                v = (w0[m][vis] * uv[k, 0, 1] + w1[m][vis] * uv[k, 1, 1] + w2[m][vis] * uv[k, 2, 1]) % 1.0
                th, tw = tex.shape[:2]
                c = tex[(v * (th - 1)).astype(int), (u * (tw - 1)).astype(int)]
            else:
                c = np.tile(base, (len(yy), 1))
            zbuf[yy, xx] = zm
            img[yy, xx] = np.clip(c * shade[k], 0, 1)
    panels.append(Image.fromarray((img * 255).astype(np.uint8)))
ntri = sum(len(t) for t, *_ in data)
canvas = Image.new("RGB", (S * 2, S + 44), (255, 255, 255))
for i, p in enumerate(panels):
    canvas.paste(p, (i * S, 44))
ImageDraw.Draw(canvas).text((12, 12), f"{title} · {ntri:,} triangles · per-pixel texture", fill=(20, 20, 20),
                            font=ImageFont.load_default(size=22))
canvas.save(out)
print(out, ntri)
