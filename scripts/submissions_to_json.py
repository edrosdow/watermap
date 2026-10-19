#!/usr/bin/env python3
"""Wandelt den CSV-Export einer Netlify-Form in prüfbare JSON-Einträge für die Community-Schicht um.

  python3 scripts/submissions_to_json.py slipanlage-melden export.csv
  python3 scripts/submissions_to_json.py tankpreis-melden  export.csv

Netlify-Dashboard → Forms → Formular wählen → „Export CSV“.
Ausgabe: JSON auf dem Bildschirm. Alle Einträge haben "status": "pending". Prüfe jeden Eintrag
(Karte, Fotos, Plausibilität), setze ihn dann auf "approved" und füge ihn in die passende Datei in
public/data/community/ ein (siehe docs/MODERATION.md). Danach: python3 scripts/validate_data.py

Datenschutz: E-Mail-Adressen und IP-Adressen werden NICHT übernommen.
"""
import csv
import datetime as dt
import json
import re
import sys
import unicodedata

YNU = {"ja": True, "nein": False}
ACCESS = {"oeffentlich": "public", "privat": "private", "kunden": "customers"}
FUEL = {"diesel": "diesel", "benzin": "petrol"}


def slug(text: str) -> str:
    t = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:40] or "ohne-name"


def day(row) -> str:
    raw = (row.get("created_at") or row.get("Created at") or "").strip()
    return raw[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", raw) else dt.date.today().isoformat()


def num(text):
    try:
        return float(str(text).strip().replace(",", "."))
    except ValueError:
        return None


def slip(row, n):
    lat, lon = num(row.get("lat")), num(row.get("lon"))
    if lat is None or lon is None:
        return None, "Koordinaten fehlen oder sind ungültig"
    fee = row.get("gebuehr", "").strip()
    name = (row.get("name") or "").strip()
    item = {
        "id": f"c/{slug(name)}-{day(row).replace('-', '')}-{n}",
        "status": "pending", "type": "slip", "name": name or None,
        "lat": round(lat, 6), "lon": round(lon, 6),
        "water": {"name": row["gewaesser"].strip(), "approx": False} if (row.get("gewaesser") or "").strip() else None,
        "access": ACCESS.get(row.get("zugang", "").strip()),
        "fee": False if fee == "kostenlos" else True if fee == "kostenpflichtig" else None,
        "fee_note": (row.get("gebuehr_betrag") or "").strip() or None,
        "description": (row.get("beschreibung") or "").strip() or None,
        "attrs": {"parking": YNU.get(row.get("parkplatz", "").strip()), "trailer_parking": YNU.get(row.get("trailerparkplatz", "").strip())},
        "submitted": day(row),
        "updated": day(row),
    }
    return item, None


def price(row, n):
    sid = (row.get("tankstelle_id") or "").strip()
    if not sid or sid == "__other":
        return None, f"Tankstelle nicht in der Liste ({row.get('tankstelle_name', '?')}) – bitte manuell zuordnen"
    p = num(row.get("preis"))
    fuel = FUEL.get((row.get("kraftstoff") or "").strip())
    if p is None or fuel is None:
        return None, "Preis oder Kraftstoff ungültig"
    return {"station_id": sid, "fuel": fuel, "price": round(p, 3), "observed": (row.get("datum") or day(row))[:10],
            "status": "pending", "submitted": day(row)}, None


HANDLERS = {"slipanlage-melden": slip, "tankpreis-melden": price}


def main(argv):
    if len(argv) != 3 or argv[1] not in HANDLERS:
        print(__doc__)
        return 2
    out, skipped = [], []
    with open(argv[2], encoding="utf-8-sig", newline="") as fh:
        for i, row in enumerate(csv.DictReader(fh), 1):
            item, why = HANDLERS[argv[1]](row, i)
            (out if item else skipped).append(item or f"Zeile {i}: {why}")
    print(json.dumps(out, ensure_ascii=False, indent=2))
    for s in skipped:
        print("ÜBERSPRUNGEN:", s, file=sys.stderr)
    print(f"# {len(out)} Eintrag/Einträge, {len(skipped)} übersprungen", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
