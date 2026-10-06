#!/usr/bin/env python3
"""Build a bundled area file (public/data/<slug>.json) from Overture Maps.

Overture Maps data is derived from OpenStreetMap (ODbL) and other open sources.
Usage:
  pip install pyarrow shapely
  python3 tools/extract_overture.py --name Yenisahra --slug yenisahra \
      --full "Yenisahra Mahallesi, Ataşehir, İstanbul"

The neighbourhood boundary is looked up in the Overture divisions theme by name.
Set HTTPS_PROXY if you are behind a proxy. Raw downloads are cached in --cache.
"""
import argparse, json, os, pickle, hashlib
import pyarrow.dataset as ds, pyarrow.fs as pfs, pyarrow.compute as pc
from shapely import wkb
from shapely.geometry import Point, mapping, shape
from shapely.ops import unary_union

RELEASE = "overturemaps-us-west-2/release/2026-09-23.0"

def s3():
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    kw = dict(anonymous=True, region="us-west-2")
    if proxy:
        kw["proxy_options"] = proxy
    return pfs.S3FileSystem(**kw)

def bbox_filter(x0, y0, x1, y1):
    f = pc.field
    return ((f(("bbox", "xmin")) < x1) & (f(("bbox", "xmax")) > x0) &
            (f(("bbox", "ymin")) < y1) & (f(("bbox", "ymax")) > y0))

def fetch(fs, theme, typ, bb, cache, cols=None):
    key = hashlib.md5(f"{RELEASE}{theme}{typ}{bb}".encode()).hexdigest()[:10]
    path = os.path.join(cache, f"{typ}-{key}.pkl")
    if os.path.exists(path):
        return pickle.load(open(path, "rb"))
    d = ds.dataset(f"{RELEASE}/theme={theme}/type={typ}/", filesystem=fs, format="parquet")
    rows = d.to_table(filter=bbox_filter(*bb), columns=cols).to_pylist()
    pickle.dump(rows, open(path, "wb"))
    return rows

def r6(v):
    return round(v, 6)

def ring(coords):
    return [[r6(x), r6(y)] for x, y in coords]

WALKABLE = {
    "primary": "primary", "secondary": "secondary", "tertiary": "tertiary",
    "residential": "residential", "living_street": "residential", "unclassified": "residential",
    "unknown": "minor", "service": "service", "pedestrian": "pedestrian",
    "footway": "footway", "path": "footway", "steps": "steps", "cycleway": "footway", "track": "footway",
}

def flags(r):
    out = set()
    for fl in r.get("road_flags") or []:
        out.update(fl.get("values") or [])
    return out

def poi_type(r):
    cat = r.get("basic_category") or ""
    hier = set(((r.get("taxonomy") or {}).get("hierarchy")) or [])
    name = ((r.get("names") or {}).get("primary") or "").lower()
    if "bakery" in hier or cat == "bakery" or any(w in name for w in ("fırın", "simit", "unlu", "pastane", "börek")):
        return "bakery"
    if cat in ("cafe", "coffee_shop", "tea_room") or "cafe" in hier or "kahve" in name or "çay" in name:
        return "cafe"
    if cat in ("restaurant", "casual_eatery", "fast_food_restaurant") or "restaurant" in hier:
        return "food"
    if cat in ("grocery_store", "supermarket", "convenience_store", "food_and_beverage_store") or "market" in name or "bakkal" in name:
        return "market"
    if cat == "muslim_place_of_worship" or "cami" in name:
        return "mosque"
    if "school" in cat or cat in ("education", "elementary_school", "high_school", "college_university"):
        return "school"
    if cat in ("park", "playground"):
        return "park"
    if "pharmacy" in cat or "eczane" in name:
        return "pharmacy"
    if cat in ("animal_or_pet_service", "pet_store", "veterinarian"):
        return "pet"
    if "store" in cat or cat in ("shopping", "shopping_mall", "department_store"):
        return "shop"
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--full", default=None)
    ap.add_argument("--search-bbox", default="28.5,40.8,29.5,41.3")
    ap.add_argument("--cache", default=".overture-cache")
    ap.add_argument("--out", default="public/data")
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    fs = s3()

    sb = [float(v) for v in a.search_bbox.split(",")]
    divs = fetch(fs, "divisions", "division_area", tuple(sb), a.cache,
                 cols=["id", "subtype", "names", "geometry", "bbox"])
    cands = [d for d in divs if ((d["names"] or {}).get("primary") or "").lower().startswith(a.name.lower())
             and d["subtype"] in ("neighborhood", "macrohood", "microhood")]
    if not cands:
        raise SystemExit(f"no division named {a.name}")
    boundary = wkb.loads(cands[0]["geometry"])
    if boundary.geom_type == "MultiPolygon":
        boundary = max(boundary.geoms, key=lambda g: g.area)
    deg = 1 / 111320.0
    keep_streets = boundary.buffer(60 * deg)
    keep_ctx = boundary.buffer(160 * deg)
    x0, y0, x1, y1 = keep_ctx.bounds
    bb = (x0, y0, x1, y1)

    segs = fetch(fs, "transportation", "segment", bb, a.cache)
    streets = []
    for r in segs:
        if r["subtype"] != "road" or r["class"] not in WALKABLE:
            continue
        fl = flags(r)
        if "is_tunnel" in fl or r.get("subclass") in ("driveway", "parking_aisle"):
            continue
        if any((lv.get("value") or 0) < 0 for lv in r.get("level_rules") or []):
            continue
        g = wkb.loads(r["geometry"])
        if not g.intersects(keep_streets):
            continue
        st = {"n": (r["names"] or {}).get("primary"), "k": WALKABLE[r["class"]], "c": ring(g.coords)}
        if "is_bridge" in fl:
            st["b"] = 1
        streets.append(st)

    blds = fetch(fs, "buildings", "building", bb, a.cache)
    buildings = []
    for r in blds:
        if r.get("is_underground"):
            continue
        g = wkb.loads(r["geometry"])
        polys = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
        for p in polys:
            if not keep_ctx.contains(p.representative_point()) or p.area < (4 * deg * deg):
                continue
            b = {"c": ring(p.simplify(0.15 * deg).exterior.coords)[:-1]}
            if r.get("num_floors"):
                b["f"] = int(r["num_floors"])
            if r.get("height"):
                b["h"] = round(float(r["height"]), 1)
            buildings.append(b)

    places = fetch(fs, "places", "place", bb, a.cache)
    pois, seen = [], set()
    for r in places:
        if (r.get("confidence") or 0) < 0.5:
            continue
        t = poi_type(r)
        n = (r.get("names") or {}).get("primary")
        if not t or not n:
            continue
        pt = wkb.loads(r["geometry"])
        if not keep_streets.contains(pt):
            continue
        k = (n.lower(), round(pt.x, 4), round(pt.y, 4))
        if k in seen:
            continue
        seen.add(k)
        pois.append({"n": n, "t": t, "p": [r6(pt.x), r6(pt.y)]})

    infra = fetch(fs, "base", "infrastructure", bb, a.cache)
    for r in infra:
        cls = r.get("class")
        if cls not in ("subway_station", "bus_stop"):
            continue
        g = wkb.loads(r["geometry"])
        pt = g.centroid
        if not (keep_ctx if cls == "subway_station" else keep_streets).contains(pt):
            continue
        n = (r.get("names") or {}).get("primary") or ("Otobüs Durağı" if cls == "bus_stop" else "Metro")
        pois.append({"n": n, "t": "metro" if cls == "subway_station" else "bus", "p": [r6(pt.x), r6(pt.y)]})

    lu = fetch(fs, "base", "land_use", bb, a.cache)
    areas = []
    AREA = {"park": "park", "grass": "grass", "pitch": "pitch", "playground": "park", "garden": "park",
            "school": "school", "religious": "religious", "cemetery": "grass", "meadow": "grass"}
    for r in lu:
        t = AREA.get(r.get("class"))
        if not t:
            continue
        g = wkb.loads(r["geometry"]).intersection(keep_ctx)
        polys = list(g.geoms) if g.geom_type in ("MultiPolygon", "GeometryCollection") else [g]
        for p in polys:
            if p.geom_type != "Polygon" or p.is_empty:
                continue
            areas.append({"t": t, "c": ring(p.simplify(0.5 * deg).exterior.coords)[:-1]})

    c = boundary.centroid
    out = {
        "version": 1,
        "name": a.name,
        "fullName": a.full or a.name,
        "source": "Overture Maps Foundation (2026-09-23) — © OpenStreetMap katkıcıları (ODbL)",
        "center": [r6(c.x), r6(c.y)],
        "boundary": ring(boundary.simplify(0.5 * deg).exterior.coords)[:-1],
        "streets": streets,
        "buildings": buildings,
        "pois": pois,
        "areas": areas,
    }
    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, f"{a.slug}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print(path, os.path.getsize(path), "bytes;", len(streets), "streets", len(buildings), "buildings",
          len(pois), "pois", len(areas), "areas")

if __name__ == "__main__":
    main()
