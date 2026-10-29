// „Als Bild teilen“: ein Bild (1080 × 1350) mit Name, Gewässer, Wert, Zustand, Mini-Kurve (7 Tage, Vorhersage gestrichelt),
// Datum/Uhrzeit, „WaterMap“ und Quellenangabe. Teilen über die Web Share API (Datei), sonst Herunterladen.
const W = 1080, H = 1350;
const FARBE = { low: '#FAB219', normal: '#6CBF84', high: '#EC835A', hsw: '#D03B3B' };
const TEXT = { low: 'Niedrig', normal: 'Normal', high: 'Hoch', hsw: 'Über HSW', tide: 'Tide', old: 'Veraltet' };

function rundRechteck(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

/** Zeichnet das Bild; zustand: Schlüssel wie zustand(g). Rückgabe: Canvas. */
export function pegelBild({ g, zustand, trend = '', pts = [], wv = [], jetzt = Date.now() }) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const font = (px, w = 700) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  c.fillStyle = '#F3F6F8'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#0B3045'; c.fillRect(0, 0, W, 420);
  c.fillStyle = '#9CCEE3'; c.font = font(38, 800); c.fillText(`PEGEL · ${(g.water || '').toUpperCase()}`, 80, 130);
  c.fillStyle = '#fff'; c.font = font(92, 800); c.fillText(g.name, 80, 240, W - 160);
  c.fillStyle = '#C5D8E1'; c.font = font(36, 500);
  c.fillText(`Stand ${new Date(g.time || jetzt).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} Uhr`, 80, 320);
  // Wert und Zustand
  c.fillStyle = '#0B3045'; c.font = font(220, 800);
  const wert = Math.round(g.value).toLocaleString('de-DE');
  c.fillText(wert, 80, 690);
  const ww = c.measureText(wert).width;
  c.font = font(64, 700); c.fillText(g.unit || 'cm', 100 + ww, 690);
  const farbe = FARBE[zustand] || '#9AAAB5', label = TEXT[zustand] || 'ohne Einordnung';
  c.font = font(46, 800); const lw = c.measureText(label).width;
  rundRechteck(c, 80, 740, lw + 80, 84, 42); c.fillStyle = farbe; c.fill();
  c.fillStyle = zustand === 'hsw' ? '#fff' : '#0B3045'; c.fillText(label, 120, 798);
  if (trend) { c.fillStyle = '#3D5160'; c.font = font(42, 700); c.fillText(trend, 80 + lw + 120, 798, W - lw - 280); }
  // Kurve
  const alle = [...pts, ...wv.filter(p => p.t > (pts[pts.length - 1]?.t ?? 0))];
  if (alle.length > 1) {
    const x0 = 80, x1 = W - 80, y0 = 900, y1 = 1115;
    const vs = alle.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), sp = Math.max(hi - lo, 10);
    const t0 = alle[0].t, t1 = alle[alle.length - 1].t;
    const x = (t) => x0 + (t - t0) / Math.max(t1 - t0, 1) * (x1 - x0), y = (v) => y1 - (v - lo) / sp * (y1 - y0);
    rundRechteck(c, 50, 860, W - 100, 330, 32); c.fillStyle = '#fff'; c.fill();
    c.lineWidth = 7; c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = '#1F6FB2';
    c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(x(p.t), y(p.v)) : c.moveTo(x(p.t), y(p.v)))); c.stroke();
    if (wv.length && pts.length) {
      c.setLineDash([18, 14]); c.beginPath(); const l = pts[pts.length - 1]; c.moveTo(x(l.t), y(l.v));
      wv.filter(p => p.t > l.t).forEach(p => c.lineTo(x(p.t), y(p.v))); c.stroke(); c.setLineDash([]);
    }
    const l = pts[pts.length - 1];
    if (l) { c.fillStyle = '#1F6FB2'; c.beginPath(); c.arc(x(l.t), y(l.v), 12, 0, 2 * Math.PI); c.fill(); }
    c.fillStyle = '#5A6B77'; c.font = font(30, 600);
    c.fillText(wv.length ? '7 Tage gemessen · Vorhersage gestrichelt' : '7 Tage gemessen', 80, 1180);
  }
  // Fuß
  c.fillStyle = '#0B3045'; c.font = font(52, 800); c.fillText('WaterMap', 80, 1280);
  c.fillStyle = '#5A6B77'; c.font = font(28, 500); c.textAlign = 'right';
  c.fillText('Daten: WSV/PEGELONLINE · ohne Gewähr', W - 80, 1280); c.textAlign = 'left';
  return cv;
}

/** Bild teilen (Datei über die Web Share API) oder herunterladen. Rückgabe: 'geteilt' | 'geladen' | 'abgebrochen'. */
export async function bildTeilen(cv, dateiname, titel) {
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Das Bild konnte nicht erzeugt werden.');
  const datei = new File([blob], dateiname, { type: 'image/png' });
  if (navigator.canShare?.({ files: [datei] })) {
    try { await navigator.share({ files: [datei], title: titel }); return 'geteilt'; }
    catch (e) { if (e.name === 'AbortError') return 'abgebrochen'; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: dateiname });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'geladen';
}
