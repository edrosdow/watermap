"""Ordnet jedem Hex-Wert im CSS den nächsten Farb-Token zu (CIE76 ΔE in Lab).
Aufruf: python3 -I scripts/farben_tokens.py public/css [--anwenden <maxDE>]
Ohne --anwenden nur Bericht. Mit --anwenden werden Werte mit ΔE <= maxDE durch var(--wm-…) ersetzt.
tokens.css und bausteine.css bleiben unberührt; #fff/#ffffff bleibt (Weiß auf Farbe ist erlaubt)."""
import re, sys, pathlib, collections

ORDNER = pathlib.Path(sys.argv[1])
ANWENDEN = '--anwenden' in sys.argv
MAX_DE = float(sys.argv[sys.argv.index('--anwenden') + 1]) if ANWENDEN else 0
DATEIEN = ['app.css', 'pegel.css', 'ampel.css', 'bereiche.css', 'naehe.css', 'nav.css', 'chart.css']

tok = {}
for m in re.finditer(r'--(wm-[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\b', (ORDNER / 'tokens.css').read_text(encoding='utf-8')):
    tok[m.group(1)] = m.group(2).upper()
tok.pop('wm-flaeche', None)  # Weiß nicht als Ziel für Fast-Weiß-Töne verwenden, die sind meist flaeche-2/wasser-2

def rgb(h):
    h = h.lstrip('#')
    if len(h) == 3: h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

def lab(h):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb(h))
    x, y, z = (r * .4124 + g * .3576 + b * .1805) / .95047, r * .2126 + g * .7152 + b * .0722, (r * .0193 + g * .1192 + b * .9505) / 1.08883
    f = lambda t: t ** (1 / 3) if t > .008856 else 7.787 * t + 16 / 116
    return 116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))

def de(a, b):
    return sum((p - q) ** 2 for p, q in zip(lab(a), lab(b))) ** .5

def naechster(h):
    return min(((de(h, v), k) for k, v in tok.items()), key=lambda t: t[0])

HEX = re.compile(r'#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b')
zahl, bericht, ersetzt = collections.Counter(), {}, collections.Counter()
for d in DATEIEN:
    p = ORDNER / d; text = p.read_text(encoding='utf-8')
    def ersetze(m):
        h = '#' + m.group(1).upper()
        if h in ('#FFF', '#FFFFFF'): return m.group(0)
        zahl[h] += 1
        d_, k = naechster(h); bericht[h] = (d_, k)
        # nicht in Variablen-Definitionen der alten Namen (--navy: #…) – die zeigen schon auf Tokens bzw. bleiben bewusst
        if ANWENDEN and d_ <= MAX_DE:
            ersetzt[h] += 1
            return f'var(--{k})'
        return m.group(0)
    neu = HEX.sub(ersetze, text)
    if ANWENDEN and neu != text: p.write_text(neu, encoding='utf-8', newline='')

for h, n in sorted(zahl.items(), key=lambda t: bericht[t[0]][0]):
    d_, k = bericht[h]
    print(f'{h}  {n:3d}x  → --{k:16s} ΔE {d_:5.1f}' + ('  ersetzt' if ersetzt[h] else ''))
print('Summe Werte:', sum(zahl.values()), '· ersetzt:', sum(ersetzt.values()))
