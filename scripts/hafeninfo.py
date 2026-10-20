#!/usr/bin/env python3
"""WaterMap – Hafeninfos von den Websites der Marinas auslesen (Preise, Service, Ausstattung).

  python3 scripts/hafeninfo.py --limit 25            # 25 Häfen, deren Infos am längsten nicht geprüft wurden
  python3 scripts/hafeninfo.py --only node/123,way/4 # bestimmte Häfen
  python3 scripts/hafeninfo.py --crawl-only          # nur Websites abrufen und berichten, kein KI-Aufruf

Ablauf
  1. Für jede Marina mit Website (aus public/data/osm/marina.geojson): Startseite und passende Unterseiten
     („Hafen“, „Preise“, „Liegeplatz“, „Service“ …) abrufen – robots.txt wird beachtet, höchstens 5 Seiten,
     eine Anfrage pro Sekunde und Website.
  2. Unveränderte Seiten (gleicher Inhalt wie beim letzten Lauf) werden nicht erneut ausgewertet.
  3. Claude liest die Seiten (Message Batches API, halber Preis) und liefert Angaben in einem festen Schema –
     zu JEDER Angabe ein wörtliches Zitat von der Seite.
  4. Prüfung: Eine Angabe bleibt nur, wenn ihr Zitat tatsächlich im abgerufenen Seitentext steht und ein
     genannter Preis im Zitat vorkommt. Alles andere wird verworfen – erfunden wird nichts.
  5. Ergebnis: public/data/hafeninfo.json (Quelle und Abrufdatum je Angabe), Verweis in meta.json.

Braucht: Python 3.10+, `pip install anthropic`, Umgebungsvariable ANTHROPIC_API_KEY (außer bei --crawl-only).
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import html
import html.parser
import json
import pathlib
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
OUT_REL = "hafeninfo.json"
USER_AGENT = "WaterMap-Hafeninfo/1.0 (Wassersport-Karte; liest öffentliche Hafenangaben; Kontakt siehe Impressum der App)"
MODEL = "claude-opus-5-5"
MAX_PAGES = 5
PAGE_CHARS = 12_000
TOTAL_CHARS = 40_000
MAX_BYTES = 2_000_000
TIMEOUT = 20
PER_HOST_PAUSE = 1.0

# Unterseiten, die wahrscheinlich Hafenangaben enthalten (URL oder Linktext)
LINK_HINT = re.compile(
    r"hafen|preis|liegepl|liegegeb|gastlieg|gastplatz|gebühr|gebuehr|tarif|entgelt|service|leistung|ausstattung|"
    r"marina|anleger|steg|sanitär|sanitaer|tankstelle|wohnmobil|stellplatz|winterlager|kran|slip|info|kontakt",
    re.I)
SKIP_EXT = re.compile(r"\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4|mp3)(\?|#|$)", re.I)

# Feste Liste der Angaben (Schlüssel → Anzeige). Das Modell darf nur diese Schlüssel verwenden.
FACTS = {
    "gast_liegeplatz": "Gastliegeplatz",
    "dauerliegeplatz": "Dauer-/Saisonliegeplatz",
    "max_laenge": "Max. Bootslänge",
    "wassertiefe": "Wassertiefe / Tiefgang",
    "strom": "Strom",
    "wasser": "Frischwasser",
    "faekalien": "Fäkalienabsaugung",
    "diesel": "Diesel",
    "benzin": "Benzin",
    "duschen": "Duschen",
    "toiletten": "Toiletten",
    "waschmaschine": "Waschmaschine / Trockner",
    "wlan": "WLAN",
    "restaurant": "Restaurant / Imbiss",
    "einkauf": "Einkauf / Brötchen",
    "parken": "Parken",
    "wohnmobil": "Wohnmobil-Stellplatz",
    "slip": "Slipanlage",
    "kran": "Kran",
    "winterlager": "Winterlager",
    "werkstatt": "Werkstatt / Service",
    "entsorgung": "Entsorgung (Altöl, Bilge, Müll)",
    "bootsverleih": "Bootsverleih / Charter",
    "hafenmeister": "Hafenmeister / Erreichbarkeit",
    "funk": "UKW-Kanal",
    "saison": "Saison / Öffnungszeiten",
    "haustiere": "Hunde / Haustiere",
    "sonstiges": "Sonstiges",
}

SCHEMA = {
    "type": "object",
    "properties": {
        "facts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "enum": list(FACTS)},
                    "value": {"type": "string", "description": "Kurze Angabe auf Deutsch, z. B. „3,00 € pro lfd. Meter und Tag, mind. 7 m, inkl. Strom“"},
                    "price_eur": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                    "quote": {"type": "string", "description": "Wörtlicher Ausschnitt aus dem Seitentext (höchstens 200 Zeichen), der die Angabe belegt"},
                    "page": {"type": "integer", "description": "Nummer der Seite, auf der das Zitat steht"},
                },
                "required": ["key", "value", "price_eur", "quote", "page"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["facts"],
    "additionalProperties": False,
}

SYSTEM = """Du liest Websites von Sportboothäfen und Marinas in Deutschland und überträgst die Angaben für Wassersportler in ein festes Schema.

Regeln:
- Übernimm nur, was auf den Seiten steht. Nichts ergänzen, nichts schätzen, nichts aus Allgemeinwissen.
- Zu jeder Angabe gehört ein wörtliches Zitat aus dem Seitentext (Zeichen für Zeichen kopiert, höchstens 200 Zeichen) und die Nummer der Seite. Ohne passendes Zitat keine Angabe.
- „value“: kurz und vollständig auf Deutsch, mit Preis, Einheit und Bedingungen, wie sie auf der Seite stehen (z. B. „0,50 € pro 70 l“).
- „price_eur“: der Hauptpreis in Euro als Zahl, wenn die Angabe einen Preis hat, sonst null.
- Gibt es zu einem Schlüssel mehrere Angaben (z. B. Parken pro Tag und pro Woche), lege mehrere Einträge an.
- Nur Angaben zu diesem Hafen. Werbung, Ferienwohnungen, Charterboot-Preise und Angaben zu anderen Orten weglassen (Bootsverleih nur als Hinweis, dass es ihn gibt).
- Enthalten die Seiten keine solchen Angaben, gib eine leere Liste zurück."""


# --------------------------------------------------------------------------- Abruf
class _Text(html.parser.HTMLParser):
    """Sichtbarer Text und Links einer HTML-Seite (nur Standardbibliothek)."""
    SKIP = {"script", "style", "noscript", "svg", "template", "head"}
    BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "table", "ul", "ol", "dt", "dd", "td", "th"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.links, self._skip, self._href, self._atext = [], [], 0, None, []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1
        if tag in self.BLOCK:
            self.parts.append("\n")
        if tag == "td" or tag == "th":
            self.parts.append(" | ")
        if tag == "a":
            self._href, self._atext = dict(attrs).get("href"), []

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        if tag == "a" and self._href:
            self.links.append((self._href, " ".join(self._atext).strip()))
            self._href = None
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._skip:
            return
        self.parts.append(data)
        if self._href is not None:
            self._atext.append(data)


def html_to_text(raw: str) -> tuple[str, list[tuple[str, str]]]:
    p = _Text()
    try:
        p.feed(raw)
        p.close()
    except Exception:  # noqa: BLE001 – kaputtes HTML: nehmen, was da ist
        pass
    text = "".join(p.parts)
    text = re.sub(r"[ \t\r\f\v ]+", " ", text)
    text = re.sub(r"\s*\n\s*", "\n", text)
    return text.strip(), p.links


def candidate_links(base: str, links, limit=MAX_PAGES - 1) -> list[str]:
    """Unterseiten derselben Website, die nach Hafenangaben aussehen – die besten zuerst."""
    host = urllib.parse.urlsplit(base).hostname or ""
    root_host = host.removeprefix("www.")
    seen, scored = set(), []
    for href, text in links:
        if not href or href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        url = urllib.parse.urljoin(base, href.strip()).split("#")[0]
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in ("http", "https") or (parts.hostname or "").removeprefix("www.") != root_host:
            continue
        if SKIP_EXT.search(url) or url.rstrip("/") == base.rstrip("/") or url in seen:
            continue
        seen.add(url)
        hay = f"{urllib.parse.unquote(parts.path)} {text}"
        hits = len(LINK_HINT.findall(hay))
        if hits:
            strong = 2 if re.search(r"preis|tarif|gebühr|gebuehr|liegepl|gastlieg|hafen", hay, re.I) else 0
            scored.append((-(hits + strong), len(url), url))
    return [u for *_, u in sorted(scored)[:limit]]


class Fetcher:
    """Höflicher Abruf: robots.txt, Zeitlimit, Größenlimit, Pause je Website."""

    def __init__(self, opener=None, pause=PER_HOST_PAUSE, log=print):
        self.open = opener or (lambda req: urllib.request.urlopen(req, timeout=TIMEOUT))
        self.pause, self.log = pause, log
        self.robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self.last: dict[str, float] = {}
        self.lock = threading.Lock()

    def _wait(self, host):
        with self.lock:
            delay = self.last.get(host, 0) + self.pause - time.monotonic()
            self.last[host] = time.monotonic() + max(delay, 0)
        if delay > 0:
            time.sleep(delay)

    def _get(self, url) -> tuple[str, str] | None:
        """(endgültige URL, HTML) oder None."""
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.5", "Accept-Language": "de"})
        try:
            with self.open(req) as resp:
                ctype = resp.headers.get("Content-Type", "")
                if "html" not in ctype and "text" not in ctype:
                    return None
                data = resp.read(MAX_BYTES + 1)[:MAX_BYTES]
                charset = resp.headers.get_content_charset() or "utf-8"
                return resp.geturl(), data.decode(charset, errors="replace")
        except (urllib.error.URLError, OSError, ValueError, LookupError):
            return None

    def allowed(self, url) -> bool:
        parts = urllib.parse.urlsplit(url)
        key = f"{parts.scheme}://{parts.netloc}"
        if key not in self.robots:
            rp = urllib.robotparser.RobotFileParser()
            got = self._get(key + "/robots.txt")
            if got is None:
                self.robots[key] = None                 # keine robots.txt erreichbar → erlaubt
            else:
                rp.parse(got[1].splitlines())
                self.robots[key] = rp
        rp = self.robots[key]
        return rp is None or rp.can_fetch(USER_AGENT, url)

    def page(self, url):
        if not self.allowed(url):
            self.log(f"    robots.txt verbietet {url}")
            return None
        self._wait(urllib.parse.urlsplit(url).hostname or "")
        return self._get(url)

    def site(self, start: str) -> list[dict]:
        """Startseite + passende Unterseiten → [{url, text}] (gekürzt)."""
        first = self.page(start)
        if not first:
            return []
        final, raw = first
        text, links = html_to_text(raw)
        pages = [{"url": final, "text": text[:PAGE_CHARS]}]
        for url in candidate_links(final, links):
            got = self.page(url)
            if got:
                t, _ = html_to_text(got[1])
                if t and all(t[:PAGE_CHARS] != p["text"] for p in pages):
                    pages.append({"url": got[0], "text": t[:PAGE_CHARS]})
            if sum(len(p["text"]) for p in pages) >= TOTAL_CHARS:
                break
        total, out = 0, []
        for p in pages:
            room = TOTAL_CHARS - total
            if room <= 200:
                break
            out.append({"url": p["url"], "text": p["text"][:room]})
            total += len(out[-1]["text"])
        return out


def pages_hash(pages) -> str:
    h = hashlib.sha256()
    for p in pages:
        h.update(p["url"].encode() + b"\0" + p["text"].encode() + b"\0")
    return h.hexdigest()[:16]


# --------------------------------------------------------------------------- Prüfung der Antwort
def _norm(s: str) -> str:
    s = html.unescape(s).replace(" ", " ").replace("–", "-").replace("—", "-").replace("„", '"').replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", s).strip().casefold()


def _price_in(price: float, quote: str) -> bool:
    """Steht der Preis im Zitat? („3“, „3,00“, „3.00“, „3,-“ …)"""
    q = quote.replace(" ", "")
    euros, cents = int(price), round((price - int(price)) * 100)
    forms = {f"{euros},{cents:02d}", f"{euros}.{cents:02d}"}
    if cents == 0:
        forms |= {f"{euros},-", f"{euros}€", f"{euros}eur", f"{euros}euro"}
        if re.search(rf"(?<![\d,.]){euros}(?![\d])", q):
            return True
    elif cents % 10 == 0:
        forms |= {f"{euros},{cents // 10}", f"{euros}.{cents // 10}"}
    return any(f in q.casefold() for f in forms)


def verify(facts, pages) -> tuple[list[dict], int]:
    """Behält nur belegte Angaben: Zitat steht im Seitentext, Preis steht im Zitat. → (Angaben, verworfen)"""
    texts = [_norm(p["text"]) for p in pages]
    out, dropped, seen = [], 0, set()
    for f in facts or []:
        key, value, quote = f.get("key"), (f.get("value") or "").strip(), (f.get("quote") or "").strip()
        page = f.get("page")
        if key not in FACTS or not value or len(quote) < 4 or len(quote) > 400:
            dropped += 1
            continue
        nq = _norm(quote)
        idx = page - 1 if isinstance(page, int) and 1 <= page <= len(pages) and nq in texts[page - 1] else \
            next((i for i, t in enumerate(texts) if nq in t), None)
        price = f.get("price_eur")
        if idx is None or (isinstance(price, (int, float)) and not _price_in(float(price), quote)):
            dropped += 1
            continue
        sig = (key, _norm(value))
        if sig in seen:
            continue
        seen.add(sig)
        out.append({"key": key, "value": value[:300], "price_eur": float(price) if isinstance(price, (int, float)) else None,
                    "quote": quote[:240], "url": pages[idx]["url"]})
    order = list(FACTS)
    out.sort(key=lambda f: order.index(f["key"]))
    return out, dropped


# --------------------------------------------------------------------------- Claude (Batches)
def build_request(custom_id: str, name: str, pages) -> dict:
    """Eine Batch-Anfrage (entspricht den TypedDicts Request/MessageCreateParamsNonStreaming des SDK)."""
    doc = "\n\n".join(f"=== Seite {i} – {p['url']} ===\n{p['text']}" for i, p in enumerate(pages, 1))
    return {"custom_id": custom_id, "params": {
        "model": MODEL,
        "max_tokens": 16000,
        "system": SYSTEM,
        "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        "messages": [{"role": "user", "content": f"Hafen: {name or 'ohne Namen'}\n\n{doc}"}],
    }}


def run_batch(client, requests, log=print, poll=30, max_wait_s=5 * 3600):
    """Schickt die Anfragen als Batch und liefert {custom_id: (status, data|None)}."""
    batch = client.messages.batches.create(requests=requests)
    log(f"Batch {batch.id} mit {len(requests)} Anfragen gestartet …")
    started = time.monotonic()
    while True:
        batch = client.messages.batches.retrieve(batch.id)
        if batch.processing_status == "ended":
            break
        if time.monotonic() - started > max_wait_s:
            log("  Zeitlimit erreicht – Batch wird abgebrochen.")
            client.messages.batches.cancel(batch.id)
            break
        log(f"  … in Arbeit: {batch.request_counts.processing}, fertig: {batch.request_counts.succeeded}")
        time.sleep(poll)
    out = {}
    for r in client.messages.batches.results(batch.id):
        if r.result.type != "succeeded":
            out[r.custom_id] = (r.result.type, None)
            continue
        msg = r.result.message
        if msg.stop_reason != "end_turn":                    # refusal, max_tokens …: nichts übernehmen
            out[r.custom_id] = (f"stop:{msg.stop_reason}", None)
            continue
        text = next((b.text for b in msg.content if b.type == "text"), "")
        try:
            out[r.custom_id] = ("ok", json.loads(text))
        except ValueError:
            out[r.custom_id] = ("bad_json", None)
    return out


# --------------------------------------------------------------------------- Ablauf
def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def pick(marinas, store, limit, only, max_age_days, today):
    """Häfen mit Website; zuerst nie geprüfte, dann die am längsten nicht geprüften."""
    cutoff = (today - dt.timedelta(days=max_age_days)).isoformat()
    cands = []
    for f in marinas:
        p = f["properties"]
        if not p.get("website") or (only and f["id"] not in only):
            continue
        last = (store.get(f["id"]) or {}).get("checked") or ""
        if only or last < cutoff:
            cands.append((last, f["id"], f))
    cands.sort(key=lambda c: (c[0], c[1]))
    return [f for *_, f in cands[:limit]]


def main(argv=None, client=None, fetcher=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(DATA))
    ap.add_argument("--limit", type=int, default=25, help="höchstens so viele Häfen pro Lauf (Standard 25)")
    ap.add_argument("--only", help="nur diese IDs, z. B. node/123,way/456")
    ap.add_argument("--max-age-days", type=int, default=30, help="Häfen erst nach so vielen Tagen erneut prüfen")
    ap.add_argument("--crawl-only", action="store_true", help="nur Websites abrufen und berichten (kein KI-Aufruf, nichts geschrieben)")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args(argv)
    data = pathlib.Path(args.data)
    today = dt.date.today()
    marinas = load_json(data / "osm" / "marina.geojson", {}).get("features", [])
    out_path = data / OUT_REL
    store_doc = load_json(out_path, {"generated": None, "model": MODEL, "places": {}})
    store = store_doc.setdefault("places", {})
    only = {s.strip() for s in args.only.split(",")} if args.only else None
    todo = pick(marinas, store, args.limit, only, args.max_age_days, today)
    print(f"{len(todo)} Häfen werden geprüft (von {sum(1 for f in marinas if f['properties'].get('website'))} mit Website).")
    if not todo:
        return 0

    fetcher = fetcher or Fetcher()
    crawled = {}

    def crawl(f):
        return f, fetcher.site(f["properties"]["website"])
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for f, pages in ex.map(crawl, todo):
            crawled[f["id"]] = (f, pages)
            print(f"  {f['id']:20s} {len(pages)} Seite(n), {sum(len(p['text']) for p in pages):6d} Zeichen  {f['properties'].get('name') or ''}")

    if args.crawl_only:
        n = sum(1 for _, pages in crawled.values() if pages)
        chars = sum(len(p["text"]) for _, pages in crawled.values() for p in pages)
        print(f"Erreichbar: {n} von {len(crawled)}; zusammen {chars} Zeichen (≈ {chars // 3600} k Tokens).")
        return 0

    stamp = today.isoformat()
    requests, ids = [], {}
    for i, (fid, (f, pages)) in enumerate(crawled.items()):
        old = store.get(fid) or {}
        if not pages:
            store[fid] = {**old, "checked": stamp, "status": "nicht erreichbar"}
            continue
        h = pages_hash(pages)
        if old.get("hash") == h and old.get("status") == "ok":
            store[fid] = {**old, "checked": stamp}             # unverändert: keine neue Auswertung nötig
            continue
        cid = f"h{i}"
        ids[cid] = (fid, pages, h)
        requests.append(build_request(cid, f["properties"].get("name"), pages))

    if requests:
        if client is None:
            import anthropic
            client = anthropic.Anthropic()
        results = run_batch(client, requests)
        kept_total = dropped_total = 0
        for cid, (fid, pages, h) in ids.items():
            status, payload = results.get(cid, ("fehlt", None))
            if status != "ok":
                store[fid] = {**(store.get(fid) or {}), "checked": stamp, "status": f"fehler: {status}"}
                continue
            facts, dropped = verify(payload.get("facts"), pages)
            kept_total += len(facts)
            dropped_total += dropped
            store[fid] = {"checked": stamp, "status": "ok", "hash": h, "source": pages[0]["url"],
                          "pages": [p["url"] for p in pages], "facts": facts}
        print(f"Angaben übernommen: {kept_total}, verworfen (ohne Beleg): {dropped_total}")

    store_doc.update({"generated": stamp, "model": MODEL, "schema": {k: v for k, v in FACTS.items()}})
    out_path.write_text(json.dumps(store_doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    meta_path = data / "meta.json"
    meta = load_json(meta_path, {})
    meta.setdefault("files", {})["hafeninfo"] = OUT_REL
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    with_facts = sum(1 for v in store.values() if v.get("facts"))
    print(f"Fertig: {with_facts} Häfen mit Angaben in {out_path.relative_to(ROOT) if out_path.is_relative_to(ROOT) else out_path}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
