#!/usr/bin/env python3
"""
Build detailed terrain tiles for a place from laser-survey elevation data.

    python tools/places/build_place.py niagara --probe     # what would be used; downloads nothing
    python tools/places/build_place.py niagara             # build the tiles

Works from any folder. Needs Python 3.9 or newer and:

    pip install rasterio numpy pillow

What it does, for the place defined in places/<id>/spec.json:
  1. Finds the laser-survey elevation data covering the corridor:
     Canada: Natural Resources Canada, HRDEM, 1-2 m (Open Government Licence - Canada)
     US:     US Geological Survey, 3DEP 1 m (public domain)
  2. Reads only the parts it needs (the files are read a piece at a time).
  3. Joins them on one grid, newest survey first where they overlap.
  4. For each tile the place covers, at each zoom: starts from the usual tile
     the app streams, and lays the survey data over it inside the corridor,
     blending over the last feather_m metres so there is no step at the edge.
  5. Writes places/<id>/tiles/{z}/{x}/{y}.png (the same Terrarium format the
     app reads), places/<id>/place.json (the tile list), and
     places/<id>/preview.png (a shaded picture of the survey data, to check).

Heights: Canada uses CGVD2013, the US NAVD88; near Niagara they differ by well
under a metre, which this ignores.
"""

import argparse
import io
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

try:
    import numpy as np
    from PIL import Image
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    from rasterio.warp import reproject
except ImportError as e:
    sys.exit(f"Missing a package ({e.name}). Install with:\n    pip install rasterio numpy pillow")

EARTH = 40075016.686
HALF = EARTH / 2
PX = 256
FINEST = 16                      # the finest zoom this builds the joined grid at
TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
STAC = "https://datacube.services.geo.ca/stac/api/search"
TNM = "https://tnmaccess.nationalmap.gov/api/v1/products"
GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.tiff,.vrt",
                GDAL_HTTP_MULTIRANGE="YES", GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES", VSI_CACHE="TRUE",
                GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2")


# ---- coordinates ------------------------------------------------------------------
def merc(lat, lon):
    x = lon / 360 * EARTH
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) / (2 * math.pi) * EARTH
    return x, y


def lonlat(x, y):
    return x / EARTH * 360, math.degrees(2 * math.atan(math.exp(y / EARTH * 2 * math.pi)) - math.pi / 2)


def tile_bounds(z, x, y):
    s = EARTH / 2 ** z
    return (-HALF + x * s, HALF - (y + 1) * s, -HALF + (x + 1) * s, HALF - y * s)   # west, south, east, north


def tiles_over(z, w, s, e, n):
    k = 2 ** z / EARTH
    x0, x1 = int((w + HALF) * k), int((e + HALF) * k)
    y0, y1 = int((HALF - n) * k), int((HALF - s) * k)
    return [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]


# ---- the corridor -------------------------------------------------------------------
class Corridor:
    """The line of [lat, lon, metres] points, as mercator segments with a reach."""

    def __init__(self, path, feather):
        self.pts = [(*merc(la, lo), r) for la, lo, r in path]
        self.feather = feather
        self.k = math.cos(math.radians(sum(p[0] for p in path) / len(path)))   # true metres per mercator metre

    def bounds(self, margin=0):
        m = margin / self.k
        return (min(p[0] - p[2] / self.k for p in self.pts) - m, min(p[1] - p[2] / self.k for p in self.pts) - m,
                max(p[0] + p[2] / self.k for p in self.pts) + m, max(p[1] + p[2] / self.k for p in self.pts) + m)

    def weight_grid(self, xs, ys, rows=256):
        """weight() over a grid of column positions xs and row positions ys, a strip
        of rows at a time to keep memory small."""
        out = np.empty((len(ys), len(xs)), dtype=np.float32)
        for r in range(0, len(ys), rows):
            X, Y = np.meshgrid(xs, ys[r:r + rows])
            out[r:r + rows] = self.weight(X, Y)
        return out

    def weight(self, X, Y):
        """1 well inside, falling to 0 over the last feather metres, 0 outside."""
        best = np.full(X.shape, -np.inf, dtype=np.float32)
        for (ax, ay, ar), (bx, by, br) in zip(self.pts, self.pts[1:]):
            dx, dy = bx - ax, by - ay
            L = dx * dx + dy * dy or 1.0
            t = np.clip(((X - ax) * dx + (Y - ay) * dy) / L, 0, 1)
            d = np.hypot(X - (ax + t * dx), Y - (ay + t * dy)) * self.k     # true metres to the line
            reach = ar + (br - ar) * t
            np.maximum(best, (reach - d) / self.feather, out=best)
        return np.clip(best, 0, 1)

    def touches(self, z, x, y):
        w, s, e, n = tile_bounds(z, x, y)
        X, Y = np.meshgrid(np.linspace(w, e, 9), np.linspace(n, s, 9))
        return bool((self.weight(X, Y) > 0).any())


# ---- finding the survey data --------------------------------------------------------
def get_json(url, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "TerrainWalker place builder",
                                                         **({"Content-Type": "application/json"} if data else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def find_canada(bbox):
    """HRDEM by laser-survey project (finest), newest first."""
    q = {"collections": ["hrdem-lidar"], "bbox": list(bbox), "limit": 50}
    try:
        res = get_json(STAC, json.dumps(q).encode())
    except Exception as e:
        print(f"  Canada (HRDEM): search failed: {e}")
        return []
    out = []
    for f in res.get("features", []):
        dtm = (f.get("assets") or {}).get("dtm")
        if dtm:
            out.append({"name": "Canada HRDEM " + f["id"], "url": dtm["href"],
                        "date": (f.get("properties") or {}).get("datetime") or ""})
    return sorted(out, key=lambda s: s["date"], reverse=True)


def find_us(bbox):
    """3DEP 1 m, newest first."""
    q = urllib.parse.urlencode({"datasets": "Digital Elevation Model (DEM) 1 meter",
                                "bbox": ",".join(f"{v:.5f}" for v in bbox), "outputFormat": "JSON", "max": 100})
    try:
        res = get_json(TNM + "?" + q)
    except Exception as e:
        print(f"  US (3DEP): search failed: {e}")
        return []
    # Keep every survey: a newer one may cover only part of a square, and the
    # older one fills the rest (newest is laid down first).
    out = []
    for it in res.get("items", []):
        title, url = it.get("title", ""), it.get("downloadURL", "")
        if url.lower().endswith((".tif", ".tiff")):
            out.append({"name": "US 3DEP " + title, "url": url, "date": it.get("publicationDate") or "",
                        "mb": round((it.get("sizeInBytes") or 0) / 1e6, 1)})
    return sorted(out, key=lambda s: s["date"], reverse=True)


# ---- reading ------------------------------------------------------------------------------
def read_source(src, grid):
    """The source resampled onto the joined grid (mercator, FINEST zoom pixels). NaN where it has no data.
    Only the parts of the file under the grid are read."""
    w, s, e, n, W, H = grid
    url = src["url"] if os.path.exists(src["url"]) else "/vsicurl/" + src["url"]
    out = np.full((H, W), np.nan, dtype=np.float32)
    with rasterio.Env(**GDAL_ENV), rasterio.open(url) as ds:
        reproject(source=rasterio.band(ds, 1), destination=out,
                  src_nodata=ds.nodata, dst_transform=from_origin(w, n, (e - w) / W, (n - s) / H),
                  dst_crs="EPSG:3857", dst_nodata=np.nan, resampling=Resampling.bilinear, num_threads=2)
    out[(out < -500) | (out > 9000)] = np.nan          # nodata written as a number
    return out


def terrarium_tile(z, x, y, cache):
    """The usual tile, as heights. Above zoom 15 (the service's deepest), enlarged from zoom 15."""
    if z > 15:
        d = z - 15
        px, py = x >> d, y >> d
        parent = terrarium_tile(15, px, py, cache)
        n = PX >> d
        part = parent[(y - (py << d)) * n:(y - (py << d) + 1) * n, (x - (px << d)) * n:(x - (px << d) + 1) * n]
        return np.asarray(Image.fromarray(part).resize((PX, PX), Image.BILINEAR), dtype=np.float32)
    path = os.path.join(cache, str(z), str(x), f"{y}.png")
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        url = TERRARIUM.format(z=z, x=x, y=y)
        for attempt in range(4):
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    open(path, "wb").write(r.read())
                break
            except Exception as e:
                if attempt == 3:
                    raise RuntimeError(f"could not fetch {url}: {e}")
                time.sleep(2)
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def encode(h):
    v = np.clip(h + 32768, 0, 65535.99)
    r = np.floor(v / 256)
    g = np.floor(v - r * 256)
    b = np.floor((v - np.floor(v)) * 256)
    return Image.fromarray(np.stack([r, g, b], -1).astype(np.uint8), "RGB")


def block_mean(a, f):
    """Average f x f blocks, ignoring NaN; NaN where a block is mostly empty."""
    H, W = a.shape[0] // f * f, a.shape[1] // f * f
    b = a[:H, :W].reshape(H // f, f, W // f, f)
    valid = np.isfinite(b).sum(axis=(1, 3))
    with np.errstate(invalid="ignore"):
        m = np.nansum(b, axis=(1, 3)) / np.maximum(valid, 1)
    m[valid < f * f / 2] = np.nan
    return m


def shaded(h, k, px_m):
    gy, gx = np.gradient(np.nan_to_num(h, nan=float(np.nanmean(h))), px_m)
    n = np.dstack([-gx, gy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    lit = np.clip(n @ np.array([-0.5, 0.5, 0.707]), 0, 1)
    img = (40 + 200 * lit).astype(np.uint8)
    img[~np.isfinite(h)] = 0
    return Image.fromarray(img)


# ---- main -------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Build detailed terrain tiles for a place.")
    ap.add_argument("place", help="folder name under places/, e.g. niagara")
    ap.add_argument("--probe", action="store_true", help="only report what would be used; download nothing")
    ap.add_argument("--root", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."),
                    help="the project's tw folder (default: found from where this script is)")
    ap.add_argument("--source", action="append", default=[],
                    help="use this elevation file instead of searching (repeatable; for testing)")
    ap.add_argument("--cache", default=None, help="where to keep downloaded usual tiles (default: places/<id>/.cache)")
    a = ap.parse_args()

    folder = os.path.join(a.root, "places", a.place)
    spec = json.load(open(os.path.join(folder, "spec.json")))
    cor = Corridor(spec["path"], spec.get("feather_m", 150))
    zooms = sorted(spec.get("zooms", [12, 13, 14, 15, 16]))
    w, s, e, n = cor.bounds(margin=200)
    lon0, lat0 = lonlat(w, s)
    lon1, lat1 = lonlat(e, n)
    bbox = (lon0, lat0, lon1, lat1)
    print(f"{spec.get('name', a.place)}")
    print(f"  area: {lat0:.4f},{lon0:.4f} to {lat1:.4f},{lon1:.4f}")

    plan = {z: [(x, y) for x, y in tiles_over(z, w, s, e, n) if cor.touches(z, x, y)] for z in zooms}
    for z in zooms:
        print(f"  zoom {z}: {len(plan[z])} tiles")

    if a.source:
        sources = [{"name": os.path.basename(p), "url": os.path.abspath(p), "date": ""} for p in a.source]
    else:
        print("Looking for survey data...")
        sources = find_canada(bbox) + find_us(bbox)
    if not sources:
        sys.exit("No survey data found for this area.")
    for src in sources:
        print(f"  {src['name']}" + (f"  ({src['mb']} MB file, only parts are read)" if src.get("mb") else ""))
    if a.probe:
        print("Probe only: nothing downloaded. Run again without --probe to build.")
        return

    # The joined grid: FINEST-zoom pixels over the corridor's bounds.
    res = EARTH / (2 ** FINEST * PX)
    # Corners snapped to the coarsest zoom's pixels, so averaging blocks of this
    # grid gives exactly each coarser zoom's pixels.
    snap = 2 ** (FINEST - zooms[0])
    gx0, gx1 = math.floor((w + HALF) / res / snap) * snap, math.ceil((e + HALF) / res / snap) * snap
    gy0, gy1 = math.floor((HALF - n) / res / snap) * snap, math.ceil((HALF - s) / res / snap) * snap
    gw, gn = -HALF + gx0 * res, HALF - gy0 * res
    W, H = gx1 - gx0, gy1 - gy0
    grid = (gw, gn - H * res, gw + W * res, gn, W, H)
    print(f"Reading survey data onto a {W} x {H} grid ({res * cor.k:.2f} m)...")
    joined = np.full((H, W), np.nan, dtype=np.float32)
    for src in sources:
        t0 = time.time()
        try:
            part = read_source(src, grid)
        except Exception as ex:
            print(f"  {src['name']}: could not read ({ex}); skipped")
            continue
        fill = np.isnan(joined) & np.isfinite(part)
        joined[fill] = part[fill]
        print(f"  {src['name']}: {fill.mean() * 100:.1f}% of the area, {time.time() - t0:.0f} s")
    covered = np.isfinite(joined)
    X = gw + (np.arange(W) + 0.5) * res
    Y = gn - (np.arange(H) + 0.5) * res
    weight = cor.weight_grid(X, Y)
    inside = weight > 0
    gap = 100 * (inside & ~covered).sum() / max(1, inside.sum())
    print(f"  survey data covers {100 - gap:.1f}% of the corridor" + (" (gaps keep the usual data)" if gap > 0.1 else ""))
    if gap > 99:
        sys.exit("No survey data could be read for the corridor, so no tiles were written.")

    # The preview from a quarter-size copy: shading the full grid takes a lot of memory.
    small = block_mean(np.where(inside, joined, np.nan), 4)
    preview = shaded(small, cor.k, 4 * res * cor.k)
    del small
    preview.thumbnail((2000, 2000))
    preview.save(os.path.join(folder, "preview.png"))

    cache = a.cache or os.path.join(folder, ".cache")
    out_dir = os.path.join(folder, "tiles")
    listing = {}
    for z in zooms:
        f = 2 ** (FINEST - z)
        lid = block_mean(joined, f) if f > 1 else joined
        wgt = block_mean(weight, f) if f > 1 else weight
        wgt = np.nan_to_num(wgt)
        listing[str(z)] = []
        for (x, y) in plan[z]:
            base = terrarium_tile(z, x, y, cache)
            # This tile's pixels in the (block-averaged) joined grid.
            ox, oy = x * PX - gx0 // f, y * PX - gy0 // f      # this tile's corner in the averaged grid
            h = base.copy()
            ys, xs = slice(max(0, -oy), min(PX, lid.shape[0] - oy)), slice(max(0, -ox), min(PX, lid.shape[1] - ox))
            if ys.start < ys.stop and xs.start < xs.stop:
                L = lid[ys.start + oy:ys.stop + oy, xs.start + ox:xs.stop + ox]
                G = wgt[ys.start + oy:ys.stop + oy, xs.start + ox:xs.stop + ox]
                ok = np.isfinite(L)
                part = h[ys, xs]
                part[ok] = G[ok] * L[ok] + (1 - G[ok]) * part[ok]
                h[ys, xs] = part
            p = os.path.join(out_dir, str(z), str(x), f"{y}.png")
            os.makedirs(os.path.dirname(p), exist_ok=True)
            encode(h).save(p, optimize=True)
            listing[str(z)].append(f"{x}/{y}")
        print(f"  zoom {z}: wrote {len(plan[z])} tiles")

    place = {
        "name": spec.get("name", a.place),
        "built": time.strftime("%Y-%m-%d"),
        "bounds": [round(v, 5) for v in (lat0, lon0, lat1, lon1)],
        "zooms": zooms,
        "tiles": listing,
        "note": "Terrain tiles built by tools/places/build_place.py from laser-survey data. Do not edit by hand.",
    }
    json.dump(place, open(os.path.join(folder, "place.json"), "w"), indent=1)
    size = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(out_dir) for fn in fns)
    print(f"Done: {sum(len(v) for v in listing.values())} tiles, {size / 1e6:.1f} MB, in {out_dir}")
    print(f"Check {os.path.join(folder, 'preview.png')}: the survey data inside the corridor, shaded.")


if __name__ == "__main__":
    main()
