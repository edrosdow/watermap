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
from unittest import mock

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
        cls.built = imp.build(MAIN, PLACES, WATER, today="2026-01-02", bbox=imp.NRW_BBOX, log=lambda *a: None)
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


class RegionTests(unittest.TestCase):
    def test_expand_areas(self):
        self.assertEqual(len(imp.expand_areas("DE")), 16)
        self.assertEqual(imp.expand_areas("de-nw, DE-NI,DE-NW"), ["DE-NW", "DE-NI"])
        self.assertEqual(imp.expand_areas("DE-NW,DE")[0], "DE-NW")
        self.assertEqual(len(imp.expand_areas("DE-NW,DE")), 16)     # keine Doppelten
        for bad in ("", " , ", "Deutschland", "DE-", 'DE"];out;'):
            with self.assertRaises(ValueError, msg=bad):
                imp.expand_areas(bad)

    def test_area_clause_state_vs_country(self):
        self.assertIn('"ISO3166-2"="DE-NW"', imp.area_clause("DE-NW"))
        self.assertIn('"ISO3166-1"="AT"', imp.area_clause("AT"))

    def test_bbox(self):
        self.assertEqual(imp.default_bbox(["DE-BY", "DE-NW"]), imp.GERMANY_BBOX)
        self.assertIsNone(imp.default_bbox(["AT"]))
        self.assertEqual(imp.parse_bbox("46.3, 9.5,49.1,17.2"), (46.3, 9.5, 49.1, 17.2))
        for bad in ("1,2,3", "a,b,c,d", "50,5,40,9", "95,5,96,9"):
            with self.assertRaises(ValueError, msg=bad):
                imp.parse_bbox(bad)

    def test_bavaria_accepted_with_germany_bbox_rejected_with_nrw(self):
        el = [node(50, 48.1, 11.5, {"leisure": "slipway", "name": "TEST München"})]
        quiet = lambda *a: None
        self.assertEqual(imp.build(el, bbox=imp.GERMANY_BBOX, log=quiet)["stats"]["slip"]["final"], 1)
        self.assertEqual(imp.build(el, bbox=imp.NRW_BBOX, log=quiet)["stats"]["slip"]["final"], 0)

    def test_merge_elements_dedupes_border_objects(self):
        a = [{"type": "node", "id": 1}, {"type": "way", "id": 1}]
        b = [{"type": "node", "id": 1}, {"type": "node", "id": 2}]
        self.assertEqual([(e["type"], e["id"]) for e in imp.merge_elements([a, b])],
                         [("node", 1), ("way", 1), ("node", 2)])

    @staticmethod
    def fake(fail=()):
        calls = []

        def fetch(query):
            calls.append(query)
            for needle in fail:
                if needle in query:
                    raise imp.FetchError("simuliert")
            which = ("main" if "out meta center" in query else "extras" if "out tags center" in query
                     else "places" if "place" in query else "water")
            region = "NW" if "DE-NW" in query else "NI"
            ident = {"main": 1, "places": 100, "water": 200, "extras": 300}[which]
            el = {"type": "node" if which != "water" else "way", "id": ident + (0 if region == "NW" else 1),
                  "lat": 51.0, "lon": 7.0, "tags": {"leisure": "slipway"}}
            if ident == 1 and region == "NI":
                el["id"] = 1    # Randobjekt, kommt in beiden Regionen vor
            return {"osm3s": {"timestamp_osm_base": "2026-02-01T00:00:00Z" if region == "NW" else "2026-01-01T00:00:00Z"},
                    "elements": [el]}
        return fetch, calls

    def test_fetch_regions_merges_and_reports(self):
        fetch, calls = self.fake()
        got = imp.fetch_regions(["DE-NW", "DE-NI"], fetch=fetch, pause=0, log=lambda *a: None)
        self.assertEqual(len(calls), 12)                                 # 2 Regionen × (Standorte, Orte, Gewässer, 3 × Extras)
        self.assertEqual(len(got["main"]["elements"]), 1)                # Randobjekt nur einmal
        self.assertEqual(len(got["places"]), 2)
        self.assertEqual(len(got["extras"]), 2)                          # drei Teilabfragen, gleiche Objekte nur einmal
        self.assertEqual(got["main"]["osm3s"]["timestamp_osm_base"], "2026-01-01T00:00:00Z")   # älterer Stand
        self.assertEqual(got["enrich"], {"places": "ok", "water": "ok", "extras": "ok"})

    def test_main_failure_in_one_region_aborts_everything(self):
        fetch, calls = self.fake(fail=('"DE-NI"',))
        with self.assertRaises(imp.FetchError) as ctx:
            imp.fetch_regions(["DE-NW", "DE-NI"], fetch=fetch, pause=0, retry_wait=0, log=lambda *a: None)
        self.assertIn("DE-NI", str(ctx.exception))
        self.assertEqual(sum('"DE-NI"' in q for q in calls), 2)              # eine zweite Runde, dann Abbruch

    def test_main_failure_recovers_in_second_round(self):
        base, calls = self.fake()
        failed = []

        def fetch(q):
            if '"DE-NI"' in q and "out meta center" in q and not failed:
                failed.append(q)
                raise imp.FetchError("simuliert")
            return base(q)
        got = imp.fetch_regions(["DE-NW", "DE-NI"], fetch=fetch, pause=0, retry_wait=0, log=lambda *a: None)
        self.assertEqual(len(failed), 1)
        self.assertEqual(got["enrich"], {"places": "ok", "water": "ok", "extras": "ok"})

    def test_enrichment_failure_is_partial_not_fatal(self):
        def fetch(query, _f=self.fake()[0]):
            if "DE-NI" in query and "out meta center" not in query:
                raise imp.FetchError("simuliert")
            return _f(query)
        got = imp.fetch_regions(["DE-NW", "DE-NI"], fetch=fetch, pause=0, log=lambda *a: None)
        self.assertEqual(got["enrich"]["places"], "teilweise (ohne: DE-NI)")
        self.assertEqual(got["enrich"]["water"], "teilweise (ohne: DE-NI)")
        self.assertEqual(got["enrich"]["extras"], "teilweise (ohne: DE-NI)")
        self.assertEqual(len(got["places"]), 1)

    def test_budget_skips_enrichment_but_never_locations(self):
        fetch, calls = self.fake()
        # Budget (500) wird erst nach der ersten Region überschritten: Region 1 mit Zugaben, Region 2 ohne
        clock = iter([0, 0, 0, 0, 0, 0, 0, 1000, 1000, 1000, 1000, 1000, 1000]).__next__
        got = imp.fetch_regions(["DE-NW", "DE-NI"], fetch=fetch, pause=0, log=lambda *a: None, deadline=500, clock=clock)
        self.assertEqual(sum("out meta center" in q for q in calls), 2)       # beide Regionen: Standorte vollständig
        self.assertEqual(len(calls), 7)                                       # 2 × Standorte + 5 Zugaben (nur NW)
        self.assertEqual(got["enrich"], {k: "teilweise (ohne: DE-NI)" for k in ("places", "water", "extras")})

    def test_budget_already_spent_gives_failed_status(self):
        fetch, calls = self.fake()
        got = imp.fetch_regions(["DE-NW"], fetch=fetch, pause=0, log=lambda *a: None, deadline=-1)
        self.assertEqual(len(calls), 1)
        self.assertIsNone(got["places"])
        self.assertEqual(got["enrich"], {"places": "fehlgeschlagen", "water": "fehlgeschlagen", "extras": "fehlgeschlagen"})

    def test_enrichment_uses_its_own_fetcher(self):
        main_calls, extra_calls = [], []
        base, _ = self.fake()

        def fetch(q):
            main_calls.append(q)
            return base(q)

        def fetch_enrich(q):
            extra_calls.append(q)
            return base(q)
        imp.fetch_regions(["DE-NW"], fetch=fetch, fetch_enrich=fetch_enrich, pause=0, log=lambda *a: None)
        self.assertEqual((len(main_calls), len(extra_calls)), (1, 5))

    @staticmethod
    def answers(*payloads):
        """Ersetzt urlopen: liefert der Reihe nach die angegebenen Antworten."""
        it = iter(payloads)

        def urlopen(req, timeout=None):
            resp = mock.MagicMock()
            resp.__enter__.return_value.read.return_value = json.dumps(next(it)).encode()
            return resp
        return urlopen

    def test_empty_answer_tries_next_server(self):
        # DE-BE kam im Oktober-Lauf von einem Server leer zurück – das darf nicht als „keine Standorte“ gelten
        full = {"elements": [{"type": "node", "id": 1}]}
        with mock.patch.object(imp.urllib.request, "urlopen", self.answers({"elements": []}, full)), \
                mock.patch.object(imp.time, "sleep"):
            got = imp.overpass("q", log=lambda *a: None, servers=["https://a.example/api", "https://b.example/api"], attempts=1, allow_empty=False)
        self.assertEqual(got, full)

    def test_empty_answer_everywhere_aborts(self):
        with mock.patch.object(imp.urllib.request, "urlopen", self.answers({"elements": []}, {"elements": []})), \
                mock.patch.object(imp.time, "sleep"):
            with self.assertRaises(imp.FetchError):
                imp.overpass("q", log=lambda *a: None, servers=["https://a.example/api", "https://b.example/api"], attempts=1, allow_empty=False)

    def test_empty_answer_allowed_by_default(self):
        with mock.patch.object(imp.urllib.request, "urlopen", self.answers({"elements": []})), \
                mock.patch.object(imp.time, "sleep"):
            self.assertEqual(imp.overpass("q", log=lambda *a: None, servers=["https://a.example/api"], attempts=1), {"elements": []})

    def test_no_enrich_skips_extra_queries(self):
        fetch, calls = self.fake()
        got = imp.fetch_regions(["DE-NW", "DE-NI"], enrich=False, fetch=fetch, pause=0, log=lambda *a: None)
        self.assertEqual(len(calls), 2)
        self.assertEqual(got["enrich"], {"places": "übersprungen", "water": "übersprungen", "extras": "übersprungen"})
        self.assertIsNone(got["places"])
        self.assertIsNone(got["extras"])


EXTRAS = [
    {"type": "way", "id": 501, "center": {"lat": 51.40, "lon": 7.10}, "tags": {"waterway": "canal", "lock": "yes", "lock_name": "Schleuse Test", "lock_ref": "S 1", "maxlength": "110 m", "maxwidth": "12,0", "vhf": "20"}},
    node(502, 51.41, 7.11, {"seamark:type": "bridge", "seamark:bridge:clearance_height": "4.5", "seamark:bridge:clearance_height_closed": "3,2 m", "seamark:bridge:category": "lifting", "name": "Hubbrücke"}),
    node(503, 51.42, 7.12, {"waterway": "weir", "name": "Wehr Test"}),
    node(504, 51.43, 7.13, {"canoe": "put_in;egress", "tourism": "camp_site", "name": "Kanu-Rast"}),
    node(505, 51.44, 7.14, {"amenity": "boat_rental", "name": "Verleih", "opening_hours": "Mo-Su 10:00-18:00", "website": "javascript:alert(1)"}),
    node(506, 51.45, 7.15, {"amenity": "toilets", "fee": "no", "wheelchair": "yes"}),
    node(507, 51.46, 7.16, {"amenity": "toilets", "access": "customers"}),                       # nicht öffentlich → weg
    node(508, 51.47, 7.17, {"amenity": "water_point", "drinking_water": "no"}),
    node(509, 51.48, 7.18, {"amenity": "drinking_water"}),
    {"type": "way", "id": 510, "center": {"lat": 51.49, "lon": 7.19}, "tags": {"amenity": "parking", "capacity": "40", "trailer": "yes", "fee": "yes"}},
    node(511, 51.50, 7.20, {"amenity": "parking", "access": "private"}),                         # privat → weg
    node(512, 51.51, 7.21, {"amenity": "biergarten", "name": "Am Steg", "cuisine": "german"}),
    node(513, 51.52, 7.22, {"shop": "kiosk"}),
    node(514, 51.53, 7.23, {"tourism": "picnic_site"}),
    node(515, 51.54, 7.24, {"amenity": "toilets", "disused": "yes"}),                            # stillgelegt → weg
    node(516, 51.55, 7.25, {"amenity": "bench"}),                                                # keine Art → weg
    node(506, 51.45, 7.15, {"amenity": "toilets"}),                                              # doppelt → einmal
]


class ExtrasTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.feats, cls.counts = imp.build_extras(EXTRAS, log=lambda *a: None)
        cls.by = {f["id"]: f["properties"] for f in cls.feats}

    def test_counts(self):
        self.assertEqual(self.counts, {"lock": 1, "bridge": 1, "weir": 1, "canoe": 1, "rental": 1, "toilets": 1,
                                       "water": 2, "food": 2, "rest": 1, "parking": 1})

    def test_non_public_disused_and_unknown_dropped(self):
        for fid in ("node/507", "node/511", "node/515", "node/516"):
            self.assertNotIn(fid, self.by)

    def test_lock_and_bridge_values(self):
        lock = self.by["way/501"]
        self.assertEqual((lock["name"], lock["attrs"]["ref"], lock["attrs"]["length"], lock["attrs"]["width"], lock["attrs"]["vhf"]),
                         ("Schleuse Test", "S 1", 110.0, 12.0, "20"))
        br = self.by["node/502"]["attrs"]
        self.assertEqual((br["clearance"], br["clearance_closed"], br["category"]), (4.5, 3.2, "lifting"))

    def test_canoe_beats_camp_site(self):
        self.assertEqual(self.by["node/504"]["kind"], "canoe")
        self.assertEqual(self.by["node/504"]["attrs"], {"put_in": True, "egress": True})

    def test_water_point_not_drinkable_is_said(self):
        self.assertFalse(self.by["node/508"]["attrs"]["drinkable"])
        self.assertTrue(self.by["node/509"]["attrs"]["drinkable"])

    def test_unknown_stays_unknown_and_bad_url_dropped(self):
        self.assertNotIn("website", self.by["node/505"])
        self.assertNotIn("fee", self.by["node/509"])                    # nicht angegeben ≠ kostenlos
        self.assertIs(self.by["node/506"]["fee"], False)

    def test_weirs_only_near_locations(self):
        far = node(601, 51.43 + 0.02, 7.12, {"waterway": "weir"})            # ≈ 2,2 km nördlich
        near = node(602, 51.43 + 0.005, 7.12, {"waterway": "weir"})          # ≈ 560 m
        feats, counts = imp.build_extras([far, near, EXTRAS[0]], log=lambda *a: None, anchors=[(51.43, 7.12)])
        self.assertEqual({f["id"] for f in feats}, {"node/602", "way/501"})  # andere Arten bleiben unberührt
        self.assertEqual(counts["weir"], 1)

    def test_near_any_across_cells_and_longitude(self):
        test = imp.near_any([(51.0, 7.0)], 1000)
        self.assertTrue(test(51.0, 7.0135))      # ≈ 945 m östlich
        self.assertFalse(test(51.0, 7.0150))     # ≈ 1050 m östlich
        self.assertTrue(test(51.0089, 7.0))      # ≈ 990 m nördlich

    def test_parse_meters(self):
        for raw, want in (("4.5", 4.5), ("4,5 m", 4.5), ("4.5m", 4.5), ("ca. 4", None), ("0", None), ("", None), (None, None), ("150", None)):
            self.assertEqual(imp.parse_meters(raw), want, raw)
        self.assertEqual(imp.parse_meters("190 m", max_m=500), 190.0)       # Schleusenkammern sind länger als 100 m

    def test_queries_split_in_three(self):
        q = imp.queries("DE-NW")
        self.assertIn('"lock"="yes"', q["extras_infra"])
        self.assertIn("clearance_height", q["extras_infra"])
        self.assertIn('"amenity"="boat_rental"', q["extras_infra"])
        self.assertNotIn("around", q["extras_infra"])                         # nur Tag-Filter: schnell
        self.assertIn(f'"amenity"="toilets"](around.n:{imp.EXTRA_AROUND_M})', q["extras_near"])
        self.assertIn('"waterway"="weir"](area.a)', q["extras_weir"])
        self.assertNotIn("around", q["extras_weir"])                          # Umkreis prüft der Importer selbst
        self.assertIn(f'"amenity"="parking"](around.n:{imp.EXTRA_AROUND_DENSE_M})', q["extras_near"])
        for k in imp.EXTRA_ADDONS:
            self.assertIn("out tags center", q[k])

    def test_partial_extras_status(self):
        self.assertEqual(imp.combine_status({"extras_infra": "ok", "extras_near": "ok", "extras_weir": "ok"}), "ok")
        self.assertEqual(imp.combine_status({"extras_infra": "ok", "extras_near": "teilweise (ohne: DE-NW)", "extras_weir": "ok"}),
                         "teilweise (Service: teilweise (ohne: DE-NW))")


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

    def test_extras_written_and_kept_when_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            (tmp / "main.json").write_text(json.dumps({"elements": MAIN}))
            (tmp / "extras.json").write_text(json.dumps({"elements": EXTRAS}))
            out = tmp / "data"
            r = self.run_cli("--input", str(tmp / "main.json"), "--extras-input", str(tmp / "extras.json"), "--out", str(out))
            self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
            meta = json.loads((out / "meta.json").read_text())
            self.assertEqual(meta["files"]["extras"], "osm/extras.geojson")
            self.assertEqual(meta["extras"]["total"], 11)                    # 12 minus das Wehr ohne Standort im Umkreis
            self.assertEqual(meta["extras"]["counts"]["weir"], 0)
            self.assertEqual(len(json.loads((out / "osm" / "extras.geojson").read_text())["features"]), 11)
            # Lauf ohne Extras: Datei und Verweis bleiben
            r = self.run_cli("--input", str(tmp / "main.json"), "--out", str(out))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(len(json.loads((out / "osm" / "extras.geojson").read_text())["features"]), 11)
            self.assertEqual(json.loads((out / "meta.json").read_text())["files"]["extras"], "osm/extras.geojson")

    def test_extras_collapse_keeps_old_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            out = tmp / "data"
            (out / "osm").mkdir(parents=True)
            old = [{"type": "Feature", "id": f"node/{i}", "geometry": {"type": "Point", "coordinates": [7, 51]}, "properties": {"kind": "toilets"}} for i in range(100)]
            (out / "osm" / "extras.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": old}))
            (tmp / "main.json").write_text(json.dumps({"elements": MAIN}))
            (tmp / "extras.json").write_text(json.dumps({"elements": EXTRAS[:2]}))
            r = self.run_cli("--input", str(tmp / "main.json"), "--extras-input", str(tmp / "extras.json"), "--out", str(out))
            self.assertEqual(r.returncode, 0, r.stderr)                      # kein Abbruch – Extras sind eine Zugabe
            self.assertEqual(len(json.loads((out / "osm" / "extras.geojson").read_text())["features"]), 100)
            self.assertIn("Einbruch", json.loads((out / "meta.json").read_text())["enrichment"]["extras"])

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

    def test_foreign_area_needs_bbox(self):
        r = self.run_cli("--area", "AT", "--dry-run")
        self.assertEqual(r.returncode, 2)
        self.assertIn("--bbox", r.stderr)
        r = self.run_cli("--area", "Deutschland", "--dry-run")
        self.assertEqual(r.returncode, 2)

    def test_dry_run_reports_loss_but_does_not_fail(self):
        # Probelauf für ein Bundesland gegen Deutschland-Daten: Hinweis statt Abbruch
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            out = tmp / "data"
            (out / "osm").mkdir(parents=True)
            old = [{"type": "Feature", "id": f"node/{i}", "geometry": {"type": "Point", "coordinates": [7, 51]}, "properties": {}} for i in range(100)]
            (out / "osm" / "slip.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": old}))
            (tmp / "tiny.json").write_text(json.dumps({"elements": [MAIN[0]]}))
            r = self.run_cli("--input", str(tmp / "tiny.json"), "--out", str(out), "--dry-run")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("würde abbrechen", r.stdout)
            self.assertEqual(len(json.loads((out / "osm" / "slip.geojson").read_text())["features"]), 100)

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
