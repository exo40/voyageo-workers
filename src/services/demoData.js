'use strict';
/** Données de DÉMONSTRATION entièrement fictives (compagnies, bus, trajets, horaires). Passe par le contrat db : fonctionne avec tout adaptateur. */
const db = require('../db');
const { todayStr, addDays } = require('../utils/time');

const PAIRS = [
  // [ville A, ville B, durée (min), tarif A, tarif B, B dessert aussi ?]
  ['Cotonou', 'Porto-Novo', 60, 1500, 1700, true],
  ['Cotonou', 'Abomey-Calavi', 35, 500, 600, false],
  ['Cotonou', 'Bohicon', 125, 3000, 3200, true],
  ['Cotonou', 'Parakou', 390, 8000, 8500, true],
  ['Porto-Novo', 'Parakou', 450, 9000, 9500, false],
  ['Bohicon', 'Parakou', 270, 5000, 5300, true],
];
// Lieux d'embarquement fictifs (liens de recherche Google Maps : l'administrateur peut les remplacer par le lien exact).
const GARES = {
  'Cotonou': 'Gare routière de Cotonou (Jonquet)', 'Porto-Novo': 'Gare routière de Porto-Novo', 'Abomey-Calavi': 'Carrefour Godomey, Abomey-Calavi',
  'Bohicon': 'Gare routière de Bohicon', 'Parakou': 'Gare routière de Parakou',
};
const mapsSearch = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q + ', Bénin')}`;
const addMin = (hhmm, m) => { const [h, mi] = hhmm.split(':').map(Number); const t = (h * 60 + mi + m) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

async function seedIfEmpty({ days = 14 } = {}) {
  if ((await db.listCompagnies()).length) return false;
  const A = await db.createCompagnie({ nom: 'Compagnie Test A', telephone: '+229 01 00 00 00 01', email: 'contact-a@exemple.com', adresse: 'Cotonou (adresse fictive)' });
  const B = await db.createCompagnie({ nom: 'Compagnie Test B', telephone: '+229 01 00 00 00 02', email: 'contact-b@exemple.com', adresse: 'Porto-Novo (adresse fictive)' });
  // Un bus ne peut pas faire deux voyages en même temps (règle de la base MySQL) : un bus fictif par liaison et par créneau horaire.
  const busCount = { A: 0, B: 0 };
  const busFor = async (co, key, slot) => {
    busCount[key] += 1;
    const climatise = slot % 2 === 0;
    const places = { A: [30, 28], B: [28, 24] }[key][slot % 2];
    return db.createBus({ id_compagnie: co.id_compagnie, immatriculation: `DEMO-${key}-${String(busCount[key]).padStart(3, '0')}`, nombre_places: places, type: climatise ? 'Climatisé' : 'Standard' });
  };
  const drivers = {
    A: [await db.createChauffeur({ id_compagnie: A.id_compagnie, prenom: 'Koffi' }), await db.createChauffeur({ id_compagnie: A.id_compagnie, prenom: 'Cossi' })],
    B: [await db.createChauffeur({ id_compagnie: B.id_compagnie, prenom: 'Séraphin' }), await db.createChauffeur({ id_compagnie: B.id_compagnie, prenom: 'Romaric' })],
  };
  const today = todayStr();
  let count = 0;
  for (const [a, b, duree, tarifA, tarifB, bAussi] of PAIRS) {
    const plans = [{ co: A, key: 'A', tarif: tarifA, heures: ['07:00', '13:00'] }];
    if (bAussi) plans.push({ co: B, key: 'B', tarif: tarifB, heures: ['09:30', '15:30'] });
    for (const plan of plans) {
      for (const [from, to] of [[a, b], [b, a]]) {
        const slotBuses = await Promise.all(plan.heures.map((_, i) => busFor(plan.co, plan.key, i)));
        const t = await db.createTrajet({ id_compagnie: plan.co.id_compagnie, ville_depart: from, ville_arrivee: to, duree_estimee: duree, lieu_embarquement: GARES[from] || null, lien_maps: GARES[from] ? mapsSearch(GARES[from]) : null });
        for (let d = 0; d < days; d++) {
          for (let i = 0; i < plan.heures.length; i++) {
            const heure = plan.heures[i];
            await db.createHoraire({ id_trajet: t.id_trajet, id_bus: slotBuses[i].id_bus, id_chauffeur: drivers[plan.key][i % 2].id_chauffeur, date_depart: addDays(today, d), heure_depart: heure, heure_arrivee: addMin(heure, duree), tarif_fcfa: plan.tarif });
            count++;
          }
        }
      }
    }
  }
  console.log(`[démo] données fictives créées : 2 compagnies, ${busCount.A + busCount.B} bus, ${count} départs sur ${days} jours.`);
  return true;
}
module.exports = { seedIfEmpty };
