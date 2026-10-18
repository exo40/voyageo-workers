// Administration Voyagéo : structure de la page, navigation, notifications, tableau de bord.
// Administrateur : accès à tout. Gestionnaire : uniquement sa compagnie (restriction appliquée par le serveur sur chaque route).
import { api, qs } from './api.js';
import { init, h, $, clear, state, toast, alertBox, logout, todayStr, addDays, themeToggle } from './ui.js';
import { icon } from './icons.js';
import { timeChart, rankChart, donutChart, sparkline, fmtShortDate } from './charts.js';
import { kpiCard, deltaBadge, btnA, fmtMoney, fmtDay, initials, ROLE_LABEL, busy } from './admin-kit.js';
import { feedList } from './admin-activity.js';
import { makeSections } from './admin-sections.js';

const ok = await init({ active: 'admin', requireAuth: true, roles: ['admin', 'gestionnaire'], chat: false });
if (ok) start();

function start() {
  const user = state.user, isAdmin = user.role === 'admin';
  const content = $('#admin-content');
  const ctx = { api, isAdmin, user, content, companyList: [], go, companies: async () => ctx.companyList, refreshCompanies, refreshAlerts, reloadSubscription };
  let alerts = [], period = 30, sub = null;

  // Un gestionnaire dont l'abonnement n'est pas valide ne voit que la page « Abonnement » (le serveur refuse tout le reste : erreur 402).
  const locked = () => !isAdmin && sub && !sub.actif;
  async function loadSubscription() { if (!isAdmin) sub = await api.get('/api/admin/abonnement'); }
  async function reloadSubscription() { await loadSubscription(); renderNav(); }
  const visibleSections = () => (locked() ? SECTIONS.filter((s) => s.id === 'abonnement') : SECTIONS);

  async function refreshCompanies() { ctx.companyList = (await api.get('/api/admin/compagnies')).compagnies; return ctx.companyList; }
  const S = makeSections(ctx);

  // ---------- sections ----------
  const SECTIONS = [
    { id: 'dashboard', group: 'Pilotage', label: 'Tableau de bord', ic: 'dashboard', title: 'Tableau de bord', sub: () => (isAdmin ? 'Vue d\'ensemble de toute la plateforme' : `Activité de ${ctx.companyList[0]?.nom || 'votre compagnie'}`), run: dashboard },
    { id: 'activite', group: 'Pilotage', label: 'Activité', ic: 'activity', title: 'Activité récente', sub: () => 'Journal des événements et des actions sensibles', run: S.activite },
    { id: 'horaires', group: 'Exploitation', label: 'Voyages', ic: 'calendar', title: 'Voyages', sub: () => 'Départs programmés, remplissage et passagers', run: S.voyages },
    { id: 'reservations', group: 'Exploitation', label: 'Réservations', ic: 'ticket', title: 'Réservations', sub: () => 'Tickets, passagers et statuts', run: S.reservations },
    { id: 'trajets', group: 'Exploitation', label: 'Trajets', ic: 'route', title: 'Trajets', sub: () => 'Liaisons entre villes et lieux d\'embarquement', run: S.trajets },
    { id: 'bus', group: 'Exploitation', label: 'Bus', ic: 'bus', title: 'Bus', sub: () => 'Flotte, capacité et affectations', run: S.bus },
    { id: 'chauffeurs', group: 'Exploitation', label: 'Chauffeurs', ic: 'users', title: 'Chauffeurs', sub: () => 'Prénom, photo, notes des voyageurs et pourboires', run: S.chauffeurs },
    { id: 'paiements', group: 'Finance', label: 'Paiements', ic: 'wallet', title: 'Paiements', sub: () => 'Transactions, encaissements et remboursements', run: S.paiements, badge: () => alerts.filter((a) => ['remboursements', 'paiements_a_verifier', 'paye_sans_ticket'].includes(a.code)).reduce((s, a) => s + a.nombre, 0) },
    { id: 'compagnies', group: 'Administration', label: 'Compagnies', ic: 'building', title: 'Compagnies', sub: () => 'Partenaires de transport', run: S.compagnies, admin: true },
    { id: 'utilisateurs', group: 'Administration', label: 'Utilisateurs', ic: 'users', title: 'Utilisateurs', sub: () => 'Comptes, profils et accès', run: S.utilisateurs, admin: true },
    { id: 'ma-compagnie', group: 'Mon agence', label: 'Ma compagnie', ic: 'building', title: 'Ma compagnie', sub: () => 'Informations et activité de votre compagnie', run: S.maCompagnie, manager: true },
    { id: 'encaissement', group: 'Mon agence', label: 'Encaissement des tickets', ic: 'wallet', title: 'Encaissement des tickets', sub: () => 'Vos clés FedaPay : l\'argent des tickets arrive directement chez vous', run: S.encaissement, manager: true },
    { id: 'abonnement', group: 'Mon agence', label: 'Abonnement', ic: 'ticket', title: 'Abonnement', sub: () => 'Accès à votre espace et mise en vente de vos voyages', run: S.abonnement, manager: true, badge: () => (sub && (!sub.actif || (sub.requis && sub.jours_restants <= 7)) ? 1 : 0) },
  ].filter((s) => (!s.admin || isAdmin) && (!s.manager || !isAdmin));

  // ---------- navigation ----------
  let pendingParams = {}, current = SECTIONS[0];
  function go(id, params = {}) {
    pendingParams = params;
    const hash = `#/${id}`;
    if (location.hash === hash) render(); else location.hash = hash;
  }
  function renderNav() {
    const list = visibleSections();
    const groups = [...new Set(list.map((s) => s.group))];
    clear($('#adm-nav')).append(...groups.map((g) => h('div', { class: 'adm-nav-group' }, h('div', { class: 'adm-nav-title' }, g), h('div', { class: 'adm-nav' }, list.filter((s) => s.group === g).map((s) => {
      const n = s.badge ? s.badge() : 0;
      return h('a', { href: `#/${s.id}`, class: s.id === current.id ? 'active' : '', 'aria-current': s.id === current.id ? 'page' : null, onclick: () => { pendingParams = {}; closeMenu(); } }, icon(s.ic, 18), s.label, n ? h('span', { class: 'count', title: `${n} élément(s) à traiter` }, String(n)) : null);
    })))));
  }
  async function render() {
    const id = location.hash.replace(/^#\//, '').split('?')[0] || 'dashboard';
    current = visibleSections().find((s) => s.id === id) || visibleSections()[0];
    if (locked() && location.hash.split('?')[0] !== '#/abonnement') history.replaceState(null, '', '#/abonnement');
    const params = pendingParams; pendingParams = {};
    window.bootstrap?.Offcanvas.getInstance($('#detailDrawer'))?.hide();   // une fiche ouverte ne reste pas affichée par-dessus la nouvelle page
    $('#adm-title').textContent = current.title; $('#adm-sub').textContent = current.sub();
    document.title = `${current.title} | Administration Voyagéo`;
    renderNav();
    clear(content).append(h('div', { class: 'loading-row' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
    window.scrollTo({ top: 0 });
    try { await current.run(params); }
    catch (e) {
      if (e.status === 401) return sessionExpired();
      if (e.status === 402) { await loadSubscription().catch(() => {}); go('abonnement'); return; }   // abonnement échu entre-temps
      clear(content).append(h('div', { class: 'card-a' }, alertBox(e.message || 'Une erreur est survenue.'), btnA('Réessayer', { ic: 'refresh', onclick: render })));
    }
    content.focus({ preventScroll: true });
  }
  function sessionExpired() {
    toast('Votre session a expiré. Reconnexion…', 'error');
    setTimeout(() => location.replace(`/connexion.html?suite=${encodeURIComponent('/admin')}`), 1200);
  }

  // ---------- structure : menu mobile, en-tête, notifications, profil ----------
  const side = $('#adm-side'), backdrop = $('#adm-backdrop'), menuBtn = $('#adm-menu');
  menuBtn.append(icon('menu', 20));
  function closeMenu() { side.classList.remove('open'); backdrop.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', () => { const o = side.classList.toggle('open'); backdrop.classList.toggle('open', o); menuBtn.setAttribute('aria-expanded', String(o)); });
  backdrop.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); closePops(); } });

  $('#adm-date').textContent = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Porto-Novo' }).format(new Date());
  const refreshBtn = $('#adm-refresh'); refreshBtn.append(icon('refresh', 18));
  refreshBtn.addEventListener('click', () => busy2(refreshBtn, async () => { await loadSubscription(); await Promise.all([refreshAlerts(), isAdmin ? refreshCompanies() : null]); await render(); toast('Données actualisées.', 'success'); }));
  async function busy2(btn, fn) { btn.disabled = true; btn.classList.add('spinning'); try { await fn(); } catch (e) { if (e.status === 401) sessionExpired(); else toast(e.message, 'error'); } finally { btn.disabled = false; btn.classList.remove('spinning'); } }

  clear($('#adm-foot')).append(h('a', { href: '/' }, icon('home', 18), 'Retour au site'), h('button', { type: 'button', onclick: logout }, icon('logout', 18), 'Se déconnecter'));

  // pop-overs (notifications et profil)
  const pops = [];
  function closePops() { for (const p of pops) p.hide(); }
  function popover(wrap, trigger, build) {
    const pop = h('div', { class: 'adm-pop', hidden: true, role: 'menu' });
    wrap.append(trigger, pop);
    const api2 = { hide() { pop.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }, rebuild() { clear(pop).append(...build()); } };
    pops.push(api2);
    trigger.setAttribute('aria-haspopup', 'true'); trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', (e) => { e.stopPropagation(); const open = pop.hidden; closePops(); if (open) { api2.rebuild(); pop.hidden = false; trigger.setAttribute('aria-expanded', 'true'); } });
    pop.addEventListener('click', (e) => { if (e.target.closest('a,button')) api2.hide(); });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) api2.hide(); });
    return api2;
  }
  const themeBtn = themeToggle('icon-btn');
  $('#adm-bell-wrap').before(themeBtn);
  const bell = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Notifications' }, icon('bell', 18));
  popover($('#adm-bell-wrap'), bell, () => (alerts.length ? alerts.map((a) => h('button', { class: 'item', type: 'button', onclick: () => go(a.section) }, h('strong', {}, a.titre), a.detail ? h('small', {}, a.detail) : null)) : [h('div', { class: 'item' }, 'Aucune alerte pour le moment.', h('small', {}, 'Tout est en ordre.'))]));
  const userBtn = h('button', { class: 'adm-user', type: 'button' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(user)), h('span', { class: 'who' }, `${user.prenom} ${user.nom}`, h('small', {}, ROLE_LABEL[user.role])));
  popover($('#adm-user-wrap'), userBtn, () => [h('a', { class: 'item', href: '/compte.html' }, 'Mon compte'), h('a', { class: 'item', href: '/' }, 'Retour au site'), h('button', { class: 'item', type: 'button', onclick: logout }, 'Se déconnecter')]);

  function paintBell() {
    bell.querySelector('.dot')?.remove();
    const n = alerts.length;
    if (n) bell.append(h('span', { class: 'dot', 'aria-hidden': 'true' }, String(n)));
    bell.setAttribute('aria-label', n ? `Notifications : ${n} alerte(s)` : 'Notifications : aucune alerte');
  }
  async function refreshAlerts() {
    if (locked()) { alerts = []; paintBell(); renderNav(); return; }
    try { alerts = (await api.get('/api/admin/tableau-de-bord?jours=7')).alertes; } catch (e) { if (e.status === 401) return sessionExpired(); alerts = []; }
    paintBell(); renderNav();
  }

  // ---------- tableau de bord ----------
  const card = (title, hint, ...body) => h('div', { class: 'card-a' }, h('div', { class: 'card-h' }, h('h2', {}, title), hint ? h('span', { class: 'hint' }, hint) : null), ...body);
  const dayLabel = (d) => (d === todayStr() ? "Aujourd'hui" : d === addDays(todayStr(), 1) ? 'Demain' : fmtDay(d));

  async function dashboard() {
    const d = await api.get(`/api/admin/tableau-de-bord${qs({ jours: period })}`);
    alerts = d.alertes; paintBell(); renderNav();
    const k = d.kpis, g = d.graphiques;
    const jours = d.periode.jours;
    const sel = h('select', { class: 'form-select period-select', id: 'period', 'aria-label': 'Période des indicateurs' }, [[7, '7 derniers jours'], [30, '30 derniers jours'], [90, '90 derniers jours'], [365, '12 derniers mois']].map(([v, l]) => h('option', { value: v, selected: v === jours }, l)));
    sel.addEventListener('change', () => { period = Number(sel.value); dashboard().catch((e) => (e.status === 401 ? sessionExpired() : toast(e.message, 'error'))); });

    const hero = h('div', { class: 'card-a' }, h('div', { class: 'hero-kpi' },
      h('div', {}, h('div', { class: 'hint mb-1' }, "Chiffre d'affaires encaissé"), h('div', { class: 'big num' }, new Intl.NumberFormat('fr-FR').format(k.chiffre_affaires.valeur), h('small', {}, 'FCFA')),
        h('div', { class: 'mt' }, deltaBadge(k.chiffre_affaires, { unit: ' FCFA' }), ' ', h('span', { class: 'hint' }, `vs ${jours} jours précédents`)),
        h('p', { class: 'hint mb-0 mt-2' }, 'Paiements réels confirmés, hors simulation.', k.chiffre_affaires_simule ? ` ${fmtMoney(k.chiffre_affaires_simule)} de paiements simulés ne sont pas comptés.` : '')),
      h('div', {}, h('div', { class: 'hint mb-1' }, 'Recettes sur la période'), h('div', { id: 'ch-recettes' }))));
    const alertsCard = card('Alertes', d.alertes.length ? `${d.alertes.length} à examiner` : null, d.alertes.length
      ? h('ul', { class: 'alerts' }, d.alertes.map((a) => h('li', { class: `alert-a ${a.niveau}` }, icon(a.niveau === 'info' ? 'info' : 'alert', 18), h('div', {}, h('strong', {}, a.titre), a.detail ? h('span', { class: 'd' }, a.detail) : null), btnA('Voir', { onclick: () => go(a.section) }))))
      : h('div', { class: 'alert-ok' }, icon('check', 18), 'Aucune alerte : tout est en ordre.'));

    const kpis = [
      kpiCard({ label: 'Réservations', ic: 'ticket', value: String(k.reservations.valeur), delta: deltaBadge(k.reservations) }),
      isAdmin ? kpiCard({ label: 'Voyageurs inscrits', ic: 'users', value: String(k.utilisateurs.total), delta: deltaBadge({ valeur: k.utilisateurs.valeur, precedent: k.utilisateurs.precedent, variation_pct: k.utilisateurs.variation_pct }), note: `+${k.utilisateurs.valeur} sur la période` }) : null,
      isAdmin ? kpiCard({ label: 'Compagnies actives', ic: 'building', value: `${k.compagnies_actives.actives} / ${k.compagnies_actives.total}` }) : null,
      kpiCard({ label: 'Bus enregistrés', ic: 'bus', value: String(k.bus) }),
      kpiCard({ label: 'Voyages programmés', ic: 'calendar', value: String(k.voyages_programmes), note: `remplis à ${k.remplissage_a_venir} %` }),
      kpiCard({ label: 'Voyages terminés', value: String(k.voyages_termines.valeur), delta: deltaBadge(k.voyages_termines) }),
      kpiCard({ label: 'Voyages annulés', value: String(k.voyages_annules.valeur), delta: deltaBadge(k.voyages_annules, { invert: true }) }),
      kpiCard({ label: 'Remplissage moyen', value: `${k.taux_remplissage.valeur} %`, delta: deltaBadge(k.taux_remplissage, { unit: ' %' }) }),
      kpiCard({ label: 'Paiements en attente', ic: 'wallet', value: String(k.paiements_en_attente.nombre), note: k.paiements_en_attente.nombre ? fmtMoney(k.paiements_en_attente.montant) : null }),
      kpiCard({ label: 'Transactions échouées', value: String(k.transactions_echouees.valeur), delta: deltaBadge(k.transactions_echouees, { invert: true }) }),
      kpiCard({ label: 'Remboursements à traiter', value: String(k.a_rembourser.nombre), note: k.a_rembourser.nombre ? fmtMoney(k.a_rembourser.montant) : null, warn: k.a_rembourser.nombre > 0 }),
    ];

    const board = h('div', { class: 'board' }, d.prochains_departs.length ? d.prochains_departs.map((v) => {
      const pct = v.nombre_places ? Math.round((v.places_occupees / v.nombre_places) * 100) : 0;
      const fill = h('span', { class: `occ-fill${pct >= 100 ? ' full' : pct >= 85 ? ' high' : ''}` }); fill.style.width = `${pct}%`;
      const row = h('div', { class: 'board-row', tabindex: 0, role: 'button', 'aria-label': `Voyage ${v.ville_depart} ${v.ville_arrivee} à ${v.heure_depart}` },
        h('div', { class: 'time' }, v.heure_depart, h('span', { class: 'day' }, dayLabel(v.date_depart))), h('div', { class: 'route' }, `${v.ville_depart} – ${v.ville_arrivee}`), h('div', { class: 'co co-cell' }, v.compagnie_nom),
        h('div', { class: 'occ occ-cell' }, h('span', { class: 'occ-track' }, fill), h('span', { class: 'occ-txt' }, `${v.places_occupees}/${v.nombre_places}`)));
      const open = () => S.voyageDrawer(v.id_horaire);
      row.addEventListener('click', open); row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      return row;
    }) : h('div', { class: 'chart-empty' }, 'Aucun départ programmé.'));

    const boardCard = card('Prochains départs', 'Cliquez sur un départ pour voir le plan des places', board);
    const ids = ['ch-resa', 'ch-statut', 'ch-routes', 'ch-comp', 'ch-bus', 'ch-pay'].reduce((o, i) => ({ ...o, [i]: h('div', { id: i }) }), {});
    clear(content).append(
      h('div', { class: 'page-actions' }, h('div', { class: 'grow' }), sel,
        h('button', { class: 'btn btn-vy btn-ic', type: 'button', onclick: () => go('horaires', { add: true }) }, icon('plus', 16), 'Nouveau voyage'), btnA('Réservations', { ic: 'ticket', onclick: () => go('reservations') }), btnA('Paiements', { ic: 'wallet', onclick: () => go('paiements') })),
      h('div', { class: 'grid g-main mb-3' }, hero, alertsCard),
      h('div', { class: 'grid g-kpi' }, kpis),
      h('div', { class: 'grid g-2 mt' }, card('Évolution des réservations', jours > 31 ? 'Par semaine' : 'Par jour', ids['ch-resa']), card('Réservations par statut', `${jours} derniers jours`, ids['ch-statut'])),
      h('div', { class: 'grid g-2 mt' }, card('Trajets les plus demandés', 'Réservations sur la période', ids['ch-routes']), isAdmin ? card('Compagnies les plus actives', 'Réservations sur la période', ids['ch-comp']) : card('Remplissage de vos bus', 'Moyenne sur la période', ids['ch-bus'])),
      isAdmin ? h('div', { class: 'grid g-2 mt' }, card('Remplissage des bus', 'Moyenne sur la période', ids['ch-bus']), card('Paiements par statut', `${jours} derniers jours`, ids['ch-pay'])) : h('div', { class: 'grid g-2 mt' }, card('Paiements par statut', `${jours} derniers jours`, ids['ch-pay']), card('Activité récente', null, d.activite.length ? feedList(d.activite.slice(0, 8)) : h('div', { class: 'chart-empty' }, 'Aucun événement enregistré.'))),
      isAdmin ? h('div', { class: 'grid g-main mt' }, boardCard, card('Activité récente', null, d.activite.length ? h('div', {}, feedList(d.activite.slice(0, 8)), h('div', { class: 'mt' }, btnA('Tout le journal', { ic: 'activity', onclick: () => go('activite') }))) : h('div', { class: 'chart-empty' }, 'Aucun événement enregistré.'))) : h('div', { class: 'mt' }, boardCard),
    );

    const lbl = (b) => fmtShortDate(b.debut);
    const range = (b) => (b.debut === b.fin ? fmtDay(b.debut) : `${fmtShortDate(b.debut)} au ${fmtShortDate(b.fin)}`);
    timeChart($('#ch-resa'), { data: g.evolution.map((b) => ({ label: lbl(b), value: b.reservations, tip: [range(b), `${b.reservations} réservation(s)`] })), type: 'bar', ariaLabel: 'Réservations dans le temps' });
    timeChart($('#ch-recettes'), { data: g.evolution.map((b) => ({ label: lbl(b), value: b.recettes, tip: [range(b), fmtMoney(b.recettes)] })), type: 'line', tone: 'navy', height: 170, ariaLabel: 'Recettes encaissées dans le temps' });
    const st = g.par_statut;
    donutChart($('#ch-statut'), { centerLabel: 'réservations', items: [{ label: 'Confirmées', value: st.confirmee || 0, tone: 'ok' }, { label: 'En attente', value: st.en_attente || 0, tone: 'warn' }, { label: 'Annulées', value: st.annulee || 0, tone: 'bad' }] });
    rankChart($('#ch-routes'), { items: g.trajets_populaires.map((r) => ({ label: r.nom, value: r.nombre })), unit: '' });
    if (isAdmin) rankChart($('#ch-comp'), { items: g.compagnies_actives.map((r) => ({ label: r.nom, value: r.nombre })) });
    rankChart($('#ch-bus'), { items: g.remplissage_bus.map((r) => ({ label: r.nom, value: r.taux, sub: `${r.compagnie} · ${r.voyages} voyage(s)` })), max: 100, unit: ' %' });
    const pay = g.paiements_par_statut, tones = { confirme: 'ok', simule: 'info', en_attente: 'warn', echoue: 'bad' };
    donutChart($('#ch-pay'), { centerLabel: 'transactions', items: pay.map((p) => ({ label: p.libelle, value: p.nombre, tone: tones[p.cle], display: p.nombre ? `${p.nombre} · ${fmtMoney(p.montant)}` : '0' })) });
  }

  // ---------- démarrage ----------
  window.addEventListener('hashchange', render);
  // villes pour les listes de suggestions
  api.get('/api/villes').then((r) => { const dl = $('#villes-dl'); for (const v of r.villes) dl.append(h('option', { value: v })); }).catch(() => {});
  (async () => {
    clear($('#adm-scope')).append(h('span', {}, isAdmin ? 'Espace' : 'Espace gestionnaire'), h('strong', {}, isAdmin ? 'Administration Voyagéo' : '…'));
    try { await loadSubscription(); if (!locked()) await refreshCompanies(); } catch (e) { if (e.status === 401) return sessionExpired(); }
    if (!isAdmin) clear($('#adm-scope')).append(h('span', {}, 'Espace gestionnaire'), h('strong', {}, ctx.companyList[0]?.nom || sub?.compagnie?.nom || 'Votre compagnie'));
    renderNav();
    await render();
    if (current.id !== 'dashboard') refreshAlerts();
  })();
  setInterval(() => { if (!document.hidden) refreshAlerts(); }, 120000);
}
