import { init, state, waHref } from './ui.js';

if (await init({})) {
  // Les coordonnées de contact viennent de la configuration du site (jamais écrites en dur dans le texte).
  document.querySelectorAll('[data-wa]').forEach((el) => {
    const a = document.createElement('a');
    a.href = waHref('Bonjour Voyagéo, j’ai une question sur mes données personnelles.'); a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = `WhatsApp ${state.config.whatsapp?.affichage || '+229 60 31 58 10'}`;
    el.replaceWith(a);
  });
}
