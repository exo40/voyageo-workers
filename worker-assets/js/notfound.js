import { init, h } from './ui.js';
if (await init()) {
  document.querySelector('#app').append(h('div', { class: 'text-center py-5' },
    h('h1', {}, 'Page introuvable'), h('p', { class: 'text-muted' }, "Cette page n'existe pas ou a été déplacée."),
    h('a', { class: 'btn btn-vy', href: '/' }, "Retour à l'accueil")));
}
