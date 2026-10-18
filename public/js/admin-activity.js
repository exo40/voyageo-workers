// Libellés lisibles des événements du journal (partagés par le tableau de bord, les fiches et la page « Activité »).
import { h } from './ui.js';
import { fmtDateTime } from './admin-kit.js';

// [libellé, ton] : ton = ok | warn | bad | '' (neutre)
export const EVENT_LABEL = {
  'reservation.creee': ['Nouvelle réservation', ''], 'reservation.annulee': ['Réservation annulée', 'warn'],
  'paiement.confirme': ['Paiement confirmé', 'ok'], 'paiement.doublon': ['Paiement en double : à rembourser', 'bad'], 'paiement.place_prise': ['Paiement reçu, place déjà prise : à rembourser', 'bad'],
  'paiement.anomalie_montant': ['Montant inattendu : à vérifier', 'bad'], 'paiement.rembourse': ['Remboursement effectué', 'ok'],
  'horaire.cree': ['Nouveau voyage', ''], 'horaire.modifie': ['Voyage modifié', ''], 'horaire.annule': ['Voyage annulé', 'bad'], 'horaire.supprime': ['Voyage supprimé', 'warn'],
  'bus.cree': ['Bus ajouté', ''], 'bus.modifie': ['Bus modifié', ''], 'bus.supprime': ['Bus supprimé', 'warn'],
  'trajet.cree': ['Trajet créé', ''], 'trajet.modifie': ['Trajet modifié', ''], 'trajet.supprime': ['Trajet supprimé', 'warn'],
  'compagnie.creee': ['Compagnie créée', ''], 'compagnie.modifiee': ['Compagnie modifiée', ''], 'compagnie.activee': ['Compagnie réactivée', 'ok'], 'compagnie.desactivee': ['Compagnie désactivée', 'warn'], 'compagnie.supprimee': ['Compagnie supprimée', 'bad'],
  'utilisateur.cree': ['Compte créé', ''], 'utilisateur.modifie': ['Compte modifié', ''], 'utilisateur.suspendu': ['Compte suspendu', 'bad'], 'utilisateur.reactive': ['Compte réactivé', 'ok'], 'utilisateur.mot_de_passe_reinitialise': ['Mot de passe réinitialisé', 'warn'], 'utilisateur.supprime': ['Compte supprimé', 'bad'],
  'chauffeur.cree': ['Chauffeur ajouté', ''], 'chauffeur.modifie': ['Chauffeur modifié', ''], 'chauffeur.supprime': ['Chauffeur supprimé', 'warn'], 'avis.cree': ['Avis sur un chauffeur', 'ok'], 'pourboire.recu': ['Pourboire reçu', 'ok'],
  'export.reservations': ['Export CSV des réservations', ''], 'export.voyages': ['Export CSV des voyages', ''], 'export.paiements': ['Export CSV des paiements', ''],
};
export function feedList(events) {
  return h('ul', { class: 'feed' }, events.map((e) => {
    const [label, tone] = EVENT_LABEL[e.action] || [e.action, ''];
    return h('li', {}, h('span', { class: `pip ${tone}` }), h('div', {}, h('div', { class: 't' }, label), e.details ? h('div', { class: 'm' }, e.details) : null, h('div', { class: 'm' }, `${fmtDateTime(e.date_evenement)} · ${e.utilisateur_nom || 'Système'}`)));
  }));
}
