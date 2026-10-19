"""Tests für scripts/import_osm.py und scripts/validate_data.py.

Das Fixture ist SYNTHETISCH (Namen beginnen mit „TEST“) und existiert nur, um Sonderfälle zu prüfen.
Es wird nie nach public/data geschrieben.

Start:  python3 -I -m unittest discover -s tests -v
"""
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


imp = load("import_osm")


def node(i, lat, lon, tags, ts="2025-03-04T10:00:00Z"):
    return {"type": "node", "id": i, "lat": lat, "lon": lon, "tags": tags, "timestamp": ts}


MAIN = [
    # 1: vollständig gepflegte Slipanlage
    node(1, 51.4800, 8.1200, {"leisure": "slipway", "name": "TEST Slip Nord", "access": "yes", "fee": "no", "surface": "concrete",
                              "motorboat": "yes", "website": "example.org/slip", "opening_hours": "24/7", "addr:city": "Testhausen"}),
    # 2+3: dieselbe Marina als Fläche (way, mit center) und als Punkt → zusammenführen
    {"type": "way", "id": 20, "center": {"lat": 51.4900, "lon": 8.1300}, "tags": {"leisure": "marina", "name": "TEST Marina", "capacity": "120 Plätze",
                                                                               "seamark:small_craft_facility:category": "visitor_berth;showers;electricity"}, "timestamp": "2024-01-01T00:00:00Z"},
    node(21, 51.4903, 8.1301, {"leisure": "marina", "name": "TEST Marina", "website": "https://marina.example"}),
    # 4: unbenannte Slipanlage direkt neben benannter → zusammenführen
    node(30, 51.4500, 8.0000, {"leisure": "slipway", "name": "TEST Slip Süd"}),
    node(31, 51.45001, 8.00001, {"leisure": "slipway", "access": "private"}),
    # 5: zwei verschieden benannte Slipanlagen dicht beieinander → NICHT zusammenführen
    node(40, 51.4000, 7.9000, {"leisure": "slipway", "name": "TEST Rampe A"}),
    node(41, 51.40005, 7.90005, {"leisure": "slipway", "name": "TEST Rampe B"}),
    # 6: außerhalb NRW → verwerfen
    node(50, 48.1, 11.5, {"leisure": "slipway", "name": "TEST München"}),
    # 7: stillgelegt → verwerfen
    node(60, 51.3, 7.8, {"leisure": "slipway", "name": "TEST stillgelegt", "disused": "yes"}),
    # 8: ohne Koordinaten → verwerfen
    {"type": "node", "id": 70, "tags": {"leisure": "slipway", "name": "TEST ohne Lage"}},
    # 9: Tankstelle: Diesel ja, Benzin eindeutig nein, ein unbekannter Wert
    node(80, 51.5000, 8.1400, {"waterway": "fuel", "name": "TEST Tanke", "fuel:diesel": "yes", "fuel:octane_95": "no", "payment:cash": "yes", "payment:visa": "yes"}),
    # 10: Tankstelle ohne jede Kraftstoffangabe → alles unbekannt
    node(81, 51.5100, 8.1500, {"waterway": "fuel", "name": "TEST Tanke 2"}),
    # 11: Irrelevantes Objekt
    node(90, 51.0, 7.0, {"amenity": "cafe", "name": "TEST Café"}),
    # 11b: uneindeutige Werte dürfen NIE zu „Nein“ werden
    node(110, 51.25, 7.25, {"leisure": "slipway", "name": "TEST uneindeutig", "fee": "donation", "motorboat": "limited", "access": "weird"}),
    # 12: gefährliche Website
    node(100, 51.2, 7.2, {"leisure": "slipway", "name": "TEST JS-Link", "website": "javascript:alert(1)"}),
]

PLACES = [
    {"type": "node", "id": 1000, "lat": 51.4850, "lon": 8.1250, "tags": {"place": "village", "name": "Testdorf"}},
    {"type": "node", "id": 1001, "lat": 51.4510, "lon": 8.0050, "tags": {"place": "town", "name": "Teststadt"}},
]

# Ein See (geschlossener Weg) um die Slipanlage 40/41 und ein Fluss in der Nähe von Slip 30
WATER = [
    {"type": "way", "id": 2000, "tags": {"natural": "water", "name": "TEST-See"},
     "geometry": [{"lat": 51.3990, "lon": 7.8990}, {"lat": 51.3990, "lon": 7.9010}, {"lat": 51.4010, "lon": 7.9010}, {"lat": 51.4010, "lon": 7.8990}, {"lat": 51.3990, "lon": 7.8990}]},
    {"type": "way", "id": 2001, "tags": {"waterway": "river", "name": "TEST-Fluss"},
     "geometry": [{"lat": 51.4499, "lon": 7.9990}, {"lat": 51.4499, "lon": 8.0010}]},
    {"type": "way", "id": 2002, "tags": {"waterway": "river", "name": "TEST-Weit-weg"},
     "geometry": [{"lat": 51.60, "lon": 8.4}, {"lat": 51.61, "lon": 8.4}]},
]


class ImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.built = imp.build(MAIN, PLACES, WATER, today="2026-01-02", log=lambda *a: None)
        cls.by = {k: {f["id"]: f for f in v} for k, v in cls.built["collections"].items()}

    def test_counts_and_rejections(self):
        s = self.built["stats"]["slip"]
        self.assertEqual(s["raw"], 10)              # 1, 30, 31, 40, 41, 50, 60, 70, 100, 110
        self.assertEqual(s["rejected"], 3)          # München (außerhalb), stillgelegt, ohne Koordinaten
        self.assertEqual(s["merged_duplicates"], 1) # 30 + 31
        self.assertEqual(s["final"], 6)             # 1, 30|31, 40, 41, 100, 110

    def test_javascript_url_is_dropped(self):
        f = self.by["slip"]["node/100"]
        self.assertIsNone(f["properties"]["website"])

    def test_outside_nrw_disused_and_missing_coords_rejected(self):
        ids = self.by["slip"]
        for bad in ("node/50", "node/60", "node/70"):
            self.assertNotIn(bad, ids)

    def test_unknown_is_not_no(self):
        a = self.by["fuel"]["node/81"]["properties"]["attrs"]
        self.assertIsNone(a["diesel"])
        self.assertIsNone(a["petrol"])
        b = self.by["fuel"]["node/80"]["properties"]["attrs"]
        self.assertIs(b["diesel"], True)
        self.assertIs(b["petrol"], False)                  # nur weil OSM es ausdrücklich verneint
        self.assertEqual(b["payment"], ["cash", "visa"])

    def test_ambiguous_values_stay_unknown(self):
        for v in ("donation", "limited", "maybe", "", "unknown", "customers"):
            self.assertIsNone(imp.tri(v), v)
        self.assertIsNone(imp.tri(None))
        p = self.by["slip"]["node/110"]["properties"]
        self.assertIsNone(p["fee"])
        self.assertIsNone(p["attrs"]["motorboat"])
        self.assertIsNone(p["access"])

    def test_fields_never_invented(self):
        p = self.by["slip"]["node/1"]["properties"]
        self.assertIs(p["fee"], False)
        self.assertEqual(p["access"], "public")
        self.assertIsNone(p["attrs"]["parking"])
        self.assertIsNone(p["attrs"]["trailer_parking"])
        self.assertEqual(p["website"], "https://example.org/slip")
        q = self.by["slip"]["node/40"]["properties"]
        self.assertIsNone(q["fee"])
        self.assertIsNone(q["access"])

    def test_marina_duplicates_merged_and_facilities_mapped(self):
        marinas = self.built["collections"]["marina"]
        self.assertEqual(len(marinas), 1)
        p = marinas[0]["properties"]
        self.assertEqual(p["attrs"]["berths"], 120)
        self.assertIs(p["attrs"]["visitor_berths"], True)
        self.assertIs(p["attrs"]["showers"], True)
        self.assertIs(p["attrs"]["electricity"], True)
        self.assertIsNone(p["attrs"]["toilets"])
        self.assertEqual(p["website"], "https://marina.example")  # aus dem Duplikat übernommen
        self.assertEqual(len(p["also_osm"]), 1)

    def test_unnamed_neighbour_merged_but_differently_named_kept(self):
        slips = self.by["slip"]
        self.assertTrue(("node/30" in slips) ^ ("node/31" in slips))
        survivor = slips.get("node/30") or slips.get("node/31")
        self.assertEqual(survivor["properties"]["name"], "TEST Slip Süd")
        self.assertIn("node/40", slips)
        self.assertIn("node/41", slips)

    def test_water_assignment(self):
        self.assertEqual(self.by["slip"]["node/40"]["properties"]["water"]["name"], "TEST-See")      # innerhalb des Rings
        w = self.by["slip"].get("node/30") or self.by["slip"].get("node/31")
        self.assertEqual(w["properties"]["water"]["name"], "TEST-Fluss")
        self.assertTrue(w["properties"]["water"]["approx"])
        self.assertIsNone(self.by["slip"]["node/1"]["properties"]["water"])                           # nichts in der Nähe

    def test_nearest_place_never_overrides_address(self):
        self.assertEqual(self.by["slip"]["node/1"]["properties"]["locality"], "Testhausen")
        self.assertEqual(self.by["slip"]["node/1"]["properties"]["locality_kind"], "address")
        m = self.built["collections"]["marina"][0]["properties"]
        self.assertEqual(m["locality"], "Testdorf")
        self.assertEqual(m["locality_kind"], "nearest")

    def test_timestamps_and_dates(self):
        p = self.by["slip"]["node/1"]["properties"]
        self.assertEqual(p["imported"], "2026-01-02")
        self.assertEqual(p["updated"], "2025-03-04")
        self.assertEqual(p["osm"]["timestamp"], "2025-03-04T10:00:00Z")

    def test_geojson_shape(self):
        f = self.by["slip"]["node/1"]
        self.assertEqual(f["geometry"], {"type": "Point", "coordinates": [8.12, 51.48]})  # [lon, lat]


class CliTests(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run([sys.executable, "-I", str(SCRIPTS / "import_osm.py"), *args], capture_output=True, text=True)

    def test_file_import_writes_valid_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            (tmp / "main.json").write_text(json.dumps({"osm3s": {"timestamp_osm_base": "2026-01-01T00:00:00Z"}, "elements": MAIN}))
            (tmp / "places.json").write_text(json.dumps({"elements": PLACES}))
            (tmp / "water.json").write_text(json.dumps({"elements": WATER}))
            out = tmp / "data"
            (out / "community").mkdir(parents=True)
            for n in ("places", "overrides", "prices"):
                (out / "community" / f"{n}.json").write_text("[]")
            r = self.run_cli("--input", str(tmp / "main.json"), "--places-input", str(tmp / "places.json"),
                             "--water-input", str(tmp / "water.json"), "--out", str(out))
            self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
            meta = json.loads((out / "meta.json").read_text())
            self.assertEqual(meta["osm_base_timestamp"], "2026-01-01T00:00:00Z")
            self.assertIsNone(meta["notice"])
            self.assertEqual(meta["total"], sum(c["final"] for c in meta["categories"].values()))
            v = subprocess.run([sys.executable, "-I", str(SCRIPTS / "validate_data.py"), "--data", str(out)], capture_output=True, text=True)
            self.assertEqual(v.returncode, 0, v.stdout)

    def test_data_loss_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            out = tmp / "data"
            (out / "osm").mkdir(parents=True)
            old = [{"type": "Feature", "id": f"node/{i}", "geometry": {"type": "Point", "coordinates": [7, 51]}, "properties": {}} for i in range(100)]
            (out / "osm" / "slip.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": old}))
            (tmp / "tiny.json").write_text(json.dumps({"elements": [MAIN[0]]}))
            r = self.run_cli("--input", str(tmp / "tiny.json"), "--out", str(out))
            self.assertEqual(r.returncode, 3, r.stderr)
            self.assertEqual(len(json.loads((out / "osm" / "slip.geojson").read_text())["features"]), 100)   # unverändert
            r = self.run_cli("--input", str(tmp / "tiny.json"), "--out", str(out), "--force")
            self.assertEqual(r.returncode, 0, r.stderr)

    def test_dry_run_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            (tmp / "main.json").write_text(json.dumps({"elements": MAIN}))
            out = tmp / "data"
            r = self.run_cli("--input", str(tmp / "main.json"), "--out", str(out), "--dry-run")
            self.assertEqual(r.returncode, 0)
            self.assertFalse(out.exists())


class ShippedDataTests(unittest.TestCase):
    def test_shipped_data_valid(self):
        v = subprocess.run([sys.executable, "-I", str(SCRIPTS / "validate_data.py")], capture_output=True, text=True)
        self.assertEqual(v.returncode, 0, v.stdout)


class ValidatorTests(unittest.TestCase):
    def test_catches_bad_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            (tmp / "osm").mkdir(); (tmp / "community").mkdir()
            bad = {"type": "FeatureCollection", "features": [
                {"type": "Feature", "id": "node/1", "geometry": {"type": "Point", "coordinates": [7, 51]},
                 "properties": {"type": "slip", "fee": "maybe", "access": "bogus", "website": "javascript:1", "attrs": {"motorboat": "yes"}, "osm": {"type": "node", "id": 1}}},
                {"type": "Feature", "id": "node/1", "geometry": {"type": "Point", "coordinates": [7, 99]},
                 "properties": {"type": "slip", "attrs": {}, "osm": {"type": "node", "id": 1}}}]}
            (tmp / "osm" / "slip.geojson").write_text(json.dumps(bad))
            for n in ("marina", "fuel"):
                (tmp / "osm" / f"{n}.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": []}))
            (tmp / "community" / "places.json").write_text("[]")
            (tmp / "community" / "overrides.json").write_text("[]")
            (tmp / "community" / "prices.json").write_text(json.dumps([{"station_id": "node/1", "fuel": "diesel", "price": 25.0, "observed": "2999-01-01", "status": "approved"}]))
            (tmp / "meta.json").write_text("{}")
            v = subprocess.run([sys.executable, "-I", str(SCRIPTS / "validate_data.py"), "--data", str(tmp)], capture_output=True, text=True)
            self.assertEqual(v.returncode, 1)
            for needle in ("ungültiger Zugang", "fee muss", "website", "attrs.motorboat", "doppelte id", "Preis außerhalb", "Zukunft"):
                self.assertIn(needle, v.stdout)


if __name__ == "__main__":
    unittest.main()
