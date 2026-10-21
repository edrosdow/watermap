// Pegel-Ampel: reine Bewertungslogik (ohne Oberfläche, im Test direkt prüfbar).
// Wichtig: Der Pegelstand ist NICHT die Wassertiefe. Verglichen wird nur mit dem Mindestpegel,
// den der Nutzer aus Erfahrung kennt („ab diesem Pegel komme ich durch“) – nie mit dem Tiefgang.

export const PUFFER_CM = 20;          // Reserve über dem Mindestpegel, ab der es „grün“ ist
export const TREND_STUNDEN = 24;      // Zeitraum für den Trend
export const TREND_GLEICH_CM = 2;     // Änderung in 24 h unter ±2 cm gilt als gleichbleibend
export const PROGNOSE_TAGE = 3;       // so weit wird der Trend linear fortgeschrieben
const MIN_SPANNE_STUNDEN = 6;         // kürzere Messreihen ergeben keinen belastbaren Trend

export const STATUS = {
  gruen:     { label: 'Heute befahrbar', titel: 'Gute Bedingungen für dein Boot', rang: 0 },
  gelb:      { label: 'Knapp', titel: 'Es wird knapp – plane mit Vorsicht', rang: 1 },
  rot:       { label: 'Nicht befahrbar', titel: 'Heute besser nicht aufs Wasser', rang: 2 },
  unbekannt: { label: 'Keine Bewertung', titel: 'Mindestpegel eingeben', rang: -1 },
};

export const BOOTSTYPEN = { motor: 'Motorboot', segel: 'Segelboot', kanu: 'Kanu/SUP' };

const fmt = (v) => Math.round(Math.abs(v)).toLocaleString('de-DE');

/**
 * Trend aus der Messreihe der letzten 24 h (Punkte {t, v}, aufsteigend sortiert).
 * Liefert { richtung: 'steigend'|'gleich'|'fallend', cmProTag } oder null, wenn die Daten nicht reichen.
 */
export function trend(punkte, stunden = TREND_STUNDEN) {
  if (!Array.isArray(punkte) || punkte.length < 2) return null;
  const letzter = punkte[punkte.length - 1];
  const ab = letzter.t - stunden * 3600e3;
  const erster = punkte.find(p => p.t >= ab);
  if (!erster || erster === letzter) return null;
  const spanne = (letzter.t - erster.t) / 3600e3;
  if (spanne < MIN_SPANNE_STUNDEN) return null;
  const cmProTag = (letzter.v - erster.v) / spanne * 24;
  const richtung = Math.abs(cmProTag) < TREND_GLEICH_CM ? 'gleich' : cmProTag > 0 ? 'steigend' : 'fallend';
  return { richtung, cmProTag };
}

/**
 * Eine Prüfung bekommt den Kontext und liefert { status, hinweise[] } (oder null = nicht zuständig).
 * Weitere Prüfungen (z. B. Brücken-Durchfahrtshöhe) können später an PRUEFUNGEN angehängt werden.
 */
export function pruefePegel({ pegel, mindest, trend: tr = null, puffer = PUFFER_CM }) {
  if (!pegel || typeof pegel.value !== 'number' || !Number.isFinite(mindest)) {
    return { status: 'unbekannt', reserve: null, hinweise: [] };
  }
  const reserve = pegel.value - mindest;
  const hinweise = [];
  const ok = (text) => hinweise.push({ typ: 'ok', text });
  const warn = (text) => hinweise.push({ typ: 'warn', text });
  const bad = (text) => hinweise.push({ typ: 'bad', text });
  let status;
  if (reserve < 0) {
    status = 'rot';
    bad(`Pegel ${fmt(reserve)} cm unter deinem Mindestpegel`);
  } else if (reserve < puffer) {
    status = 'gelb';
    warn(`Nur ${fmt(reserve)} cm über deinem Mindestpegel`);
  } else {
    status = 'gruen';
    ok(`${fmt(reserve)} cm über deinem Mindestpegel`);
  }
  const rate = tr ? tr.cmProTag : 0;
  if (tr?.richtung === 'fallend' && reserve >= 0) {
    const bisMin = reserve / -rate;
    if (bisMin <= PROGNOSE_TAGE) {
      if (status === 'gruen') status = 'gelb';
      warn(`Pegel sinkt – in ca. ${tageText(bisMin)} unter deinem Minimum`);
    } else if (status === 'gruen' && (reserve - puffer) / -rate <= PROGNOSE_TAGE) {
      warn(`Pegel sinkt – in ca. ${tageText((reserve - puffer) / -rate)} wird es knapp`);
    } else {
      warn(`Pegel sinkt um etwa ${fmt(rate)} cm pro Tag`);
    }
  } else if (tr?.richtung === 'steigend') {
    const bisMin = -reserve / rate;
    if (status === 'rot' && bisMin <= PROGNOSE_TAGE) warn(`Pegel steigt – in ca. ${tageText(bisMin)} wieder über deinem Minimum`);
    else ok(`Pegel steigt um etwa ${fmt(rate)} cm pro Tag`);
  } else if (tr?.richtung === 'gleich') {
    ok('Pegel bleibt etwa gleich');
  }
  return { status, reserve, hinweise };
}

export const PRUEFUNGEN = [pruefePegel];

/** Gesamtergebnis: der schlechteste Status aller Prüfungen, Hinweise zusammengeführt (höchstens 3). */
export function bewerte(ctx, pruefungen = PRUEFUNGEN) {
  const teile = pruefungen.map(p => p(ctx)).filter(Boolean);
  const bewertet = teile.filter(t => t.status !== 'unbekannt');
  const status = bewertet.length
    ? bewertet.reduce((a, t) => (STATUS[t.status].rang > STATUS[a].rang ? t.status : a), 'gruen')
    : 'unbekannt';
  const hinweise = teile.flatMap(t => t.hinweise);
  if (ctx.pegel?.state === 'old') hinweise.unshift({ typ: 'warn', text: 'Letzter Messwert ist mehrere Stunden alt' });
  return { status, reserve: teile[0]?.reserve ?? null, hinweise: hinweise.slice(0, 3) };
}

function tageText(tage) {
  if (tage < 1) return `${Math.max(1, Math.round(tage * 24))} Stunden`;
  const n = Math.round(tage * 2) / 2;
  return `${n.toLocaleString('de-DE')} ${n === 1 ? 'Tag' : 'Tagen'}`;
}
