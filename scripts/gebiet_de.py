#!/usr/bin/env python3
"""Erzeugt public/data/gebiet-de.json – das Kartengebiet von WaterMap (Maske, Kachelauswahl, Prüfung der Suchtreffer).

Erlaubt ist:
  * Deutschland mit Küstenmeer (12 sm) – OSM-Grenze, mit schmalem Saum, damit Grenzflüsse ganz sichtbar sind
  * der ganze Bodensee
  * die offene See von Nord- und Ostsee im Umkreis von gut 100 km um das deutsche Gebiet
Nicht erlaubt (Maske) ist fremdes Land – genau an der OSM-Landgrenze, auch fremde Inseln (z. B. Lolland, Texel).

Quellen (kostenlos, Lizenzen passen zur App):
  * geo-maps v0.6.0 (OpenStreetMap, ODbL): countries-maritime-10m.geo.json und countries-land-10m.geo.json
    https://github.com/simonepri/geo-maps/releases/tag/v0.6.0
  * Natural Earth (gemeinfrei): ne_10m_lakes.geojson (nur Bodensee)
    https://github.com/nvkelso/natural-earth-vector/tree/master/geojson

Aufruf (braucht shapely):  python3 scripts/gebiet_de.py <ordner-mit-den-drei-dateien>
"""
import json, math, sys, pathlib
from shapely.geometry import shape, box, Point, Polygon, MultiPolygon
from shapely.ops import unary_union
from shapely.validation import make_valid
from shapely import prepared

ROH = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
ZIEL = pathlib.Path(__file__).resolve().parent.parent / 'public/data/gebiet-de.json'
REGION = box(2.5, 45.5, 20.5, 58.0)   # nur hier wird gerechnet (Kartenrahmen + Rand)
SAUM = 0.005                          # ≈ 0,4–0,55 km über die Landgrenze (Grenzflüsse wie Rhein, Oder ganz sichtbar)
MEER_UMKREIS = 1.0                    # ≈ 65–110 km offene See um das deutsche Gebiet
GENAU, GROB = 0.0003, 0.0015          # Vereinfachung: deutsche Grenze ≈ 30 m, fremde Küsten/offene See ≈ 150 m
KLEIN = 3e-4                          # fremde Inselchen unter ≈ 2 km² und Kleinstflächen bleiben unmaskiert (spart Daten)


def teile(g):
    return list(g.geoms) if hasattr(g, 'geoms') else [g]


def im_ausschnitt(geom):
    """Nur Polygonteile, die die Region berühren (schnell auch bei Russland, Norwegen …)."""
    ps = [p for p in teile(geom) if p.intersects(REGION)]
    return make_valid(MultiPolygon(ps)).intersection(REGION) if ps else None


maritim = json.load(open(ROH / 'countries-maritime-10m.geo.json'))
de = make_valid(next(shape(f['geometry']) for f in maritim['features'] if f['properties'].get('A3') == 'DEU'))
del maritim

land = json.load(open(ROH / 'countries-land-10m.geo.json'))
fremd = []
for f in land['features']:
    if f['properties'].get('A3') == 'DEU': continue
    g = shape(f['geometry'])
    if not g.intersects(REGION): continue
    g = im_ausschnitt(g)
    if g and not g.is_empty: fremd.append(g.simplify(GROB / 2, preserve_topology=True))
del land
fremd = unary_union(fremd)

seen = json.load(open(ROH / 'ne_10m_lakes.geojson'))
# Bodensee: ganzer See (OSM teilt ihn zwischen DE und CH); um ~200 m verkleinert, damit fremde Ufer bedeckt bleiben
bodensee = next(shape(f['geometry']) for f in seen['features'] if shape(f['geometry']).contains(Point(9.4, 47.6))).buffer(-0.0025)

deutsch = unary_union([de, bodensee]).buffer(SAUM, join_style=2, resolution=2).simplify(GENAU, preserve_topology=True)
meer = de.buffer(MEER_UMKREIS, resolution=4).intersection(REGION).difference(fremd)
# nur Flächen, die mit Deutschland bzw. dessen Küstenmeer zusammenhängen (also Nord- und Ostsee) – keine fremden Binnenseen
meer = unary_union([p for p in teile(meer) if p.intersects(de)]).simplify(GROB, preserve_topology=True)
erlaubt = make_valid(unary_union([deutsch, meer]))
polys = [p for p in teile(erlaubt) if isinstance(p, Polygon) and p.area > KLEIN]
erlaubt = MultiPolygon(polys)

r4 = lambda v: round(v, 4)
ringe = []
for p in polys:
    ringe.append([[r4(y), r4(x)] for x, y in p.exterior.coords])
    for i in p.interiors:
        if Polygon(i).area > KLEIN: ringe.append([[r4(y), r4(x)] for x, y in i.coords])

# Kartenkacheln, die das Gebiet berühren (z 5–10); ab z 11 entscheidet die Vorfahrenkachel auf z 10
pe = prepared.prep(erlaubt.buffer(0.01))
def kachel_box(x, y, z):
    n = 2 ** z
    lat = lambda yy: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yy / n))))
    return box(x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180, lat(y))
def kachel(lon, lat, z):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
w, s, e, n = erlaubt.bounds
kacheln = {}
for z in range(5, 11):
    (x0, y0), (x1, y1) = kachel(w, n, z), kachel(e, s, z)
    kacheln[z] = ' '.join(f'{x}/{y}' for x in range(x0, x1 + 1) for y in range(y0, y1 + 1) if pe.intersects(kachel_box(x, y, z)))

dw, ds, dE, dn = de.bounds
ZIEL.write_text(json.dumps({
    'quelle': 'Grenzen © OpenStreetMap-Mitwirkende (ODbL) über geo-maps v0.6.0 (countries-maritime-10m, countries-land-10m); '
              'Bodensee: Natural Earth (gemeinfrei); erzeugt mit scripts/gebiet_de.py',
    'deutschland': [[r4(ds), r4(dw)], [r4(dn), r4(dE)]],
    'ringe': ringe,
    'kacheln': kacheln,
}, separators=(',', ':'), ensure_ascii=False))
print(f'{ZIEL}: {len(ringe)} Ringe, {sum(map(len, ringe))} Punkte, {ZIEL.stat().st_size // 1024} KB; Deutschland {de.bounds}')
for z, v in kacheln.items(): print(f'  z{z}: {len(v.split())} Kacheln')
