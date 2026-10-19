#!/usr/bin/env python3
"""Lädt Leaflet und MarkerCluster nach public/vendor und schaltet die App auf Selbst-Hosting um.

  python3 scripts/vendor_libs.py

Vorteil: keine Abhängigkeit von unpkg/jsDelivr, bessere Datenschutz-Bilanz (keine IP-Übertragung an CDNs),
schnellerer Start. Danach den Ordner public erneut bei Netlify veröffentlichen.
Nur Standardbibliothek. Braucht Internet (unpkg.com).
"""
import hashlib
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
VENDOR = ROOT / "public" / "vendor"
CONFIG = ROOT / "public" / "js" / "config.js"
L = "https://unpkg.com/leaflet@1.9.4/dist/"
M = "https://unpkg.com/leaflet.markercluster@1.5.3/dist/"
FILES = {
    "leaflet/leaflet.js": L + "leaflet.js",
    "leaflet/leaflet.css": L + "leaflet.css",
    "leaflet/images/layers.png": L + "images/layers.png",
    "leaflet/images/layers-2x.png": L + "images/layers-2x.png",
    "leaflet/images/marker-icon.png": L + "images/marker-icon.png",
    "leaflet/images/marker-icon-2x.png": L + "images/marker-icon-2x.png",
    "leaflet/images/marker-shadow.png": L + "images/marker-shadow.png",
    "markercluster/leaflet.markercluster.js": M + "leaflet.markercluster.js",
    "markercluster/MarkerCluster.css": M + "MarkerCluster.css",
}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "WaterMap-vendor/7.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main():
    stored = {}
    for rel, url in FILES.items():
        try:
            data = fetch(url)
        except Exception as exc:  # noqa: BLE001
            print(f"✗ {url}\n  {exc}\nNichts wurde umgestellt.", file=sys.stderr)
            return 1
        if len(data) < 200:
            print(f"✗ {url}: Antwort verdächtig klein ({len(data)} Bytes). Abbruch.", file=sys.stderr)
            return 1
        stored[rel] = data
    for rel, data in stored.items():
        path = VENDOR / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        print(f"✓ {rel:45s} {len(data):8d} Bytes  sha384-{__import__('base64').b64encode(hashlib.sha384(data).digest()).decode()[:16]}…")
    cfg = CONFIG.read_text(encoding="utf-8")
    new = re.sub(r"USE_LOCAL_LIBS:\s*(true|false)", "USE_LOCAL_LIBS: true", cfg)
    CONFIG.write_text(new, encoding="utf-8")
    print("\nFertig. USE_LOCAL_LIBS ist jetzt true. Ordner public neu veröffentlichen.")
    print("Tipp: In public/datenschutz.html den Hinweis auf unpkg/jsDelivr streichen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
