// „Heute vor Ort“: stündlich abgelaufene Meldungen und Sperr-Einträge (Geräte-/IP-Hashes älter als 24 h) löschen.
// Läuft nur auf der veröffentlichten Seite; zusätzlich räumt jeder Zugriff abgelaufene Meldungen eines Standorts auf.
import { getStore } from '@netlify/blobs';
import { meldungenApi } from '../lib/meldungen-kern.mjs';
import { storeName } from './meldungen.mjs';

export const config = { schedule: '@hourly' };

export default async () => {
  const api = meldungenApi({ store: getStore(storeName()), jetzt: () => Date.now(), salz: '', standortGibtEs: async () => false, neueId: () => '' });
  const r = await api.aufraeumen();
  console.log(`Meldungen aufgeräumt: ${r.geloescht} Sperr-Einträge gelöscht`);
};
