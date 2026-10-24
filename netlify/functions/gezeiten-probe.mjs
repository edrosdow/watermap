// Prüf-Funktion (nur Vorschau): Welche Daten liefert das BSH für Gezeiten und Wasserstandsvorhersage?
// Aufruf: GET /api/gezeiten/probe (?runde=2: nur Aufbau einer Station und Stationsliste) – fragt einmalig die BSH-Schnittstelle und die BSH-Webseiten ab und zeigt die
// Rohdaten gekürzt an, damit Adresse, Format, Orte, Zeitraum und Aktualisierung geklärt werden können (docs/BSH-Klaerung.md).
// Auf der Live-Seite (CONTEXT=production) ist sie abgeschaltet. Kein Zwischenspeicher, keine Weitergabe an Nutzer.
const USER_AGENT = (env) => `WaterMap/1.0 (+https://watermaps.netlify.app; Pruefung BSH-Datenabruf${env.WATERMAP_KONTAKT ? `; ${env.WATERMAP_KONTAKT}` : ''})`;
const TIMEOUT_MS = 10000;
const MAX_TEXT = 6000;

const API = 'https://gdi.bsh.de/ldproxy/rest/services/WaterLevelForecast';
export const ZIELE = [
  { name: 'BSH-Schnittstelle (Startseite)', url: `${API}?f=json` },
  { name: 'BSH-Schnittstelle (Sammlungen)', url: `${API}/collections?f=json` },
  { name: 'Wasserstand-Anwendung', url: 'https://wasserstand.bsh.de/', html: true },
  { name: 'Gezeiten-Anwendung', url: 'https://gezeiten.bsh.de/', html: true },
];

const json = (status, body) => new Response(JSON.stringify(body, null, 2), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

async function abrufen(fetchFn, url, ua) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchFn(url, { signal: ctl.signal, headers: { 'User-Agent': ua, Accept: 'application/json, text/html;q=0.8, */*;q=0.5' } });
    const text = await r.text();
    return { url, status: r.status, typ: r.headers.get('content-type'), groesse: text.length, text };
  } catch (e) {
    return { url, fehler: e.name === 'AbortError' ? 'Zeitüberschreitung' : String(e.message || e) };
  } finally { clearTimeout(timer); }
}

/** Aus HTML die Verweise auf Skripte und Datenadressen herausziehen (zeigt, was die Seite selbst abruft). */
export function verweise(html, basis) {
  const out = new Set();
  for (const m of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) out.add(m[1]);
  for (const m of html.matchAll(/["'](https?:\/\/[^"'\s]+|\/[^"'\s]*(?:api|json|data|rest|ldproxy|forecast|vorhersage)[^"'\s]*)["']/gi)) out.add(m[1]);
  return [...out].map(u => { try { return new URL(u, basis).href; } catch { return u; } }).slice(0, 80);
}

/** Aufbau eines JSON-Objekts: je Feld Typ, bei Listen Länge sowie erster und letzter Eintrag (gekürzt). */
export function aufbau(text) {
  let j; try { j = JSON.parse(text); } catch { return { fehler: 'kein JSON', anfang: text.slice(0, 500) }; }
  const kurz = (v) => JSON.stringify(v)?.slice(0, 400);
  const beschreibe = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k,
    Array.isArray(v) ? { liste: v.length, erster: kurz(v[0]), letzter: kurz(v[v.length - 1]) }
      : v && typeof v === 'object' ? { objekt: Object.keys(v).slice(0, 30) } : { wert: kurz(v) }]));
  return { oben: Object.keys(j), properties: beschreibe(j.properties) };
}

/** Stationsliste kompakt: Kennung, Name, Pegelnummer, PEGELONLINE-UUID, Region. */
export function stationen(text) {
  let j; try { j = JSON.parse(text); } catch { return { fehler: 'kein JSON', anfang: text.slice(0, 500) }; }
  return (j.features || []).map(f => {
    const p = f.properties || {};
    return [f.id, p.gauge_label, p.operator_gauge_id, (String(p.measurement_url || '').match(/id=([0-9a-f-]{36})/) || [])[1] || null, p.region, p.area].join(' | ');
  });
}

export async function handle(req, { fetchFn = fetch, env = process.env } = {}) {
  if (env.CONTEXT === 'production') return json(404, { fehler: 'Nur in der Vorschau verfügbar.' });
  if (req.method !== 'GET') return json(405, { fehler: 'Nur GET.' });
  const ua = USER_AGENT(env), ergebnisse = [];
  // ?runde=2: nur Aufbau einer Station und Stationsliste (kürzere Ausgabe)
  const runde2 = new URL(req.url).searchParams.get('runde') === '2';
  for (const z of runde2 ? [] : ZIELE) {
    const r = await abrufen(fetchFn, z.url, ua);
    const e = { name: z.name, url: z.url, status: r.status ?? null, typ: r.typ ?? null, groesse: r.groesse ?? null, fehler: r.fehler ?? null };
    if (r.text) {
      if (z.html) {
        e.verweise = verweise(r.text, z.url);
        // Skripte der Seite nach Datenadressen durchsuchen (nur die ersten drei, eigene Domain)
        const skripte = e.verweise.filter(u => /\.js(\?|$)/.test(u) && new URL(u).host.endsWith('bsh.de')).slice(0, 3);
        e.skripte = [];
        for (const s of skripte) {
          const sr = await abrufen(fetchFn, s, ua);
          e.skripte.push({ url: s, status: sr.status ?? null, fehler: sr.fehler ?? null,
            adressen: sr.text ? [...new Set([...sr.text.matchAll(/["'`](https?:\/\/[^"'`\s]+|\/[^"'`\s]*(?:api|json|rest|ldproxy|forecast|tide|gezeit|station)[^"'`\s]*)["'`]/gi)].map(m => m[1]))].slice(0, 60) : [] });
        }
      } else e.inhalt = r.text.slice(0, MAX_TEXT);
    }
    ergebnisse.push(e);
  }
  // Runde 2: Aufbau einer Station (Feldnamen, Längen, erster/letzter Wert) und Liste aller Stationen (nur Kennungen)
  const st = await abrufen(fetchFn, `${API}/collections/waterlevelforecastdata/items/cuxhaven_steubenhoeft?f=json`, ua);
  ergebnisse.push({ name: 'Aufbau Station cuxhaven_steubenhoeft', url: st.url, status: st.status ?? null, fehler: st.fehler ?? null, aufbau: st.text ? aufbau(st.text) : null });
  const li = await abrufen(fetchFn, `${API}/collections/waterlevelforecastdata/items?f=json&limit=200&properties=gauge_label,operator_gauge_id,measurement_url,region,area`, ua);
  ergebnisse.push({ name: 'Liste aller Stationen', url: li.url, status: li.status ?? null, fehler: li.fehler ?? null, groesse: li.text?.length ?? null, stationen: li.text ? stationen(li.text) : null });
  return json(200, { zeit: new Date().toISOString(), userAgent: ua, ergebnisse });
}

export default (req) => handle(req);
export const config = { path: '/api/gezeiten/probe' };
