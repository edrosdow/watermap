// Pegel-Ampel: reine Bewertungslogik (ohne Oberfläche, im Test direkt prüfbar).
// Wichtig: Der Pegelstand ist NICHT die Wassertiefe. Verglichen wird nur mit dem Mindestpegel,
// den der Nutzer aus Erfahrung kennt („ab diesem Pegel komme ich durch“) – nie mit dem Tiefgang.

export const PUFFER_CM = 20;          // Reserve über dem Mindestpegel, ab der es „grün“ ist
export const TREND_STUNDEN = 24;      // Zeitraum für den Trend
export const TREND_GLEICH_CM = 2;     // Änderung in 24 h unter ±2 cm gilt als gleichbleibend
export const PROGNOSE_TAGE = 3;       // so weit wird der Trend linear fortgeschrieben
const MIN_SPANNE_STUNDEN = 6;         // kürzere Messreihen ergeben keinen belastbaren Trend

export const STATUS = {
  gruen:     { label: 'Heute befahrbar', rang: 0 },
  gelb:      { label: 'Knapp', rang: 1 },
  rot:       { label: 'Nicht befahrbar', rang: 2 },
  unbekannt: { label: 'Keine Bewertung möglich', rang: -1 },
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
  let status;
  if (reserve < 0) {
    status = 'rot';
    hinweise.push(`Der Pegel liegt ${fmt(reserve)} cm unter deinem Mindestpegel.`);
    if (tr?.richtung === 'steigend') {
      const tage = -reserve / tr.cmProTag;
      if (tage <= PROGNOSE_TAGE) hinweise.push(`Der Pegel steigt. Bleibt der Trend so, ist dein Mindestpegel in etwa ${tageText(tage)} erreicht.`);
    }
  } else if (reserve < puffer) {
    status = 'gelb';
    hinweise.push(`Nur ${fmt(reserve)} cm über deinem Mindestpegel – weniger als ${puffer} cm Reserve.`);
  } else {
    status = 'gruen';
    hinweise.push(`${fmt(reserve)} cm Reserve über deinem Mindestpegel.`);
  }
  if (tr?.richtung === 'fallend' && reserve >= 0) {
    const prognose = pegel.value + tr.cmProTag * PROGNOSE_TAGE;
    if (prognose < mindest) {
      if (status === 'gruen') status = 'gelb';
      hinweise.push(`Der Pegel fällt um etwa ${fmt(tr.cmProTag)} cm pro Tag. Bleibt das so, unterschreitet er deinen Mindestpegel in etwa ${tageText(reserve / -tr.cmProTag)}.`);
    } else {
      hinweise.push(`Der Pegel fällt um etwa ${fmt(tr.cmProTag)} cm pro Tag.`);
    }
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
  if (ctx.pegel?.state === 'old') hinweise.unshift('Achtung: Der letzte Messwert ist älter als einige Stunden.');
  return { status, reserve: teile[0]?.reserve ?? null, hinweise: hinweise.slice(0, 3) };
}

function tageText(tage) {
  if (tage < 1) return `${Math.max(1, Math.round(tage * 24))} Stunden`;
  const n = Math.round(tage * 2) / 2;
  return `${n.toLocaleString('de-DE')} ${n === 1 ? 'Tag' : 'Tagen'}`;
}
