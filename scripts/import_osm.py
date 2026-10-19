#!/usr/bin/env python3
"""WaterMap – OSM-Import für Nordrhein-Westfalen.

Holt Slipanlagen, Marinas und Bootstankstellen aus OpenStreetMap (Overpass API), prüft sie,
fasst Dubletten zusammen und schreibt GeoJSON-Dateien nach public/data/osm/.

  python3 scripts/import_osm.py                       # Live-Import (Internet nötig)
  python3 scripts/import_osm.py --dry-run             # nur rechnen und berichten, nichts schreiben
  python3 scripts/import_osm.py --input antwort.json  # gespeicherte Overpass-Antwort verwenden

Nur Python-Standardbibliothek (ab Python 3.9) – es muss nichts installiert werden.

Grundsätze
  * Nichts wird erfunden. Was OSM nicht eindeutig angibt, bleibt null (App: „Nicht bekannt“).
  * Fällt eine Kategorie aus, bleiben ihre bisherigen Dateien unverändert.
  * Bricht das Ergebnis stark ein (< 50 % der bisherigen Datensätze), wird nichts überschrieben.
  * Community-Daten (public/data/community/) werden nie angefasst.
Quelle: © OpenStreetMap-Mitwirkende, ODbL 1.0 – https://www.openstreetmap.org/copyright
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "public" / "data"

SCHEMA_VERSION = 2
USER_AGENT = "WaterMap-Importer/7.0 (Wassersport-Karte NRW; Kontakt siehe Projekt-Impressum)"
SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

CATEGORIES = ("slip", "marina", "fuel")
FILES = {"slip": "osm/slip.geojson", "marina": "osm/marina.geojson", "fuel": "osm/fuel.geojson"}

# Region (ISO-3166-2). Weitere Länder: --area DE-BY usw. (Bounding-Box dann mit --bbox anpassen).
DEFAULT_AREA = "DE-NW"
NRW_BBOX = (50.30, 5.85, 52.55, 9.50)  # süd, west, nord, ost – Koordinaten außerhalb gelten als Fehler

DEDUPE_RADIUS_M = {"slip": 25, "marina": 150, "fuel": 60}
WATER_MAX_M = 80
PLACE_MAX_M = 10_000
MIN_KEEP_RATIO = 0.5


def area_clause(iso: str) -> str:
    return f'area["ISO3166-2"="{iso}"]["boundary"="administrative"]->.a;'


def queries(iso: str) -> dict[str, str]:
    a = area_clause(iso)
    objects = f"""(
  nwr["leisure"="slipway"](area.a);
  nwr["seamark:small_craft_facility:category"~"slipway"](area.a);
  nwr["leisure"="marina"](area.a);
  nwr["seamark:type"="harbour"]["seamark:harbour:category"~"marina"](area.a);
  nwr["waterway"="fuel"](area.a);
  nwr["seamark:small_craft_facility:category"~"fuel_station"](area.a);
)"""
    return {
        # Hauptabfrage: alle Standorte in einem Rutsch (spart Wartezeit auf den öffentlichen Servern)
        "main": f"[out:json][timeout:240];{a}{objects};out meta center;",
        # Nächster Ort: nur Ortspunkte im Umkreis der Standorte
        "places": f"[out:json][timeout:240];{a}{objects}->.s;"
                  f'node["place"~"^(city|town|village|suburb|borough|hamlet)$"]["name"](around.s:{PLACE_MAX_M});out;',
        # Gewässer: benannte Gewässer in unmittelbarer Nähe der Standorte (mit Geometrie)
        "water": f"[out:json][timeout:240];{a}{objects}->.s;"
                 f"(way[\"natural\"=\"water\"][\"name\"](around.s:{WATER_MAX_M});"
                 f"way[\"waterway\"~\"^(river|canal|stream|riverbank|dock)$\"][\"name\"](around.s:{WATER_MAX_M});"
                 f"rel[\"natural\"=\"water\"][\"name\"](around.s:{WATER_MAX_M}););out geom;",
    }


# --------------------------------------------------------------------------- Hilfen
def haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def tri(value):
    """OSM yes/no → True/False; alles andere → None. Unbekannt ist nie „Nein“."""
    if value is None:
        return None
    v = str(value).strip().lower()
    if v in ("yes", "true", "1", "designated"):
        return True
    if v in ("no", "false", "0"):
        return False
    return None


def first(tags, *keys):
    for k in keys:
        v = tags.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()
    return None


def split_list(value) -> set[str]:
    if not value:
        return set()
    return {p.strip().lower() for p in str(value).replace(",", ";").split(";") if p.strip()}


def safe_url(value):
    if not value:
        return None
    v = value.strip()
    if v.lower().startswith(("http://", "https://")):
        return v[:300]
    if "." in v and " " not in v and ":" not in v and "/" not in v[:1]:
        return ("https://" + v)[:300]
    return None


def parse_int(value):
    try:
        n = int(str(value).strip().split()[0])
        return n if n >= 0 else None
    except (ValueError, IndexError):
        return None


def clip(text, n):
    return text if text is None or len(text) <= n else text[: n - 1] + "…"


ACCESS_MAP = {
    "yes": "public", "public": "public", "permissive": "permissive", "customers": "customers",
    "destination": "customers", "members": "members", "permit": "permit", "private": "private", "no": "private",
}


def classify(tags: dict) -> str | None:
    cat = split_list(tags.get("seamark:small_craft_facility:category"))
    if tags.get("leisure") == "slipway" or "slipway" in cat:
        return "slip"
    if tags.get("leisure") == "marina" or (
        tags.get("seamark:type") == "harbour" and "marina" in split_list(tags.get("seamark:harbour:category"))
    ):
        return "marina"
    if tags.get("waterway") == "fuel" or "fuel_station" in cat:
        return "fuel"
    return None


def is_inactive(tags: dict) -> bool:
    return any(tri(tags.get(k)) for k in ("disused", "abandoned")) or any(k.startswith(("disused:", "abandoned:", "was:")) and k.split(":", 1)[1] in ("leisure", "waterway") for k in tags)


# --------------------------------------------------------------------------- Transformation
def transform(el: dict, kind: str | None = None, bbox=NRW_BBOX) -> dict | None:
    tags = el.get("tags") or {}
    kind = kind or classify(tags)
    if kind not in CATEGORIES or is_inactive(tags):
        return None
    c = el.get("center") or {}
    lat, lon = el.get("lat", c.get("lat")), el.get("lon", c.get("lon"))
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)) or not (math.isfinite(lat) and math.isfinite(lon)):
        return None
    if not (bbox[0] <= lat <= bbox[2] and bbox[1] <= lon <= bbox[3]):
        return None
    if el.get("type") not in ("node", "way", "relation") or not isinstance(el.get("id"), int):
        return None

    locality = first(tags, "addr:city", "addr:town", "addr:village", "addr:place")
    props = {
        "type": kind,
        "name": clip(first(tags, "name"), 120),
        "locality": locality,
        "locality_kind": "address" if locality else None,
        "water": None,
        "access": ACCESS_MAP.get((tags.get("access") or "").strip().lower()),
        "fee": tri(tags.get("fee")),
        "fee_note": clip(first(tags, "charge"), 120),
        "opening_hours": clip(first(tags, "opening_hours"), 200),
        "operator": clip(first(tags, "operator"), 120),
        "website": safe_url(first(tags, "website", "contact:website", "url")),
        "phone": clip(first(tags, "phone", "contact:phone"), 40),
        "email": clip(first(tags, "email", "contact:email"), 120),
        "description": clip(first(tags, "description:de", "description"), 500),
        "attrs": {},
        "osm": {"type": el["type"], "id": el["id"], "timestamp": el.get("timestamp")},
        "also_osm": [],
        "source": "osm",
        "imported": None,
    }
    {"slip": _slip, "marina": _marina, "fuel": _fuel}[kind](props["attrs"], tags)
    return {
        "type": "Feature",
        "id": f"{el['type']}/{el['id']}",
        "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
        "properties": props,
    }


def _slip(a, tags):
    a.update({
        "surface": clip(first(tags, "surface"), 60), "incline": clip(first(tags, "incline"), 30),
        "motorboat": tri(tags.get("motorboat")),
        "parking": None, "trailer_parking": None,        # kein verlässlicher OSM-Tag → nur Community
    })


def _marina(a, tags):
    fac = split_list(tags.get("seamark:small_craft_facility:category"))

    def f(direct_keys, seamark_values):
        for k in direct_keys:
            v = tri(tags.get(k))
            if v is not None:
                return v
        return True if fac & set(seamark_values) else None

    a.update({
        "berths": parse_int(tags.get("capacity")),
        "visitor_berths": True if fac & {"visitor_berth", "visitors_berth", "visitor_berths"} else None,
        "electricity": f(["power_supply"], ["electricity"]),
        "water_tap": f(["drinking_water"], ["water_tap"]),
        "toilets": f(["toilets"], ["toilets", "public_toilets"]),
        "showers": f(["shower", "showers"], ["showers"]),
        "restaurant": f(["restaurant"], ["restaurant", "public_inn"]),
    })


def _fuel(a, tags):
    octane = [tri(tags.get(k)) for k in ("fuel:octane_91", "fuel:octane_95", "fuel:octane_98", "fuel:octane_100", "fuel:e5", "fuel:e10")]
    known = [v for v in octane if v is not None]
    pay = sorted(k.split(":", 1)[1] for k, v in tags.items() if k.startswith("payment:") and tri(v))
    a.update({
        "diesel": tri(tags.get("fuel:diesel")),
        "petrol": (True if any(known) else False) if known else None,
        "payment": pay[:8] or None,
        "reach_water": None, "reach_land": None,       # kein OSM-Standard → Community
    })


# --------------------------------------------------------------------------- Dubletten
def _filled(p):
    return sum(1 for k, v in p.items() if k not in ("osm", "also_osm", "source", "imported", "type", "attrs") and v not in (None, [], ""))


def _score(f):
    p = f["properties"]
    return (1 if p["name"] else 0, _filled(p) + sum(v is not None for v in p["attrs"].values()), 1 if p["osm"]["type"] != "node" else 0, -p["osm"]["id"])


def dedupe(features: list[dict], radius_m: float) -> tuple[list[dict], int]:
    """Fasst Objekte zusammen, die dasselbe Ding mehrfach beschreiben (z. B. Marina als Fläche und als Punkt).
    Bedingung: nah beieinander UND (gleicher Name ODER mindestens einer ohne Namen)."""
    cell = max(radius_m / 111_000 * 2, 0.0005)
    grid: dict[tuple, list[int]] = {}
    for i, f in enumerate(features):
        lon, lat = f["geometry"]["coordinates"]
        grid.setdefault((int(lat // cell), int(lon // cell)), []).append(i)
    parent = list(range(len(features)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, f in enumerate(features):
        lon, lat = f["geometry"]["coordinates"]
        n1 = (f["properties"]["name"] or "").casefold()
        ci, cj = int(lat // cell), int(lon // cell)
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for j in grid.get((ci + di, cj + dj), ()):
                    if j <= i:
                        continue
                    n2 = (features[j]["properties"]["name"] or "").casefold()
                    if n1 and n2 and n1 != n2:
                        continue
                    lon2, lat2 = features[j]["geometry"]["coordinates"]
                    if haversine_m(lat, lon, lat2, lon2) <= radius_m:
                        parent[find(j)] = find(i)

    groups: dict[int, list[dict]] = {}
    for i, f in enumerate(features):
        groups.setdefault(find(i), []).append(f)
    out, merged = [], 0
    for members in groups.values():
        members.sort(key=_score, reverse=True)
        primary = members[0]
        for other in members[1:]:
            merged += 1
            op, pp = other["properties"], primary["properties"]
            pp["also_osm"].append(other["id"])
            for k, v in op.items():
                if k in ("osm", "also_osm", "source", "imported", "type", "attrs"):
                    continue
                if pp.get(k) in (None, [], "") and v not in (None, [], ""):
                    pp[k] = v
            for k, v in op["attrs"].items():
                if pp["attrs"].get(k) is None and v is not None:
                    pp["attrs"][k] = v
        out.append(primary)
    return out, merged


# --------------------------------------------------------------------------- Anreicherung
def attach_places(features, places) -> int:
    rank = {"city": 0, "town": 1, "suburb": 2, "borough": 2, "village": 3, "hamlet": 4}
    pts = [(e["lat"], e["lon"], e["tags"]["name"]) for e in places
           if e.get("type") == "node" and isinstance(e.get("lat"), (int, float)) and isinstance(e.get("lon"), (int, float))
           and (e.get("tags") or {}).get("name") and e["tags"].get("place") in rank]
    n = 0
    for f in features:
        p = f["properties"]
        if p["locality"]:
            continue
        lon, lat = f["geometry"]["coordinates"]
        best = None
        for plat, plon, name in pts:
            if abs(plat - lat) > 0.1 or abs(plon - lon) > 0.16:
                continue
            d = haversine_m(lat, lon, plat, plon)
            if d <= PLACE_MAX_M and (best is None or d < best[0]):
                best = (d, name)
        if best:
            p["locality"], p["locality_kind"] = best[1], "nearest"
            n += 1
    return n


def _seg_dist_m(lat, lon, a, b) -> float:
    """Abstand Punkt–Strecke in Metern (lokale ebene Näherung, für < 1 km ausreichend)."""
    k = math.cos(math.radians(lat)) * 111_320
    ax, ay = (a[1] - lon) * k, (a[0] - lat) * 110_540
    bx, by = (b[1] - lon) * k, (b[0] - lat) * 110_540
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, -(ax * dx + ay * dy) / L))
    return math.hypot(ax + t * dx, ay + t * dy)


def _inside(lat, lon, ring) -> bool:
    inside = False
    for i in range(len(ring) - 1):
        (y1, x1), (y2, x2) = ring[i], ring[i + 1]
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def _water_shapes(elements):
    shapes = []
    for e in elements:
        name = (e.get("tags") or {}).get("name")
        if not name:
            continue
        lines = []
        if e.get("type") == "way" and e.get("geometry"):
            lines.append([(g["lat"], g["lon"]) for g in e["geometry"]])
        elif e.get("type") == "relation":
            for m in e.get("members", []):
                if m.get("type") == "way" and m.get("geometry"):
                    lines.append([(g["lat"], g["lon"]) for g in m["geometry"]])
        lines = [ln for ln in lines if len(ln) >= 2]
        if not lines:
            continue
        pts = [p for ln in lines for p in ln]
        bbox = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
        closed = e.get("type") == "way" and lines[0][0] == lines[0][-1] and len(lines[0]) >= 4
        shapes.append({"name": name.strip(), "lines": lines, "bbox": bbox, "ring": lines[0] if closed else None})
    return shapes


def attach_water(features, elements) -> int:
    shapes = _water_shapes(elements)
    if not shapes:
        return 0
    pad = WATER_MAX_M / 90_000
    n = 0
    for f in features:
        lon, lat = f["geometry"]["coordinates"]
        best = None
        for s in shapes:
            b = s["bbox"]
            if lat < b[0] - pad or lat > b[2] + pad or lon < b[1] - pad * 1.7 or lon > b[3] + pad * 1.7:
                continue
            d = 0.0 if s["ring"] and _inside(lat, lon, s["ring"]) else min(
                (_seg_dist_m(lat, lon, ln[i], ln[i + 1]) for ln in s["lines"] for i in range(len(ln) - 1)), default=1e9)
            if d <= WATER_MAX_M and (best is None or d < best[0]):
                best = (d, s["name"])
        if best:
            f["properties"]["water"] = {"name": best[1], "approx": True, "dist_m": round(best[0])}
            n += 1
    return n


# --------------------------------------------------------------------------- Netzwerk
class FetchError(RuntimeError):
    pass


def overpass(query: str, log=print, servers=SERVERS, attempts=2) -> dict:
    last = "unbekannter Fehler"
    for server in servers:
        for attempt in range(1, attempts + 1):
            try:
                log(f"    → {server} (Versuch {attempt})")
                req = urllib.request.Request(
                    server, data=urllib.parse.urlencode({"data": query}).encode(),
                    headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=320) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                if not isinstance(payload.get("elements"), list):
                    raise ValueError("Antwort ohne 'elements'")
                remark = str(payload.get("remark", ""))
                if "runtime error" in remark.lower() or "timed out" in remark.lower():
                    raise ValueError(f"Overpass meldet: {remark[:120]}")
                return payload
            except (urllib.error.URLError, ValueError, TimeoutError, OSError) as exc:
                last = f"{type(exc).__name__}: {str(exc)[:160]}"
                log(f"    ✗ {last}")
                time.sleep(5 * attempt)
    raise FetchError(last)


# --------------------------------------------------------------------------- Verarbeitung (ohne Netzwerk/Dateien)
def build(main_elements, places=None, water=None, today=None, bbox=NRW_BBOX, log=print) -> dict:
    today = today or dt.date.today().isoformat()
    by_kind: dict[str, list[dict]] = {k: [] for k in CATEGORIES}
    seen, rejected = set(), {k: 0 for k in CATEGORIES}
    raw = {k: 0 for k in CATEGORIES}
    for el in main_elements:
        kind = classify(el.get("tags") or {})
        if kind is None:
            continue
        raw[kind] += 1
        f = transform(el, kind, bbox)
        if f is None:
            rejected[kind] += 1
        elif f["id"] not in seen:
            seen.add(f["id"])
            by_kind[kind].append(f)
    out = {"collections": {}, "stats": {}}
    for kind in CATEGORIES:
        feats, merged = dedupe(by_kind[kind], DEDUPE_RADIUS_M[kind])
        n_place = attach_places(feats, places) if places else 0
        n_water = attach_water(feats, water) if water else 0
        for f in feats:
            f["properties"]["imported"] = today
            f["properties"]["updated"] = (f["properties"]["osm"].get("timestamp") or today)[:10]
        feats.sort(key=lambda f: ((f["properties"]["name"] or "￿").casefold(), f["id"]))
        out["collections"][kind] = feats
        out["stats"][kind] = {
            "raw": raw[kind], "rejected": rejected[kind], "merged_duplicates": merged, "final": len(feats),
            "with_name": sum(1 for f in feats if f["properties"]["name"]),
            "with_locality": sum(1 for f in feats if f["properties"]["locality"]),
            "with_water": n_water, "with_nearest_place": n_place,
        }
        log(f"  {kind:7s} {raw[kind]:5d} roh → {len(feats):5d} (verworfen {rejected[kind]}, zusammengeführt {merged}, "
            f"mit Namen {out['stats'][kind]['with_name']}, Gewässer {n_water})")
    return out


# --------------------------------------------------------------------------- Dateien
def read_features(path: pathlib.Path) -> list:
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("features", [])
    except (OSError, ValueError):
        return []


def write_json(path: pathlib.Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    tmp.replace(path)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", help="gespeicherte Overpass-Antwort (Hauptabfrage) statt Live-Abruf")
    ap.add_argument("--places-input", help="gespeicherte Antwort der Orte-Abfrage (optional)")
    ap.add_argument("--water-input", help="gespeicherte Antwort der Gewässer-Abfrage (optional)")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="Datenordner (Standard: public/data)")
    ap.add_argument("--area", default=DEFAULT_AREA, help="ISO-3166-2-Code der Region (Standard: DE-NW)")
    ap.add_argument("--no-enrich", action="store_true", help="Orte und Gewässer nicht zuordnen")
    ap.add_argument("--dry-run", action="store_true", help="nichts schreiben")
    ap.add_argument("--force", action="store_true", help="Schutz vor starkem Datenverlust übergehen")
    args = ap.parse_args(argv)
    out_dir = pathlib.Path(args.out)
    today = dt.date.today().isoformat()
    qs = queries(args.area)
    enrich = {"places": "übersprungen", "water": "übersprungen"}

    def load(path):
        return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))

    status = {}
    if args.input:
        main_payload = load(args.input)
        places = load(args.places_input)["elements"] if args.places_input else None
        water = load(args.water_input)["elements"] if args.water_input else None
        enrich = {"places": "Datei" if places else "übersprungen", "water": "Datei" if water else "übersprungen"}
        status = {k: "ok (Datei)" for k in CATEGORIES}
        source_detail = f"Datei {pathlib.Path(args.input).name}"
    else:
        print(f"Overpass-Abruf für {args.area} …")
        try:
            print("  [Standorte]")
            main_payload = overpass(qs["main"])
        except FetchError as exc:
            print(f"✗ Abruf fehlgeschlagen: {exc}\nEs wurden KEINE Dateien verändert.", file=sys.stderr)
            return 2
        status = {k: "ok" for k in CATEGORIES}
        places = water = None
        if not args.no_enrich:
            for key in ("places", "water"):
                time.sleep(3)
                try:
                    print(f"  [{'Orte' if key == 'places' else 'Gewässer'}]")
                    data = overpass(qs[key])["elements"]
                    enrich[key] = "ok"
                    places, water = (data, water) if key == "places" else (places, data)
                except FetchError as exc:
                    enrich[key] = f"fehlgeschlagen ({exc})"
                    print(f"  ! Zuordnung '{key}' übersprungen, Import läuft ohne sie weiter.", file=sys.stderr)
        source_detail = "Overpass API"

    base_ts = (main_payload.get("osm3s") or {}).get("timestamp_osm_base")
    print("Verarbeitung …")
    built = build(main_payload["elements"], places, water, today, log=print)

    problems = []
    for kind, feats in built["collections"].items():
        old = read_features(out_dir / FILES[kind])
        if len(old) >= 20 and len(feats) < len(old) * MIN_KEEP_RATIO:
            problems.append(f"{kind}: nur {len(feats)} statt bisher {len(old)} Datensätze")
    if not any(built["collections"].values()):
        problems.append("Ergebnis ist komplett leer")
    if problems and not args.force:
        print("Abbruch – mögliche Datenverluste (mit --force übergehen):", *problems, sep="\n  ", file=sys.stderr)
        return 3
    if args.dry_run:
        print("Dry-Run: nichts geschrieben.")
        return 0

    meta_path = out_dir / "meta.json"
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        meta = {}
    for kind in CATEGORIES:
        write_json(out_dir / FILES[kind], {"type": "FeatureCollection", "features": built["collections"][kind]})
    meta.update({
        "schema_version": SCHEMA_VERSION,
        "region": f"{args.area}",
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "osm_base_timestamp": base_ts,
        "source": "OpenStreetMap (Overpass API)", "source_detail": source_detail,
        "license": "ODbL 1.0", "attribution": "© OpenStreetMap-Mitwirkende",
        "license_url": "https://www.openstreetmap.org/copyright",
        "notice": None,
        "files": meta.get("files") or {
            "osm": [FILES[k] for k in CATEGORIES],
            "community": {"places": "community/places.json", "overrides": "community/overrides.json", "prices": "community/prices.json"}},
        "categories": {k: built["stats"][k] for k in CATEGORIES},
        "enrichment": enrich,
        "total": sum(s["final"] for s in built["stats"].values()),
    })
    write_json(meta_path, meta)
    print(f"Fertig: {meta['total']} Standorte nach {out_dir} geschrieben.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
