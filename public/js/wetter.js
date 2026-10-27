// Wetter, Wind und amtliche Warnungen des Deutschen Wetterdienstes (DWD) für einen Standort.
// Daten: DWD Open Data (Messungen, MOSMIX-Vorhersage, Warnungen), als JSON über Bright Sky (api.brightsky.dev).
// Abruf über die eigene Domain (/api/wetter/… → public/_redirects): keine CSP-Ausnahme, keine Besucher-IP bei Dritten.
// Gesendet werden nur die Koordinaten des angesehenen Standorts – nie der Standort des Nutzers.
import { CONFIG } from './config.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { s, sText, niceStep, fmtNum, abfahren } from './chart.js';

// ------------------------------------------------------------------ Umrechnungen
const BFT_KMH = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
const BFT_LABEL = ['Windstille', 'leiser Zug', 'leichte Brise', 'schwache Brise', 'mäßige Brise', 'frische Brise', 'starker Wind',
  'steifer Wind', 'stürmischer Wind', 'Sturm', 'schwerer Sturm', 'orkanartiger Sturm', 'Orkan'];
export const beaufort = (kmh) => { let b = 0; while (b < BFT_KMH.length && kmh >= BFT_KMH[b]) b++; return b; };
const DIRS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg) => DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

// Warnstufen des DWD (gelb, orange, rot, violett) – nie allein über Farbe: Symbol + Text gehören dazu
export const SEVERITY = {
  minor:    { label: 'Wetterwarnung', rank: 1, color: '#FAB219' },
  moderate: { label: 'Markante Wetterwarnung', rank: 2, color: '#EC835A' },
  severe:   { label: 'Unwetterwarnung', rank: 3, color: '#D03B3B' },
  extreme:  { label: 'Extreme Unwetterwarnung', rank: 4, color: '#8B1A6B' },
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

async function getJson(path, params) {
  const res = await fetch(`${CONFIG.WETTER_BASE}${path}?${qs({ ...params, tz: 'Europe/Berlin' })}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ------------------------------------------------------------------ Laden (mit kurzem Zwischenspeicher je Ort)
const cache = new Map();

export function loadWeather(lat, lon, now = Date.now()) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CONFIG.WETTER_CACHE_MIN * 60e3) return hit.promise;
  const pos = { lat: lat.toFixed(4), lon: lon.toFixed(4) };
  const from = new Date(now - 3600e3), to = new Date(now + CONFIG.WETTER_HOURS * 3600e3);
  const promise = Promise.allSettled([
    getJson('current_weather', pos),
    getJson('weather', { ...pos, date: from.toISOString(), last_date: to.toISOString() }),
    getJson('alerts', pos),
  ]).then(([cur, fc, al]) => {
    const out = {
      current: cur.status === 'fulfilled' ? normCurrent(cur.value) : null,
      hours: fc.status === 'fulfilled' ? normHours(fc.value, now) : null,
      alerts: al.status === 'fulfilled' ? normAlerts(al.value) : null,
    };
    if (!out.current && !out.hours && !out.alerts) { cache.delete(key); throw new Error('Wetterdaten nicht erreichbar'); }
    return out;
  });
  cache.set(key, { at: now, promise });
  return promise;
}

function normCurrent(raw) {
  const w = raw?.weather;
  if (!w) return null;
  const src = (raw.sources || []).find(x => x.id === w.source_id) || (raw.sources || [])[0] || {};
  return {
    time: Date.parse(w.timestamp) || null,
    temp: num(w.temperature), icon: w.icon || null,
    wind: num(w.wind_speed_10 ?? w.wind_speed_30 ?? w.wind_speed_60),
    dir: num(w.wind_direction_10 ?? w.wind_direction_30 ?? w.wind_direction_60),
    gust: num(w.wind_gust_speed_10 ?? w.wind_gust_speed_30 ?? w.wind_gust_speed_60),
    station: src.station_name ? titleCase(src.station_name) : null,
    distance: num(src.distance),
  };
}

function normHours(raw, now) {
  const list = (raw?.weather || []).map(w => ({
    t: Date.parse(w.timestamp), temp: num(w.temperature), icon: w.icon || null,
    wind: num(w.wind_speed), dir: num(w.wind_direction), gust: num(w.wind_gust_speed),
    rain: num(w.precipitation), prob: num(w.precipitation_probability),
  })).filter(x => Number.isFinite(x.t) && x.t >= now - 3600e3 && x.wind !== null).sort((a, b) => a.t - b.t);
  return list.length ? list : null;
}

function normAlerts(raw) {
  const list = (raw?.alerts || []).filter(a => a && SEVERITY[a.severity]).map(a => ({
    id: a.id ?? a.alert_id, severity: a.severity,
    event: a.event_de || a.event_en || 'Warnung', headline: a.headline_de || a.headline_en || '',
    description: a.description_de || a.description_en || '', instruction: a.instruction_de || a.instruction_en || '',
    onset: Date.parse(a.onset) || Date.parse(a.effective) || null, expires: Date.parse(a.expires) || null,
  })).sort((a, b) => SEVERITY[b.severity].rank - SEVERITY[a.severity].rank || (a.onset || 0) - (b.onset || 0));
  return { list, place: raw?.location?.name || null };
}

function titleCase(str) {
  return String(str).toLowerCase().replace(/(^|[\s\-(/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

// ------------------------------------------------------------------ Darstellung
const timeFmt = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayTimeFmt = (t) => {
  const d = new Date(t), today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const day = d.toDateString() === today.toDateString() ? 'heute' : d.toDateString() === tomorrow.toDateString() ? 'morgen'
    : d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  return `${day} ${timeFmt(t)}`;
};

/** Pfeil, der zeigt, wohin der Wind weht (Windrichtung = woher; der Pfeil zeigt ungedreht nach Süden = Wind aus Nord). */
function windArrow(dir, px = 18) {
  if (dir === null) return '';
  return `<svg class="wx-arrow" width="${px}" height="${px}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g transform="rotate(${Math.round(dir)} 12 12)"><path d="M12 3v15M6.5 13 12 19l5.5-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
}

// Wettersymbole (Linien, currentColor) zu den Bright-Sky-Kennungen
const WX = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 18.5z"/>',
  part: '<path d="M8.5 4.5v1.2M3.8 9.2H5M5.2 5.9l.9.9M11.8 5.9l-.9.9"/><path d="M6 11.2a3 3 0 0 1 5.3-2.4"/><path d="M9 19h8.5a3.3 3.3 0 0 0 .3-6.6 4.6 4.6 0 0 0-8.8 1.2A2.7 2.7 0 0 0 9 19z"/>',
  fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
  rain: '<path d="M7 14.5h10a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.4A2.9 2.9 0 0 0 7 14.5z"/><path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>',
  snow: '<path d="M7 14.5h10a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.4A2.9 2.9 0 0 0 7 14.5z"/><path d="M8 18.5h.01M12 18.5h.01M16 18.5h.01M10 21h.01M14 21h.01"/>',
  thunder: '<path d="M7 14.5h10a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.4A2.9 2.9 0 0 0 7 14.5z"/><path d="M12.5 15.5 10.5 19h3l-2 3.5"/>',
  wind: '<path d="M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h15a2.5 2.5 0 1 1-2.5 2.5M3 17h7"/>',
};
const ICON_MAP = {
  'clear-day': ['sun', 'sonnig'], 'clear-night': ['moon', 'klar'], 'partly-cloudy-day': ['part', 'teils bewölkt'],
  'partly-cloudy-night': ['part', 'teils bewölkt'], cloudy: ['cloud', 'bewölkt'], fog: ['fog', 'Nebel'], wind: ['wind', 'windig'],
  rain: ['rain', 'Regen'], sleet: ['snow', 'Schneeregen'], snow: ['snow', 'Schnee'], hail: ['rain', 'Hagel'], thunderstorm: ['thunder', 'Gewitter'],
};
function wxIcon(code, px = 22) {
  const [k, label] = ICON_MAP[code] || ['cloud', ''];
  return { svg: `<svg class="wx-ico" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${WX[k]}</svg>`, label };
}

const windText = (kmh, dir) => `${fmtNum(kmh)} km/h · ${beaufort(kmh)} Bft${dir !== null ? ` aus ${compass(dir)}` : ''}`;

/** Abschnitt „Wetter und Wind“; füllt sich selbst, sobald die Daten da sind. */
export function weatherSection(lat, lon) {
  const box = h('div', { class: 'wx', 'aria-busy': 'true' }, h('p', { class: 'muted small', text: 'Wetter wird geladen …' }));
  const section = h('section', { class: 'block wx-block' }, h('h3', { text: 'Wetter und Wind' }), box);
  loadWeather(lat, lon).then((d) => {
    box.removeAttribute('aria-busy');
    box.replaceChildren(...renderWeather(d));
  }, () => {
    box.removeAttribute('aria-busy');
    box.replaceChildren(h('p', { class: 'unknown', text: 'Wetterdaten sind gerade nicht erreichbar.' }));
  });
  return section;
}

/** Kurzwerte für die Wetter-Zeile, z. B. „3 Bft aus SW · Böen 34 km/h · 12 °C · keine Warnung“. */
export function kurzwerte({ current, alerts }) {
  const t = [];
  if (current && current.wind !== null) {
    t.push(`${beaufort(current.wind)} Bft${current.dir !== null ? ` aus ${compass(current.dir)}` : ''}`);
    if (current.gust !== null && current.gust > current.wind) t.push(`Böen ${fmtNum(current.gust)} km/h`);
    if (current.temp !== null) t.push(`${fmtNum(current.temp)} °C`);
  }
  if (alerts && !alerts.list.length) t.push('keine Warnung');
  return t.join(' · ') || 'Wind, Vorhersage und Warnungen';
}

/**
 * Zeile „Wetter und Wind“ (Slipanlagen): Kurzwerte, ein Tipp öffnet das Fenster mit allem. Liegt eine amtliche Warnung vor,
 * zeigt die Zeile sie (Farbe + Symbol + Text) – `warnung` löst dann mit true auf, damit die Zeile nach oben rücken kann.
 */
export function wetterZeile(lat, lon, { name = '' } = {}) {
  const ico = h('span', { class: 'wxz-ico', html: icon('gauge', 22), 'aria-hidden': 'true' });
  const titel = h('strong', { text: 'Wetter und Wind' });
  const sub = h('small', { text: 'Wird geladen …' });
  const zeile = h('button', { type: 'button', class: 'wxz', 'aria-haspopup': 'dialog', onclick: () => wetterFenster({ lat, lon, name, opener: zeile }) },
    ico, h('span', { class: 'wxz-text' }, titel, sub), h('span', { class: 'wxz-pfeil', html: icon('chevron', 18), 'aria-hidden': 'true' }));
  const warnung = loadWeather(lat, lon).then((d) => {
    const a = d.alerts?.list[0];
    const wind = d.current && d.current.wind !== null ? `${beaufort(d.current.wind)} Bft${d.current.dir !== null ? ` ${compass(d.current.dir)}` : ''}` : null;
    if (a) {
      const sev = SEVERITY[a.severity];
      zeile.classList.add('wxz-warn', `wxz-${a.severity}`); zeile.style.setProperty('--sev', sev.color);
      ico.innerHTML = icon('alert', 22);
      titel.textContent = `Amtliche Warnung: ${titleCase(a.event)}${d.alerts.list.length > 1 ? ` (+${d.alerts.list.length - 1})` : ''}`;
      const wann = a.onset && a.onset > Date.now() ? `ab ${dayTimeFmt(a.onset)}` : a.expires ? `bis ${dayTimeFmt(a.expires)}` : 'gilt jetzt';
      sub.textContent = [wann, wind ? `jetzt ${wind}` : null].filter(Boolean).join(' · ');
      return true;
    }
    if (d.current?.icon) ico.innerHTML = wxIcon(d.current.icon, 24).svg;
    sub.textContent = kurzwerte(d);
    return false;
  }, () => { sub.textContent = 'Wind, Vorhersage und Warnungen'; return false; });
  return { zeile, warnung };
}

/** Fenster „Wetter und Wind“ (Handy: von unten, sonst mittig): Warnungen, Wind jetzt, Vorhersage. */
export function wetterFenster({ lat, lon, name = '', opener = null }) {
  const box = h('div', { class: 'wx', 'aria-busy': 'true' }, h('p', { class: 'muted small', text: 'Wetter wird geladen …' }));
  const dlg = h('dialog', { class: 'wxd', 'aria-labelledby': 'wxd-titel' },
    h('span', { class: 'wxd-grip', 'aria-hidden': 'true' }),
    h('header', { class: 'wxd-kopf' },
      h('div', {}, h('h2', { id: 'wxd-titel', tabindex: '-1', text: 'Wetter und Wind' }), name ? h('p', { class: 'wxd-unter', text: name }) : null),
      h('button', { type: 'button', class: 'wxd-x', 'aria-label': 'Schließen', html: icon('close', 22), onclick: () => dlg.close() })),
    h('div', { class: 'wxd-body' }, box));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { dlg.remove(); if (opener && document.contains(opener)) opener.focus({ preventScroll: true }); });
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector('#wxd-titel').focus({ preventScroll: true });
  loadWeather(lat, lon).then((d) => { box.removeAttribute('aria-busy'); box.replaceChildren(...renderWeather(d)); },
    () => { box.removeAttribute('aria-busy'); box.replaceChildren(h('p', { class: 'unknown', text: 'Wetterdaten sind gerade nicht erreichbar.' })); });
  return dlg;
}

export function renderWeather({ current, hours, alerts }) {
  const out = [];

  // 1. Amtliche Warnungen zuerst
  if (alerts) {
    if (alerts.list.length) {
      out.push(h('div', { class: 'wx-alerts' }, alerts.list.map(a => {
        const sev = SEVERITY[a.severity];
        const when = [a.onset ? `ab ${dayTimeFmt(a.onset)}` : '', a.expires ? `bis ${dayTimeFmt(a.expires)}` : ''].filter(Boolean).join(' ');
        return h('div', { class: `wx-alert wx-alert-${a.severity}`, style: `--sev:${sev.color}`, role: 'note' },
          h('span', { class: 'wx-alert-ico', html: icon('alert', 18) }),
          h('div', {},
            h('p', { class: 'wx-alert-title' }, h('strong', { text: a.event }), h('span', { class: 'wx-alert-level', text: ` · ${sev.label}` })),
            when ? h('p', { class: 'wx-alert-when', text: when }) : null,
            a.description || a.instruction ? h('details', {}, h('summary', { text: 'Details' }),
              a.description ? h('p', { text: a.description }) : null,
              a.instruction ? h('p', { class: 'wx-alert-instr', text: a.instruction }) : null) : null));
      })));
    } else {
      out.push(h('p', { class: 'wx-noalert', html: icon('info', 16) },
        h('span', { text: `Derzeit keine amtlichen Wetterwarnungen${alerts.place ? ` für ${alerts.place}` : ''}.` })));
    }
  }

  // 2. Jetzt
  if (current && current.wind !== null) {
    const ic = wxIcon(current.icon, 30);
    out.push(h('div', { class: 'wx-now' },
      h('div', { class: 'wx-now-wind' },
        h('span', { class: 'wx-now-arrow', html: windArrow(current.dir, 30), title: current.dir !== null ? `Wind aus ${compass(current.dir)}` : '' }),
        h('div', {},
          h('p', { class: 'wx-big' }, h('strong', { text: fmtNum(current.wind) }), h('span', { text: ' km/h' })),
          h('p', { class: 'wx-sub', text: `${beaufort(current.wind)} Bft (${BFT_LABEL[beaufort(current.wind)]})${current.dir !== null ? ` aus ${compass(current.dir)}` : ''}` }),
          current.gust !== null ? h('p', { class: 'wx-sub', text: `Böen ${fmtNum(current.gust)} km/h (${beaufort(current.gust)} Bft)` }) : null)),
      current.temp !== null ? h('div', { class: 'wx-now-temp', title: ic.label },
        h('span', { html: ic.svg }), h('strong', { text: `${fmtNum(current.temp)} °C` }), ic.label ? h('span', { class: 'wx-sub', text: ic.label }) : null) : null));
    out.push(h('p', { class: 'wx-meta', text: `Messung ${timeFmt(current.time)} Uhr${current.station ? ` · DWD-Station ${current.station}` : ''}${current.distance !== null ? ` (${(current.distance / 1000).toLocaleString('de-DE', { maximumFractionDigits: 0 })} km entfernt)` : ''}` }));
  }

  // 3. Vorhersage
  if (hours) {
    const next12 = hours.filter(x => x.t <= Date.now() + 12 * 3600e3);
    const maxGust = Math.max(...next12.map(x => x.gust ?? x.wind));
    if (Number.isFinite(maxGust) && maxGust >= CONFIG.WETTER_GUST_HINT_KMH) {
      out.push(h('div', { class: 'note note-warn', html: icon('alert', 18) },
        h('span', { text: `In den nächsten 12 Stunden Böen bis ${fmtNum(maxGust)} km/h (${beaufort(maxGust)} Bft) erwartet.` })));
    }
    out.push(h('p', { class: 'wx-h4', text: `Wind in den nächsten ${CONFIG.WETTER_HOURS} Stunden` }),
      h('div', { class: 'wx-legend' }, h('span', { class: 'wx-key wx-key-wind' }, 'Wind'), h('span', { class: 'wx-key wx-key-gust' }, 'Böen')),
      ...windChart(hours), hourStrip(hours));
  }

  if (!out.length) out.push(h('p', { class: 'unknown', text: 'Für diesen Ort liegen keine Wetterdaten vor.' }));
  out.push(h('p', { class: 'wx-source', text: 'Datenbasis: Deutscher Wetterdienst (Messungen, MOSMIX-Vorhersage, Warnungen), bereitgestellt über Bright Sky. Angaben ohne Gewähr – vor Fahrtantritt amtliche Warnungen und die Lage vor Ort prüfen.' }));
  return out;
}

// Wind-Diagramm: Wind und Böen (eine Achse, km/h), Richtungspfeile alle 3 h, Linie bei 5 Bft
function windChart(hours) {
  const W = 360, H = 190, L = 34, R = 44, T = 8, B = 46;
  const t0 = hours[0].t, t1 = hours[hours.length - 1].t;
  const top = Math.max(35, ...hours.map(x => x.gust ?? x.wind));
  const step = niceStep(top, 4), hi = Math.ceil(top / step) * step;
  const x = (t) => L + (t - t0) / Math.max(t1 - t0, 1) * (W - L - R);
  const y = (v) => T + (hi - v) / hi * (H - T - B);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'gc-svg', role: 'img',
    'aria-label': `Windvorhersage: Wind bis ${fmtNum(Math.max(...hours.map(x => x.wind)))} km/h, Böen bis ${fmtNum(top)} km/h` });

  for (let v = 0; v <= hi + 1e-9; v += step) {
    svg.append(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'gc-grid' }),
      sText(fmtNum(v), { x: L - 6, y: y(v) + 4, class: 'gc-axis', 'text-anchor': 'end' }));
  }
  // Zeitachse: alle 6 Stunden; um Mitternacht der Wochentag
  const first = new Date(t0); first.setMinutes(0, 0, 0); first.setHours(Math.ceil(first.getHours() / 6) * 6);
  for (let t = first.getTime(); t <= t1; t += 6 * 3600e3) {
    const d = new Date(t);
    const label = d.getHours() === 0 ? d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '') : String(d.getHours());
    svg.append(s('line', { x1: x(t), x2: x(t), y1: T, y2: H - B, class: 'gc-grid' + (d.getHours() === 0 ? ' is-day' : '') }),
      sText(label, { x: x(t), y: H - 6, class: 'gc-axis' + (d.getHours() === 0 ? ' is-day' : ''), 'text-anchor': 'middle' }));
  }
  // 5 Bft
  const ref = BFT_KMH[4];
  if (ref < hi) svg.append(s('line', { x1: L, x2: W - R, y1: y(ref), y2: y(ref), class: 'gc-ref' }), sText('5 Bft', { x: W - R + 4, y: y(ref) + 4, class: 'gc-reflabel' }));

  const line = (key) => hours.filter(p => p[key] !== null).map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p[key]).toFixed(1)}`).join('');
  const area = `M${x(t0).toFixed(1)} ${y(0)}` + hours.map(p => `L${x(p.t).toFixed(1)} ${y(p.wind).toFixed(1)}`).join('') + `L${x(t1).toFixed(1)} ${y(0)}Z`;
  svg.append(s('path', { d: area, class: 'wx-area' }), s('path', { d: line('gust'), class: 'wx-gust' }), s('path', { d: line('wind'), class: 'wx-wind' }));

  // Richtungspfeile unter dem Diagramm
  for (let i = 0; i < hours.length; i += 3) {
    const p = hours[i];
    if (p.dir === null) continue;
    const g = s('g', { transform: `translate(${x(p.t).toFixed(1)} ${H - B + 14}) rotate(${Math.round(p.dir)})`, class: 'wx-dir' });
    g.append(s('path', { d: 'M0 -6V5M-3.5 2 0 6 3.5 2' }));
    svg.append(g);
  }

  // Fadenkreuz + Tooltip
  const cross = s('line', { y1: T, y2: H - B, class: 'gc-cross', visibility: 'hidden' });
  const dW = s('circle', { r: 4, class: 'wx-dot-wind', visibility: 'hidden' });
  const dG = s('circle', { r: 4, class: 'wx-dot-gust', visibility: 'hidden' });
  const hit = s('rect', { x: L, y: 0, width: W - L - R, height: H, fill: 'transparent' });
  svg.append(cross, dG, dW, hit);
  const tip = h('div', { class: 'gc-tip', hidden: true });
  const wrap = h('div', { class: 'gc-wrap' }, svg, tip);
  const move = (clientX) => {
    const r = svg.getBoundingClientRect();
    const t = t0 + (Math.min(Math.max((clientX - r.left) / r.width * W, L), W - R) - L) / (W - L - R) * (t1 - t0);
    let p = hours[0];
    for (const q of hours) if (Math.abs(q.t - t) < Math.abs(p.t - t)) p = q;
    const cx = x(p.t);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    dW.setAttribute('cx', cx); dW.setAttribute('cy', y(p.wind)); dW.setAttribute('visibility', 'visible');
    if (p.gust !== null) { dG.setAttribute('cx', cx); dG.setAttribute('cy', y(p.gust)); dG.setAttribute('visibility', 'visible'); }
    tip.hidden = false;
    tip.textContent = `${dayTimeFmt(p.t)} · Wind ${windText(p.wind, p.dir)}${p.gust !== null ? ` · Böen ${fmtNum(p.gust)} km/h` : ''}`;
    const half = tip.offsetWidth / 2;   // nie über den Rand hinaus
    tip.style.left = `${Math.min(Math.max(cx / W * r.width, half), r.width - half)}px`;
  };
  const leave = () => { for (const e of [cross, dW, dG]) e.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  abfahren(wrap, { zeigen: move, verstecken: leave });

  // Tabelle (alle 3 Stunden)
  const rows = hours.filter((_, i) => i % 3 === 0);
  const table = h('details', { class: 'gc-table' }, h('summary', { text: 'Vorhersage als Tabelle' }),
    h('table', {}, h('thead', {}, h('tr', {}, ['Zeit', 'Wind', 'Böen', 'Temp.', 'Niederschlag'].map(t => h('th', { text: t })))),
      h('tbody', {}, rows.map(p => h('tr', {},
        h('td', { text: dayTimeFmt(p.t) }),
        h('td', { text: windText(p.wind, p.dir) }),
        h('td', { text: p.gust !== null ? `${fmtNum(p.gust)} km/h` : '–' }),
        h('td', { text: p.temp !== null ? `${fmtNum(p.temp)} °C` : '–' }),
        h('td', { text: p.rain !== null ? `${p.rain.toLocaleString('de-DE', { maximumFractionDigits: 1 })} mm` : '–' }))))));
  return [wrap, table];
}

// Kurzübersicht: alle 3 Stunden Symbol, Temperatur, Niederschlag, Wind
function hourStrip(hours) {
  const cells = hours.filter((_, i) => i % 3 === 0).slice(0, 9);
  return h('ol', { class: 'wx-strip', 'aria-label': 'Vorhersage alle drei Stunden' }, cells.map(p => {
    const ic = wxIcon(p.icon, 24);
    return h('li', {},
      h('span', { class: 'wx-strip-time', text: new Date(p.t).getHours() === 0 ? new Date(p.t).toLocaleDateString('de-DE', { weekday: 'short' }) : `${new Date(p.t).getHours()} Uhr` }),
      h('span', { class: 'wx-strip-ico', html: ic.svg, title: ic.label }),
      h('span', { class: 'wx-strip-temp', text: p.temp !== null ? `${fmtNum(p.temp)}°` : '–' }),
      h('span', { class: 'wx-strip-rain', text: p.prob !== null && p.prob >= 20 ? `${fmtNum(p.prob)} %` : p.rain ? `${p.rain.toLocaleString('de-DE', { maximumFractionDigits: 1 })} mm` : '' }),
      h('span', { class: 'wx-strip-wind', html: windArrow(p.dir, 14) }, h('span', { text: `${beaufort(p.wind)} Bft` })));
  }));
}
