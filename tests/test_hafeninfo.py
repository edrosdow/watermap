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

    def test_price_in_next_table_cell_is_joined_and_addresses_skipped(self):
        text = "Preise\nGastlieger bis 6 m\n15,00 €\nGastlieger bis 8 m\n18,00 €\nStromer Landstraße 53a, 28197 Bremen\nStrom 0,50 €/kWh"
        pages = [{"url": "https://x.de/preise", "text": text}]
        got = hi.extract_rules(pages)
        self.assertEqual([(f["key"], f["value"], f["price_eur"]) for f in got],
                         [("gast_liegeplatz", "Gastlieger bis 6 m 15,00 €", 15.0), ("gast_liegeplatz", "Gastlieger bis 8 m 18,00 €", 18.0),
                          ("strom", "Strom 0,50 €/kWh", 0.5)])
        self.assertEqual(hi.verify(got, pages)[1], 0)                        # Zitat über zwei Zeilen ist belegt
        got = hi.extract_rules([{"url": "u", "text": "Gastlieger bis 6 m\n15,00 € | 90,00 €\nGastlieger bis 8 m\nauf Anfrage"}])
        self.assertEqual([(f["value"], f["price_eur"]) for f in got], [("Gastlieger bis 6 m 15,00 € 90,00 €", 15.0), ("Gastlieger bis 8 m", None)])

    def test_form_boxes_and_dot_leaders_are_removed_but_quote_stays_verbatim(self):
        text = ("Sommerliegeplatz 01.04. - 31.10. Ja: ( ) Nein: ( )\n"
                "Stromanschluss: 3,70 € Grundgebühr pro Monat Ja: ( ) Nein: ( )\n"
                "Trailer-Parkplatz bis 7 m ..........................4,00 €")
        got = hi.extract_rules([{"url": "https://x.de/preise.pdf", "text": text}])
        self.assertEqual([(f["key"], f["value"]) for f in got],
                         [("strom", "Stromanschluss: 3,70 € Grundgebühr pro Monat"), ("parken", "Trailer-Parkplatz bis 7 m 4,00 €")])
        self.assertTrue(got[1]["quote"].endswith("....4,00 €"))          # Zitat bleibt wörtlich (Prüfung gegen die Seite)
        facts, dropped = hi.verify(got, [{"url": "https://x.de/preise.pdf", "text": text}])
        self.assertEqual((len(facts), dropped), (2, 0))

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

    def test_junk_from_trial_run_rejected(self):
        # Zeilen aus dem ersten Probelauf, die keine Hafenangaben sind
        got = self.lines("555.509 kWh\nReparatur Slipanlage 2011\n1. Hafenmeister\nKranen Herbst 2026\nTelefon Restaurant: 030 / 809 436 71")
        self.assertEqual([k for k, *_ in got], ["restaurant"])          # Telefonnummer ist eine echte Angabe

    def test_useful_lines_from_trial_run_kept(self):
        got = self.lines("Wassertiefe an einzelnen Stegen bis ca. 2, 20 m\n"
                         "zu jedem Liegeplatz gehört ein mit 16 Ampère abgesicherter Stromanschluss\n"
                         "Hafenmeister NPorts Herr Bröcker: 0171-7325304")
        self.assertEqual([k for k, *_ in got], ["wassertiefe", "strom", "hafenmeister"])

    def test_findings_from_trial_run_3(self):
        # Bootsmiete unter der Überschrift „Hund“ (Sport-Boot-Center) – keine Hafenangabe
        self.assertEqual(self.lines("Kaution 30,- € (Hund auf Anfrage)\n120,- €/bis 3 Stunden*\njede weitere Stunde 35,- €*"), [])
        # Preisliste ohne Stichwort je Zeile (Labussee): Überschrift wird mitgenannt
        got = self.lines("Strom\n0,70 €\nDuschen\n1,00 €")
        self.assertEqual(got, [("strom", "Strom 0,70 €", 0.7), ("duschen", "Duschen 1,00 €", 1.0)])   # Preis direkt darunter gehört dazu
        # Überschrift wirkt nur auf die nächsten Zeilen
        self.assertEqual(self.lines("Strom\n" + "Text ohne Angabe\n" * 9 + "4,00 €"), [])

    def test_rental_price_list_page_skipped(self):
        page = {"url": "https://m.de/preise.pdf", "text": "Charter 2026\nReisezeit A B C\nKaution 500 €\nEndreinigung 80 €\n"
                "Bettwäsche 15 €\ninkl. W-LAN\nDuschen 50,- €"}
        self.assertEqual(hi.extract_rules([page]), [])

    def test_pdf_continuation_fragment_skipped(self):
        page = {"url": "https://m.de/ordnung.pdf", "text": "aktuellem Strompreis inklusive Umsatzsteuer spätestens 5 €\nStrom 0,45 € je kWh"}
        self.assertEqual([f["value"] for f in hi.extract_rules([page])], ["Strom 0,45 € je kWh"])

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

    def test_links_with_spaces_are_encoded_and_bad_urls_do_not_crash(self):
        self.assertEqual(hi.safe_url("https://v.de/ueber uns/kontaktformular"), "https://v.de/ueber%20uns/kontaktformular")
        self.assertEqual(hi.safe_url("https://v.de/a%20b?x=1&y=ä"), "https://v.de/a%20b?x=1&y=%C3%A4")
        def broken(req):
            raise hi.http.client.InvalidURL("URL can't contain control characters")
        self.assertEqual(hi.Fetcher(opener=broken, pause=0, log=lambda *a: None).site("https://v.de/"), [])


class PdfTests(unittest.TestCase):
    def test_pdf_links_only_price_lists_on_same_site(self):
        links = [("/downloads/Preisliste_2026.pdf", "Preise"), ("/files/flyer.pdf", "Flyer"), ("/x/gebuehrenordnung.pdf", ""),
                 ("https://fremd.de/preise.pdf", "Preise")]
        self.assertEqual(hi.pdf_links("https://www.marina-test.de/", links),
                         ["https://www.marina-test.de/downloads/Preisliste_2026.pdf", "https://www.marina-test.de/x/gebuehrenordnung.pdf"])

    def test_pdf_text_used_and_placed_after_start_page(self):
        sites = {"https://www.marina-test.de/": '<p>Willkommen</p><a href="/preisliste.pdf">Preisliste</a>',
                 "https://www.marina-test.de/preisliste.pdf": "%PDF-1.4 …"}
        def open_(req):
            body = sites.get(req.full_url)
            if body is None:
                raise hi.urllib.error.HTTPError(req.full_url, 404, "nicht da", None, None)
            return FakeResp(req.full_url, body, "application/pdf" if req.full_url.endswith(".pdf") else "text/html; charset=utf-8")
        orig = hi.pdf_to_text
        hi.pdf_to_text = lambda data: "Gastliegeplatz 2,00 € je Meter und Nacht" if data.startswith(b"%PDF") else ""
        try:
            pages = hi.Fetcher(opener=open_, pause=0, log=lambda *a: None).site("https://www.marina-test.de/")
        finally:
            hi.pdf_to_text = orig
        self.assertEqual([p["url"] for p in pages], ["https://www.marina-test.de/", "https://www.marina-test.de/preisliste.pdf"])
        facts, _ = hi.verify(hi.extract_rules(pages), pages)
        self.assertEqual((facts[0]["key"], facts[0]["price_eur"], facts[0]["url"]), ("gast_liegeplatz", 2.0, "https://www.marina-test.de/preisliste.pdf"))

    def test_broken_pdf_gives_no_text(self):
        self.assertEqual(hi.pdf_to_text(b"kein pdf"), "")


class PickTests(unittest.TestCase):
    def test_commercial_harbours_first_among_unchecked(self):
        def m(i, name): return {"id": f"node/{i}", "properties": {"name": name, "website": "https://x.de/"}}
        marinas = [m(1, "Segelverein Musterstadt e.V."), m(2, "Marina Eldenburg"), m(3, "Steg Nord"), m(4, "Stadthafen Waren")]
        got = hi.pick(marinas, {"node/4": {"checked": "2026-10-01"}}, 3, None, 30, hi.dt.date(2026, 10, 20))
        self.assertEqual([f["id"] for f in got], ["node/2", "node/3", "node/1"])     # node/4 vor kurzem geprüft

    def test_wikis_and_shared_portal_pages_are_not_own_websites(self):
        def m(i, name, url): return {"id": f"node/{i}", "properties": {"name": name, "website": url}}
        marinas = [m(1, "Alter Hafen", "https://wuerzburgwiki.de/wiki/Alter_Hafen"),
                   m(2, "Hafen am Grethaus", "http://www.skipperguide.de/wiki/Ludwigshafen"),
                   m(3, "Wikinger-Hafen", "https://www.wikinger-hafen.de/"),
                   *[m(10 + i, f"Hafen {i}", "https://portal.de/haefen/") for i in range(3)],
                   *[m(20 + i, f"Vereinssteg {i}", "https://www.verein.de/") for i in range(3)]]
        self.assertEqual(hi.unusable_websites(marinas), {"node/1", "node/2", "node/10", "node/11", "node/12"})
        got = hi.pick(marinas, {}, 50, None, 30, hi.dt.date(2026, 10, 20), hi.unusable_websites(marinas))
        self.assertEqual(sorted(f["id"] for f in got), ["node/20", "node/21", "node/22", "node/3"])

    def test_different_websites_redirecting_to_one_page_are_flagged(self):
        def m(i, name, url): return {"id": f"node/{i}", "properties": {"name": name, "website": url}}
        marinas = [m(1, "Marina Wustrow", "https://portal.de/wustrow.html"), m(2, "Stadthafen Rostock", "https://portal.de/rostock.html"),
                   m(3, "Sportboothafen Lathen", "https://sg-lathen.de/"), m(4, "Sportboothafen Lathen", "https://sg-lathen.de/"),
                   m(5, "Steg A", "https://verein.de/"), m(6, "Steg B", "https://verein.de/"),
                   m(7, "Hafen Timmendorf", "https://portal.de/timmendorf/")]
        page = lambda u: [{"url": u, "text": "x"}]
        crawled = {"node/1": (marinas[0], page("https://portal.de/timmendorf/")), "node/3": (marinas[2], page("https://sg-lathen.de/")),
                   "node/4": (marinas[3], page("https://sg-lathen.de/")), "node/5": (marinas[4], page("https://verein.de/")),
                   "node/7": (marinas[6], page("https://portal.de/timmendorf"))}       # Timmendorf ist dort zu Hause
        store = {"node/2": {"status": "ok", "source": "https://www.portal.de/timmendorf"}, "node/6": {"status": "ok", "source": "https://verein.de/"}}
        self.assertEqual(hi.shared_landings(marinas, store, crawled), {"node/1", "node/2"})


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
            self.assertEqual((doc["method"], place["method"]), (f"regeln-{hi.RULES_VERSION}",) * 2)
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
