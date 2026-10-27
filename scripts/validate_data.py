#!/usr/bin/env python3
"""Prüft die Standortdaten in public/data auf Schema- und Plausibilitätsfehler.

  python3 scripts/validate_data.py              # prüft public/data
  python3 scripts/validate_data.py --data pfad  # anderer Ordner

Exit-Code 0 = in Ordnung (Warnungen möglich), 1 = Fehler gefunden.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TYPES = {"slip", "marina", "fuel"}
ACCESS = {None, "public", "permissive", "customers", "members", "permit", "private"}
TRI_ATTRS = {"motorboat", "parking", "trailer_parking", "visitor_berths", "electricity", "water_tap", "toilets", "showers",
             "restaurant", "harbour_master", "diesel", "petrol", "reach_water", "reach_land"}
STR_ATTRS = {"surface", "incline", "suitable_boats", "suitable_trailers", "berth_fee", "trailer_note"}
PATCH_FIELDS = {"name", "locality", "access", "fee", "fee_note", "opening_hours", "operator", "website", "phone", "email", "description", "lat", "lon"}
STATUS = {"pending", "approved", "rejected"}
FOTO_KATEGORIEN = {"rampe", "steg", "zufahrt", "parkplatz", "umgebung", "sonstiges"}   # wie public/js/foto-kategorien.js
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")
PRICE_MIN, PRICE_MAX = 0.5, 5.0
FILE_TYPE = {"slip": "slip", "marina": "marina", "fuel": "fuel"}


EXTRA_KINDS = {"lock", "bridge", "weir", "canoe", "rental", "toilets", "water", "food", "rest", "parking"}


class Report:
    def __init__(self):
        self.errors, self.warnings = [], []

    def err(self, where, msg):
        self.errors.append(f"{where}: {msg}")

    def warn(self, where, msg):
        self.warnings.append(f"{where}: {msg}")


def load(path: pathlib.Path, rep: Report):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        rep.err(path.name, "Datei fehlt")
    except ValueError as e:
        rep.err(path.name, f"kein gültiges JSON ({e})")
    return None


def finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def check_place(where, p, rep, expected_type=None):
    if p.get("type") not in TYPES:
        rep.err(where, f"unbekannte Kategorie {p.get('type')!r}")
    elif expected_type and p["type"] != expected_type:
        rep.err(where, f"Kategorie {p['type']!r} liegt in der Datei für {expected_type!r}")
    if p.get("access") not in ACCESS:
        rep.err(where, f"ungültiger Zugang {p.get('access')!r}")
    if p.get("fee") not in (True, False, None):
        rep.err(where, "fee muss true, false oder null sein")
    w = p.get("website")
    if w is not None and not (isinstance(w, str) and w.lower().startswith(("http://", "https://"))):
        rep.err(where, f"website ist keine http(s)-Adresse: {w!r}")
    attrs = p.get("attrs") or {}
    if not isinstance(attrs, dict):
        rep.err(where, "attrs muss ein Objekt sein")
        return
    for k, v in attrs.items():
        if k in TRI_ATTRS and v not in (True, False, None):
            rep.err(where, f"attrs.{k} muss true/false/null sein, nicht {v!r}")
        if k in STR_ATTRS and v is not None and not isinstance(v, str):
            rep.err(where, f"attrs.{k} muss Text sein")
    if "berths" in attrs and attrs["berths"] is not None and not (isinstance(attrs["berths"], int) and attrs["berths"] >= 0):
        rep.err(where, "attrs.berths muss eine ganze Zahl ≥ 0 sein")
    water = p.get("water")
    if water is not None and not (isinstance(water, dict) and isinstance(water.get("name"), str) and water["name"].strip()):
        rep.err(where, "water braucht einen Namen")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "public" / "data"))
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    d = pathlib.Path(args.data)
    rep = Report()

    meta = load(d / "meta.json", rep) or {}
    files = meta.get("files") or {}
    osm_files = files.get("osm") or ["osm/slip.geojson", "osm/marina.geojson", "osm/fuel.geojson"]
    com = files.get("community") or {"places": "community/places.json", "overrides": "community/overrides.json", "prices": "community/prices.json"}

    ids: dict[str, str] = {}
    counts = {t: 0 for t in TYPES}
    for rel in osm_files:
        data = load(d / rel, rep)
        if data is None:
            continue
        if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
            rep.err(rel, "ist keine FeatureCollection")
            continue
        expected = FILE_TYPE.get(pathlib.Path(rel).stem)
        for i, f in enumerate(data["features"]):
            fid = f.get("id")
            where = f"{rel}[{i}] {fid}"
            if not isinstance(fid, str) or not re.match(r"^(node|way|relation)/\d+$", fid):
                rep.err(where, "id muss 'node/123', 'way/123' oder 'relation/123' sein")
                continue
            if fid in ids:
                rep.err(where, f"doppelte id (auch in {ids[fid]})")
            ids[fid] = rel
            g = f.get("geometry") or {}
            c = g.get("coordinates")
            if g.get("type") != "Point" or not (isinstance(c, list) and len(c) == 2 and all(finite(x) for x in c)):
                rep.err(where, "Geometrie muss ein Point mit [lon, lat] sein")
                continue
            lon, lat = c
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                rep.err(where, f"Koordinaten außerhalb des gültigen Bereichs: {lat}, {lon}")
            elif not (47 <= lat <= 55.2 and 5.5 <= lon <= 15.1):
                rep.warn(where, f"liegt außerhalb Deutschlands ({lat}, {lon})")
            props = f.get("properties") or {}
            check_place(where, props, rep, expected)
            osm = props.get("osm") or {}
            if f"{osm.get('type')}/{osm.get('id')}" != fid:
                rep.err(where, "properties.osm passt nicht zur id")
            if props.get("type") in counts:
                counts[props["type"]] += 1
            if not props.get("name"):
                rep.warn(where, "ohne Namen")

    # Extras (Schleusen, Service usw.) – eigene Datei, eigene IDs dürfen sich mit Standorten überschneiden
    n_extras = 0
    if files.get("extras"):
        data = load(d / files["extras"], rep)
        if data is not None and (data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list)):
            rep.err(files["extras"], "ist keine FeatureCollection")
        elif data is not None:
            seen_x = set()
            for i, f in enumerate(data["features"]):
                fid, props = f.get("id"), f.get("properties") or {}
                where = f"{files['extras']}[{i}] {fid}"
                g = (f.get("geometry") or {}).get("coordinates")
                if not isinstance(fid, str) or not re.match(r"^(node|way|relation)/\d+$", fid) or fid in seen_x:
                    rep.err(where, "id fehlt, ist ungültig oder doppelt")
                elif not (isinstance(g, list) and len(g) == 2 and all(finite(x) for x in g) and 47 <= g[1] <= 55.2 and 5.5 <= g[0] <= 15.1):
                    rep.err(where, "Koordinaten fehlen oder liegen außerhalb Deutschlands")
                elif props.get("kind") not in EXTRA_KINDS:
                    rep.err(where, f"unbekannte Art {props.get('kind')!r}")
                elif props.get("website") and not str(props["website"]).lower().startswith(("http://", "https://")):
                    rep.err(where, "website ist keine http(s)-Adresse")
                seen_x.add(fid)
            n_extras = len(seen_x)

    # Hafeninfos (von Websites ausgelesen): jede Angabe braucht bekannten Schlüssel, Zitat und http(s)-Quelle
    if files.get("hafeninfo"):
        doc = load(d / files["hafeninfo"], rep) or {}
        hplaces = doc.get("places")
        if not isinstance(hplaces, dict):
            rep.err(files["hafeninfo"], "places muss ein Objekt sein")
        else:
            keys = set(doc.get("schema") or {})
            for pid, entry in hplaces.items():
                for i, f in enumerate((entry or {}).get("facts") or []):
                    where = f"{files['hafeninfo']} {pid} [{i}]"
                    if keys and f.get("key") not in keys:
                        rep.err(where, f"unbekannter Schlüssel {f.get('key')!r}")
                    if not f.get("value") or not f.get("quote"):
                        rep.err(where, "Wert oder Zitat fehlt")
                    if not str(f.get("url", "")).lower().startswith(("http://", "https://")):
                        rep.err(where, "Quelle ist keine http(s)-Adresse")

    places = load(d / com["places"], rep) or []
    if not isinstance(places, list):
        rep.err(com["places"], "muss eine Liste sein")
        places = []
    for i, p in enumerate(places):
        where = f"{com['places']}[{i}] {p.get('id')}"
        if p.get("status") not in STATUS:
            rep.err(where, f"status muss {sorted(STATUS)} sein")
        pid = p.get("id")
        if not isinstance(pid, str) or not pid.startswith("c/"):
            rep.err(where, "Community-IDs müssen mit 'c/' beginnen")
            continue
        if pid in ids:
            rep.err(where, "doppelte id")
        ids[pid] = "community"
        if not (finite(p.get("lat")) and finite(p.get("lon"))):
            rep.err(where, "lat/lon fehlen")
        check_place(where, p, rep)

    overrides = load(d / com["overrides"], rep) or []
    for i, o in enumerate(overrides if isinstance(overrides, list) else []):
        where = f"{com['overrides']}[{i}] {o.get('id')}"
        if o.get("id") not in ids:
            rep.warn(where, "bezieht sich auf einen Standort, der nicht (mehr) existiert")
        if o.get("status") not in STATUS:
            rep.err(where, "status fehlt oder ungültig")
        bad = set((o.get("fields") or {}).keys()) - PATCH_FIELDS
        if bad:
            rep.err(where, f"nicht änderbare Felder: {sorted(bad)}")
        for ph in o.get("photos") or []:
            if not str(ph.get("url", "")).startswith(("photos/", "./photos/", "/photos/")):
                rep.err(where, "Foto-URL muss auf photos/ zeigen")
            if not ph.get("credit"):
                rep.warn(where, "Foto ohne Urheber-/Rechteangabe")
            if ph.get("kategorie") is not None and ph.get("kategorie") not in FOTO_KATEGORIEN:
                rep.err(where, f"unbekannte Foto-Kategorie: {ph.get('kategorie')}")

    prices = load(d / com["prices"], rep) or []
    today = dt.date.today().isoformat()
    for i, r in enumerate(prices if isinstance(prices, list) else []):
        where = f"{com['prices']}[{i}] {r.get('station_id')}"
        if r.get("status") not in STATUS:
            rep.err(where, "status fehlt oder ungültig")
        if r.get("fuel") not in ("diesel", "petrol"):
            rep.err(where, "fuel muss 'diesel' oder 'petrol' sein")
        if not finite(r.get("price")) or not (PRICE_MIN <= r["price"] <= PRICE_MAX):
            rep.err(where, f"Preis außerhalb {PRICE_MIN}–{PRICE_MAX} €/l: {r.get('price')!r}")
        obs = r.get("observed")
        if not (isinstance(obs, str) and ISO_DATE.match(obs)):
            rep.err(where, "observed braucht ein Datum (JJJJ-MM-TT)")
        elif obs[:10] > today:
            rep.err(where, "observed liegt in der Zukunft")
        if r.get("station_id") not in ids:
            rep.err(where, "station_id unbekannt")

    if not args.quiet:
        print(f"Geprüft: {sum(counts.values())} OSM-Standorte "
              f"({counts['slip']} Slipanlagen, {counts['marina']} Marinas, {counts['fuel']} Tankstellen), "
              f"{len(places)} Community-Standorte, {len(prices)} Preismeldungen"
              f"{f', {n_extras} Extras' if n_extras else ''}.")
        unnamed = sum(1 for w in rep.warnings if w.endswith("ohne Namen"))
        other = [w for w in rep.warnings if not w.endswith("ohne Namen")]
        if unnamed:
            print(f"Hinweis: {unnamed} Standorte ohne Namen (werden als „… (ohne Namen)“ angezeigt).")
        for w in other[:30]:
            print("WARNUNG ", w)
        for e in rep.errors[:60]:
            print("FEHLER  ", e)
        if len(rep.errors) > 60:
            print(f"… und {len(rep.errors) - 60} weitere Fehler")
        print("Ergebnis:", "OK" if not rep.errors else f"{len(rep.errors)} Fehler")
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main())
