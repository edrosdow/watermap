"""Tests für scripts/hafeninfo.py – ohne Netz und ohne KI-Aufruf (beides wird ersetzt)."""
import importlib.util
import io
import json
import pathlib
import tempfile
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("hafeninfo", ROOT / "scripts" / "hafeninfo.py")
hi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hi)

# Seite im Stil des Beispiels (Marina Eldenburg, Ausschnitt „Hafen“)
HAFEN_HTML = """<html><head><title>Hafen</title><script>var preis = "99,00 €";</script></head><body>
<nav><a href="/">Start</a> <a href="/boot-mieten/">Boot mieten</a> <a href="/hafen/preise/">Preise</a>
<a href="https://andere-seite.de/hafen">Fremd</a> <a href="/prospekt.pdf">Prospekt</a> <a href="mailto:x@y.de">Mail</a></nav>
<h3>Liegeplatz</h3><p>3,00&nbsp;€ / lfd. Meter / Tag (Berechnung mind. 7m) inkl. Strom</p>
<h3>Tankstelle - Wasser - Schmutzwasser</h3><p>Diesel nach Tagespreis<br>Benzin nach Tagespreis</p>
<p>0,50 € Frischwasser / 70L<br>15,00 € Fäkalienabsaugung pro Tank (bis 300L)</p>
<h3>Service</h3><p>WLAN –  kostenlos</p>
<h3>Parkplatz</h3><table><tr><td>5,00 €</td><td>für PKW / Tag</td></tr></table>
</body></html>"""


class TextTests(unittest.TestCase):
    def test_text_without_scripts_and_with_cells(self):
        text, links = hi.html_to_text(HAFEN_HTML)
        self.assertNotIn("99,00", text)                                  # Skript-Inhalt fällt weg
        self.assertIn("3,00 € / lfd. Meter / Tag (Berechnung mind. 7m) inkl. Strom", text)
        self.assertIn("5,00 €", text)
        self.assertIn(("/hafen/preise/", "Preise"), links)

    def test_candidate_links_same_site_and_relevant_first(self):
        _, links = hi.html_to_text(HAFEN_HTML)
        got = hi.candidate_links("https://www.marina-test.de/", links)
        self.assertEqual(got[0], "https://www.marina-test.de/hafen/preise/")   # „Preise“ zählt am meisten
        self.assertTrue(all(u.startswith("https://www.marina-test.de/") for u in got))
        self.assertFalse(any(u.endswith(".pdf") or "andere-seite" in u for u in got))


class VerifyTests(unittest.TestCase):
    def setUp(self):
        text, _ = hi.html_to_text(HAFEN_HTML)
        self.pages = [{"url": "https://www.marina-test.de/", "text": "Willkommen"}, {"url": "https://www.marina-test.de/hafen/preise/", "text": text}]

    def fact(self, **kw):
        base = {"key": "wasser", "value": "0,50 € pro 70 l", "price_eur": 0.5, "quote": "0,50 € Frischwasser / 70L", "page": 2}
        return {**base, **kw}

    def test_backed_fact_kept_with_source(self):
        facts, dropped = hi.verify([self.fact()], self.pages)
        self.assertEqual((len(facts), dropped), (1, 0))
        self.assertEqual(facts[0]["url"], "https://www.marina-test.de/hafen/preise/")

    def test_invented_quote_dropped(self):
        facts, dropped = hi.verify([self.fact(quote="0,50 € Frischwasser je 100 Liter")], self.pages)
        self.assertEqual((facts, dropped), ([], 1))

    def test_price_must_be_in_quote(self):
        facts, dropped = hi.verify([self.fact(price_eur=0.8)], self.pages)
        self.assertEqual((facts, dropped), ([], 1))

    def test_whitespace_nbsp_and_wrong_page_tolerated(self):
        q = "3,00 €  / lfd. Meter / Tag (Berechnung mind. 7m)"          # doppeltes Leerzeichen, normales statt geschütztes
        facts, _ = hi.verify([self.fact(key="gast_liegeplatz", value="3,00 € pro Meter und Tag", price_eur=3.0, quote=q, page=1)], self.pages)
        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0]["url"], self.pages[1]["url"])          # tatsächliche Fundstelle

    def test_unknown_key_and_duplicates(self):
        facts, dropped = hi.verify([self.fact(key="sauna"), self.fact(), self.fact()], self.pages)
        self.assertEqual((len(facts), dropped), (1, 1))

    def test_no_price_needs_no_price_check(self):
        facts, _ = hi.verify([self.fact(key="wlan", value="kostenlos", price_eur=None, quote="WLAN –  kostenlos")], self.pages)
        self.assertEqual(facts[0]["key"], "wlan")

    def test_sorted_by_schema_order(self):
        facts, _ = hi.verify([self.fact(key="wlan", value="kostenlos", price_eur=None, quote="WLAN – kostenlos"), self.fact()], self.pages)
        self.assertEqual([f["key"] for f in facts], ["wasser", "wlan"])

    def test_price_forms(self):
        for price, quote, want in ((3.0, "3,00 € / Tag", True), (3.0, "3,- € am Tag", True), (3.0, "für 3 € pro Tag", True),
                                   (3.0, "30 € pro Woche", False), (0.5, "0,50 € je 70 l", True), (0.5, "0,5 €", True),
                                   (15.0, "15,00 € Absaugung", True), (12.5, "12,50 €", True), (12.5, "12 €", False)):
            self.assertEqual(hi._price_in(price, quote), want, (price, quote))


class RuleTests(unittest.TestCase):
    def lines(self, text):
        return [(f["key"], f["value"], f["price_eur"]) for f in hi.extract_rules([{"url": "u", "text": text}])]

    def test_example_price_list(self):
        text, _ = hi.html_to_text(HAFEN_HTML)
        got = self.lines(text)
        self.assertIn(("gast_liegeplatz", "3,00 € / lfd. Meter / Tag (Berechnung mind. 7m) inkl. Strom", 3.0), got)
        self.assertIn(("faekalien", "15,00 € Fäkalienabsaugung pro Tank (bis 300L)", 15.0), got)
        self.assertIn(("diesel", "Diesel nach Tagespreis", None), got)
        self.assertIn(("parken", "5,00 € für PKW / Tag", 5.0), got)        # Tabellenzeile bleibt eine Angabe
        self.assertFalse(any(v.startswith("Tankstelle - Wasser") for _, v, _ in got))   # Überschrift ist keine Angabe

    def test_heading_passes_key_to_bare_price_lines(self):
        got = self.lines("Liegegebühren\nBoote bis 8 m: 15,00 € / Nacht\nBoote über 8 m: 20,00 € / Nacht\nParken\n4,00 € pro Tag")
        self.assertEqual([(k, p) for k, _, p in got], [("gast_liegeplatz", 15.0), ("gast_liegeplatz", 20.0), ("parken", 4.0)])

    def test_offtopic_and_prose_ignored(self):
        got = self.lines("Ferienwohnung mit Strom und WLAN: 89,00 € pro Nacht\n"
                         + "Unser Hafen bietet seit vielen Jahren einen schönen Blick über den See, Strom gibt es an jedem Steg und vieles mehr, was das Herz begehrt." )
        self.assertEqual(got, [])

    def test_first_price(self):
        for s, want in (("3,00 €", 3.0), ("1.200,00 €", 1200.0), ("1.200 €", 1200.0), ("€ 12", 12.0), ("5 EUR", 5.0),
                        ("3,- €", 3.0), ("12.50 €", 12.5), ("ohne Preis", None)):
            self.assertEqual(hi.first_price(s), want, s)


class FakeResp(io.BytesIO):
    def __init__(self, url, body, ctype="text/html; charset=utf-8"):
        super().__init__(body.encode("utf-8"))
        self.url = url
        self.headers = types.SimpleNamespace(get=lambda k, d=None: ctype if k == "Content-Type" else d,
                                             get_content_charset=lambda: "utf-8")
    def geturl(self): return self.url
    def __enter__(self): return self
    def __exit__(self, *a): return False


def opener(sites):
    calls = []
    def open_(req):
        calls.append(req.full_url)
        body = sites.get(req.full_url)
        if body is None:
            raise hi.urllib.error.HTTPError(req.full_url, 404, "nicht da", None, None)
        return FakeResp(req.full_url, body, "text/plain" if req.full_url.endswith("robots.txt") else "text/html; charset=utf-8")
    return open_, calls


class FetchTests(unittest.TestCase):
    def test_site_follows_relevant_links_and_respects_robots(self):
        sites = {
            "https://www.marina-test.de/": HAFEN_HTML,
            "https://www.marina-test.de/hafen/preise/": "<p>Gastliegeplatz 2,50 € pro Meter</p>",
            "https://www.marina-test.de/robots.txt": "User-agent: *\nDisallow: /boot-mieten/\n",
        }
        open_, calls = opener(sites)
        pages = hi.Fetcher(opener=open_, pause=0, log=lambda *a: None).site("https://www.marina-test.de/")
        self.assertEqual([p["url"] for p in pages], ["https://www.marina-test.de/", "https://www.marina-test.de/hafen/preise/"])
        self.assertNotIn("https://www.marina-test.de/boot-mieten/", calls)    # robots.txt verbietet es

    def test_unreachable_site_gives_no_pages(self):
        open_, _ = opener({})
        self.assertEqual(hi.Fetcher(opener=open_, pause=0, log=lambda *a: None).site("https://weg.example/"), [])


class FakeBatches:
    def __init__(self, answer):
        self.answer, self.created = answer, []
    def create(self, requests):
        self.created.append(requests)
        return types.SimpleNamespace(id="batch_1", processing_status="in_progress")
    def retrieve(self, _id):
        return types.SimpleNamespace(id="batch_1", processing_status="ended", request_counts=types.SimpleNamespace(processing=0, succeeded=1))
    def cancel(self, _id): pass
    def results(self, _id):
        for req in self.created[-1]:
            msg = types.SimpleNamespace(stop_reason="end_turn", content=[types.SimpleNamespace(type="text", text=json.dumps(self.answer))])
            yield types.SimpleNamespace(custom_id=req["custom_id"], result=types.SimpleNamespace(type="succeeded", message=msg))


class MainTests(unittest.TestCase):
    def test_end_to_end_writes_only_backed_facts_and_skips_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = pathlib.Path(tmp)
            (data / "osm").mkdir()
            marina = {"type": "Feature", "id": "node/1", "geometry": {"type": "Point", "coordinates": [12.7, 53.5]},
                      "properties": {"name": "Marina Test", "website": "https://www.marina-test.de/"}}
            (data / "osm" / "marina.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [marina]}))
            (data / "meta.json").write_text(json.dumps({"files": {"osm": []}}))
            open_, _ = opener({"https://www.marina-test.de/": HAFEN_HTML})
            answer = {"facts": [
                {"key": "faekalien", "value": "15,00 € pro Tank (bis 300 l)", "price_eur": 15.0, "quote": "15,00 € Fäkalienabsaugung pro Tank (bis 300L)", "page": 1},
                {"key": "duschen", "value": "Duschen 1 € pro 4 Minuten", "price_eur": 1.0, "quote": "Duschmarke 1 € für 4 Minuten", "page": 1},
            ]}
            batches = FakeBatches(answer)
            client = types.SimpleNamespace(messages=types.SimpleNamespace(batches=batches))
            fetcher = hi.Fetcher(opener=open_, pause=0, log=lambda *a: None)
            self.assertEqual(hi.main(["--data", str(data), "--ki"], client=client, fetcher=fetcher), 0)
            doc = json.loads((data / "hafeninfo.json").read_text())
            place = doc["places"]["node/1"]
            self.assertEqual([f["key"] for f in place["facts"]], ["faekalien"])    # Duschen: Zitat steht nirgends
            self.assertEqual(place["status"], "ok")
            self.assertEqual(json.loads((data / "meta.json").read_text())["files"]["hafeninfo"], "hafeninfo.json")
            req = batches.created[0][0]["params"]
            self.assertEqual(req["model"], "claude-opus-5-5")
            self.assertEqual(req["output_config"]["format"]["type"], "json_schema")
            # Zweiter Lauf (z. B. --only): Seite unverändert → keine neue Anfrage
            self.assertEqual(hi.main(["--data", str(data), "--ki", "--only", "node/1"], client=client, fetcher=fetcher), 0)
            self.assertEqual(len(batches.created), 1)

    def test_refusal_or_bad_json_is_not_used(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = pathlib.Path(tmp)
            (data / "osm").mkdir()
            marina = {"type": "Feature", "id": "node/2", "geometry": {"type": "Point", "coordinates": [7, 51]},
                      "properties": {"name": "M", "website": "https://www.marina-test.de/"}}
            (data / "osm" / "marina.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [marina]}))
            open_, _ = opener({"https://www.marina-test.de/": HAFEN_HTML})
            batches = FakeBatches({})
            def results(_id):
                for req in batches.created[-1]:
                    msg = types.SimpleNamespace(stop_reason="refusal", content=[])
                    yield types.SimpleNamespace(custom_id=req["custom_id"], result=types.SimpleNamespace(type="succeeded", message=msg))
            batches.results = results
            client = types.SimpleNamespace(messages=types.SimpleNamespace(batches=batches))
            hi.main(["--data", str(data), "--ki"], client=client, fetcher=hi.Fetcher(opener=open_, pause=0, log=lambda *a: None))
            place = json.loads((data / "hafeninfo.json").read_text())["places"]["node/2"]
            self.assertTrue(place["status"].startswith("fehler"))
            self.assertNotIn("facts", place)

    def test_free_mode_needs_no_client_and_finds_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = pathlib.Path(tmp)
            (data / "osm").mkdir()
            marina = {"type": "Feature", "id": "node/3", "geometry": {"type": "Point", "coordinates": [12.7, 53.5]},
                      "properties": {"name": "Marina Test", "website": "https://www.marina-test.de/"}}
            (data / "osm" / "marina.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [marina]}))
            open_, _ = opener({"https://www.marina-test.de/": HAFEN_HTML})
            boom = types.SimpleNamespace(messages=None)          # würde bei jedem KI-Aufruf scheitern
            self.assertEqual(hi.main(["--data", str(data)], client=boom, fetcher=hi.Fetcher(opener=open_, pause=0, log=lambda *a: None)), 0)
            doc = json.loads((data / "hafeninfo.json").read_text())
            place = doc["places"]["node/3"]
            self.assertEqual((doc["method"], place["method"]), ("regeln", "regeln"))
            got = {f["key"]: f["value"] for f in place["facts"]}
            self.assertEqual(got["wasser"], "0,50 € Frischwasser / 70L")
            self.assertEqual(got["parken"], "5,00 € für PKW / Tag")
            self.assertIn("diesel", got)
            self.assertIn("wlan", got)

    def test_schema_keys_match_app(self):
        js = (ROOT / "public" / "js" / "hafeninfo.js").read_text(encoding="utf-8")
        for key in hi.FACTS:
            self.assertIn(f"{key}:", js, key)


if __name__ == "__main__":
    unittest.main()
