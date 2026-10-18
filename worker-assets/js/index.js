import { api, qs } from './api.js';
import { init, h, $, todayStr, slug, fmtFCFA, fmtDuree, revealOnScroll, icon } from './ui.js';
import { initSearchForm, searchFormHtml } from './search-form.js';

/**
 * PHOTOS DES DESTINATIONS : pour mettre de vraies photos, déposez simplement un fichier  /public/img/destinations/<ville>.jpg
 * (ex. cotonou.jpg, parakou.jpg, porto-novo.jpg). S'il existe, il remplace l'illustration .svg fournie.
 */
const DESTINATIONS = [
  { a: 'Cotonou', b: 'Porto-Novo', titre: 'Cap sur la capitale', accroche: 'Palais, musées et marchés : la capitale vous attend.', photo: 'porto-novo' },
  { a: 'Cotonou', b: 'Bohicon', titre: 'Au cœur du Zou', accroche: 'Aux portes d’Abomey et de ses palais royaux.', photo: 'bohicon' },
  { a: 'Cotonou', b: 'Parakou', titre: 'En route vers le Grand Nord', accroche: 'La grande traversée, confortablement installé.', photo: 'parakou' },
  { a: 'Cotonou', b: 'Abomey-Calavi', titre: 'Le trajet de tous les jours', accroche: 'Rapide, simple et sans stress, matin et soir.', photo: 'abomey-calavi' },
  { a: 'Bohicon', b: 'Parakou', titre: 'Du Zou aux portes du Nord', accroche: 'Une belle route à travers le pays.', photo: 'parakou' },
  { a: 'Porto-Novo', b: 'Parakou', titre: 'D’une ville à l’autre', accroche: 'Du sud au nord, d’un seul trait.', photo: 'porto-novo' },
];

function destinationImage(photo, alt) {
  const img = h('img', { src: `/img/destinations/${photo}.jpg`, alt, loading: 'lazy', decoding: 'async', width: 800, height: 500 });
  let step = 0;   // 1) photo .jpg déposée par vous  2) illustration .svg  3) illustration par défaut
  img.addEventListener('error', () => { step += 1; img.src = step === 1 ? `/img/destinations/${photo}.svg` : '/img/destinations/defaut.svg'; if (step > 2) img.removeAttribute('src'); });
  return img;
}

function destCard(d, info, i) {
  const price = info && info.prix ? h('span', { class: 'dest-price' }, `dès ${fmtFCFA(info.prix)}`) : null;
  const meta = info ? [info.depart_aujourdhui ? `${info.depart_aujourdhui} départ${info.depart_aujourdhui > 1 ? 's' : ''} aujourd’hui` : 'Départs les jours suivants', info.duree ? ` · ${fmtDuree(info.duree)} de route` : ''].join('') : 'Voir les prochains départs';
  return h('a', { class: `dest-card reveal d${(i % 3) + 1}`, href: `/trajets.html${qs({ depart: d.a, arrivee: d.b, date: todayStr() })}`, 'aria-label': `${d.a} vers ${d.b} : ${d.titre}` },
    h('div', { class: 'dest-media' }, destinationImage(d.photo, `Illustration du trajet ${d.a} – ${d.b}`), price,
      h('div', { class: 'dest-title' }, d.a, h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'), d.b)),
    h('div', { class: 'dest-body' }, h('div', { class: 'dest-tag' }, d.titre), h('div', { class: 'small text-muted' }, d.accroche), h('div', { class: 'dest-meta mt-1' }, meta),
      h('span', { class: 'dest-cta' }, 'Voir les départs →')));
}

/** Prix « à partir de » et nombre de départs du jour pour chaque destination (silencieux si le serveur ne répond pas). */
async function loadInfos() {
  const today = todayStr();
  const out = await Promise.all(DESTINATIONS.map(async (d) => {
    try {
      const list = (await api.get(`/api/horaires${qs({ depart: d.a, arrivee: d.b, date: today })}`)).horaires.filter((x) => x.reservable);
      return list.length ? { prix: Math.min(...list.map((x) => x.tarif_fcfa)), depart_aujourdhui: list.length, duree: list[0].duree_estimee } : { prix: null, depart_aujourdhui: 0, duree: null };
    } catch { return null; }
  }));
  return out;
}

if (await init({ active: 'accueil' })) {
  const app = $('#app');
  const form = searchFormHtml();
  const trust = (ico, t, p, i) => h('div', { class: `col-md-6 col-lg-3 reveal d${(i % 3) + 1}` }, h('div', { class: 'trust-card' }, h('div', { class: 'ico', 'aria-hidden': 'true' }, icon(ico, 24)), h('h3', { class: 'h6 fw-bold text-primary-emphasis' }, t), h('p', { class: 'mb-0 text-muted small' }, p)));
  const step = (n, t, p, i) => h('div', { class: `col-sm-6 col-lg-3 reveal d${(i % 3) + 1}` }, h('div', { class: 'd-flex gap-3' }, h('span', { class: 'step-num' }, n), h('div', {}, h('div', { class: 'font-title fw-bold text-primary-emphasis' }, t), h('div', { class: 'text-muted small' }, p))));
  const grid = h('div', { class: 'dest-grid' }, DESTINATIONS.map((d, i) => destCard(d, null, i)));

  app.append(
    h('section', { class: 'hero-anim', 'aria-label': 'Présentation' },
      h('img', { class: 'cloud c1', src: '/img/cloud.svg', alt: '' }), h('img', { class: 'cloud c2', src: '/img/cloud.svg', alt: '' }), h('img', { class: 'cloud c3', src: '/img/cloud.svg', alt: '' }),
      h('img', { class: 'hero-skyline', src: '/img/hero-skyline.svg', alt: '' }),
      h('div', { class: 'container position-relative' },
        h('h1', { class: 'fade-up' }, 'Réservez votre bus ', h('span', { class: 'accent' }, 'en quelques clics')),
        h('p', { class: 'lead-vy mt-3 fade-up d1' }, 'Comparez les horaires et les tarifs, choisissez votre place, voyez le bus et votre chauffeur, puis recevez votre ticket numérique après paiement.'),
        h('div', { class: 'hero-badges fade-up d2' }, h('span', {}, icon('bus', 16), ' Bus de plusieurs compagnies'), h('span', {}, icon('pin', 16), ' Lieu d’embarquement indiqué'), h('span', {}, icon('star', 16), ' Chauffeurs notés')),
        h('div', { class: 'mt-4 fade-up d3' }, h('a', { class: 'btn btn-vy btn-lg', href: '/trajets.html' }, 'Rechercher un trajet'))),
      h('div', { class: 'hero-road', 'aria-hidden': 'true' }), h('div', { class: 'hero-bus', 'aria-hidden': 'true' }, h('img', { src: '/img/bus-side.svg', alt: '' }))),
    h('div', { class: 'container' },
      h('div', { class: 'search-pull fade-up d2' }, form),
      h('section', { class: 'my-5', 'aria-labelledby': 'pop' },
        h('h2', { id: 'pop', class: 'section-title reveal' }, 'Les voyages les plus demandés'),
        h('p', { class: 'section-sub reveal d1 mb-4' }, 'Choisissez votre prochaine destination : prix et départs du jour affichés en temps réel.'), grid),
      h('section', { class: 'row g-3 my-5', 'aria-label': 'Avantages' },
        trust('zap', 'Rapide', 'Trouvez un voyage et réservez votre place en quelques minutes, depuis votre téléphone.', 0),
        trust('shield', 'Fiable', 'Une place ne peut être réservée que par un seul voyageur : plus de mauvaises surprises.', 1),
        trust('pin', 'Embarquement clair', 'Le lieu d’embarquement et son plan Google Maps sont affichés avant que vous payiez.', 2),
        trust('star', 'Chauffeurs notés', 'Découvrez la photo et le prénom du chauffeur, notez-le après le voyage et laissez-lui un pourboire.', 3)),
      h('section', { class: 'my-5', 'aria-labelledby': 'how' }, h('h2', { id: 'how', class: 'section-title mb-4 reveal' }, 'Comment ça marche ?'),
        h('div', { class: 'row g-4' },
          step('1', 'Recherchez', 'Départ, destination et date.', 0), step('2', 'Choisissez', 'Un voyage, un bus et votre place.', 1),
          step('3', 'Enregistrez et payez', 'Vérifiez l’embarquement, renseignez le voyageur, puis payez.', 2), step('4', 'Voyagez', 'Votre ticket numérique est délivré après le paiement.', 3))),
      h('div', { class: 'text-center my-5 reveal' }, h('a', { class: 'btn btn-vy btn-lg', href: '/trajets.html' }, 'Rechercher un trajet'))));
  await initSearchForm(form);
  revealOnScroll(app);
  // Les prix arrivent ensuite, sans bloquer l'affichage de la page.
  loadInfos().then((infos) => { if (infos.some(Boolean)) { grid.replaceChildren(...DESTINATIONS.map((d, i) => { const c = destCard(d, infos[i], i); c.classList.add('in'); return c; })); } }).catch(() => {});
}
