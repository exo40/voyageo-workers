'use strict';
/**
 * Assistant Voyagéo : bot à règles (aucune clé d'API, aucun service externe).
 * Il comprend des mots-clés en français, répond avec les VRAIES données du site (villes, horaires, tarifs,
 * lieux d'embarquement) et propose toujours de poursuivre avec le service client WhatsApp.
 */
const config = require('../config');
const db = require('../db');
const v = require('../utils/validate');
const catalog = require('./catalogService');
const payments = require('./paymentService');
const { todayStr, departureTime } = require('../utils/time');

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').toLowerCase();
const has = (text, ...words) => words.some((w) => (w instanceof RegExp ? w.test(text) : text.includes(w)));
const fmtFCFA = (n) => `${new Intl.NumberFormat('fr-FR').format(n).replace(/[  ]/g, ' ')} FCFA`;

const SUGGESTIONS = ['Comment réserver ?', 'Horaires et tarifs', 'Où embarquer ?', 'Annuler un ticket', 'Parler au service client'];
const out = (texte, extra = {}) => ({ texte, suggestions: extra.suggestions || SUGGESTIONS.slice(0, 3), liens: extra.liens || [], whatsapp: true });

/** Villes citées dans le message (dans l'ordre où elles apparaissent). */
async function citiesIn(raw) {
  const text = v.normCity(raw);
  const found = [];
  for (const name of await catalog.villes()) {
    const idx = text.indexOf(v.normCity(name));
    if (idx >= 0) found.push({ name, idx });
  }
  return found.sort((a, b) => a.idx - b.idx).map((c) => c.name);
}

async function upcoming(filter) {
  const today = todayStr();
  const list = await db.listHoraires({ date_min: today });
  return list.filter((h) => h.statut === 'programme' && catalog.isSellable(h) && departureTime(h.date_depart, h.heure_depart) > Date.now() && filter(h));
}

async function routeAnswer(from, to) {
  const list = (await upcoming((h) => v.normCity(h.ville_depart) === v.normCity(from) && v.normCity(h.ville_arrivee) === v.normCity(to))).slice(0, 4);
  const liens = [{ label: `Voir tous les voyages ${from} → ${to}`, href: `/trajets.html?depart=${encodeURIComponent(from)}&arrivee=${encodeURIComponent(to)}&date=${todayStr()}` }];
  if (!list.length) return out(`Je ne trouve pas de voyage programmé de ${from} vers ${to} pour le moment. Essayez une autre date sur la page de recherche, ou contactez notre service client.`, { liens });
  const lignes = list.map((h) => `• ${h.date_depart.split('-').reverse().join('/')} à ${h.heure_depart} : ${h.compagnie_nom}, ${fmtFCFA(h.tarif_fcfa)}, ${Math.max(0, h.nombre_places - h.places_occupees)} place(s) libre(s)`);
  const lieu = list[0].lieu_embarquement;
  if (lieu) {
    liens.push({ label: `Embarquement : ${lieu}`, href: list[0].lien_maps || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lieu} ${from}`)}` });
  }
  return out(`Prochains départs de ${from} vers ${to} :\n${lignes.join('\n')}${lieu ? `\n\nLieu d'embarquement : ${lieu}.` : ''}`, { liens, suggestions: ['Comment réserver ?', 'Annuler un ticket'] });
}

async function boardingAnswer(cities) {
  const trajets = await db.listTrajets({});
  const seen = new Map();
  for (const t of trajets) {
    if (!t.lieu_embarquement) continue;
    if (cities.length && !cities.some((c) => v.normCity(c) === v.normCity(t.ville_depart))) continue;
    const key = `${v.normCity(t.ville_depart)}|${v.normCity(t.lieu_embarquement)}`;
    if (!seen.has(key)) seen.set(key, t);
  }
  const items = [...seen.values()].slice(0, 6);
  if (!items.length) {
    return out(cities.length
      ? `Le lieu d'embarquement à ${cities[0]} n'est pas encore renseigné. Contactez le service client pour le connaître.`
      : "Les lieux d'embarquement sont indiqués sur chaque voyage et sur votre ticket. Dites-moi votre ville de départ (par exemple « embarquement à Cotonou »).");
  }
  const liens = items.map((t) => ({
    label: `${t.ville_depart} : ${t.lieu_embarquement}`,
    href: t.lien_maps || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${t.lieu_embarquement} ${t.ville_depart}`)}`,
  }));
  return out(`Voici où embarquer${cities.length ? ` à ${cities[0]}` : ''}. Touchez un lien pour ouvrir l'emplacement dans Google Maps :`, { liens, suggestions: ['Horaires et tarifs', 'Comment réserver ?'] });
}

async function reply(message) {
  const raw = String(message || '').trim().slice(0, 300);
  if (!raw) return out('Posez-moi votre question, par exemple « Cotonou Parakou » pour voir les prochains départs.');
  const text = norm(raw);
  const cities = await citiesIn(raw);
  const wa = { label: 'Contacter le service client sur WhatsApp', href: `https://wa.me/${config.whatsapp.number}` };

  if (has(text, 'service client', 'humain', 'conseiller', 'agent', 'whatsapp', 'appeler', 'telephone', 'numero', 'contact', 'joindre', 'parler')) {
    return out(`Notre service client vous répond sur WhatsApp au ${config.whatsapp.display}. Écrivez-nous : nous vous aiderons avec votre réservation.`, { liens: [wa] });
  }
  if (has(text, 'annul', 'rembours')) {
    return out(`Vous pouvez annuler un ticket depuis « Mes réservations », jusqu'à ${config.reservation.annulationHeures} h avant le départ. Passé ce délai, l'annulation n'est plus possible en ligne : contactez le service client. Pour un remboursement, contactez la compagnie.`, { liens: [{ label: 'Mes réservations', href: '/mes-reservations.html' }], suggestions: ['Comment réserver ?', 'Parler au service client'] });
  }
  if (has(text, 'embarqu', 'gare', 'maps', 'localis', 'adresse', 'ou prendre', 'ou est le bus', 'point de depart', 'point de rendez', 'itineraire') || (has(text, /\bou\b/) && has(text, 'bus', 'depart', 'prendre'))) {
    return boardingAnswer(cities);
  }
  if (cities.length >= 2) return routeAnswer(cities[0], cities[1]);
  if (cities.length === 1 && has(text, 'depuis', 'de ', 'a partir', 'depart', 'partir')) {
    return out(`Pour quelle destination au départ de ${cities[0]} ? Par exemple : « ${cities[0]} ${cities[0] === 'Cotonou' ? 'Parakou' : 'Cotonou'} ».`, { suggestions: ['Où embarquer ?', 'Horaires et tarifs'] });
  }
  if (has(text, 'reserv', 'acheter', 'billet', 'ticket pour', 'prendre un ticket', 'comment faire', 'comment voyager', 'commander')) {
    const paiement = payments.info().requis ? `Vous avez ${config.reservation.attenteMinutes} minutes pour payer par Mobile Money, sinon la place est libérée.` : 'Votre réservation est confirmée immédiatement.';
    return out(`Réserver est simple :\n1. Choisissez départ, destination et date.\n2. Sélectionnez le voyage et votre place.\n3. Renseignez les informations du voyageur.\n4. Recevez votre ticket numérique avec QR code.\n\n${paiement} Un compte est nécessaire pour réserver.`, { liens: [{ label: 'Rechercher un trajet', href: '/trajets.html' }, { label: 'Créer un compte', href: '/inscription.html' }], suggestions: ['Horaires et tarifs', 'Où embarquer ?'] });
  }
  if (has(text, 'paiement', 'payer', 'mobile money', 'momo', 'mtn', 'moov', 'celtiis', 'carte')) {
    const p = payments.info();
    return out(p.requis ? `Le paiement se fait en ligne par Mobile Money au moment de la réservation. Vous avez ${config.reservation.attenteMinutes} minutes pour payer, sinon la place est libérée.` : "Pour l'instant, la réservation est confirmée sans paiement en ligne. Pour toute question sur le règlement, contactez le service client.");
  }
  if (has(text, 'qr', 'verifier', 'valide', 'mon ticket', 'imprimer', 'pdf', 'ticket')) {
    return out("Retrouvez vos tickets dans « Mes réservations » : vous pouvez les imprimer ou les enregistrer en PDF. Le QR code sert à vérifier votre ticket à l'embarquement. Présentez-le au contrôleur.", { liens: [{ label: 'Mes réservations', href: '/mes-reservations.html' }, { label: 'Vérifier un ticket', href: '/verifier.html' }] });
  }
  if (has(text, 'mot de passe', 'connexion', 'connecter', 'compte', 'inscri', 'identifiant', 'email', 'e mail')) {
    return out("Pour créer un compte ou vous connecter, utilisez les boutons « Inscription » et « Connexion » en haut de la page. Si vous n'arrivez pas à vous connecter, notre service client peut vous aider.", { liens: [{ label: 'Connexion', href: '/connexion.html' }, { label: 'Inscription', href: '/inscription.html' }] });
  }
  if (has(text, 'horaire', 'tarif', 'prix', 'combien', 'cout', 'trajet', 'ville', 'destination', 'voyage', 'bus', 'depart', 'quand')) {
    const villes = await catalog.villes();
    return out(`Dites-moi votre trajet, par exemple « Cotonou Parakou », et je vous donne les prochains départs avec les tarifs. Villes desservies : ${villes.join(', ')}.`, { liens: [{ label: 'Rechercher un trajet', href: '/trajets.html' }], suggestions: ['Cotonou Porto-Novo', 'Cotonou Parakou', 'Où embarquer ?'] });
  }
  if (has(text, 'merci', 'super', 'parfait', 'ok ')) return out('Avec plaisir ! Bon voyage avec Voyagéo.', { suggestions: ['Horaires et tarifs', 'Où embarquer ?'] });
  if (has(text, 'bonjour', 'bonsoir', 'salut', 'hello', 'coucou', 'bjr', 'salam', /^hi\b/)) return out('Bonjour ! Je suis l\'assistant Voyagéo. Je peux vous donner les horaires, les tarifs, les lieux d\'embarquement ou vous expliquer comment réserver.');
  return out("Je n'ai pas bien compris votre question. Essayez par exemple « Cotonou Parakou » ou « où embarquer à Cotonou ? ». Vous pouvez aussi écrire directement à notre service client sur WhatsApp.", { liens: [wa] });
}

module.exports = { reply };
