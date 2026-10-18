// Assistant Voyagéo (bot) + bouton WhatsApp du service client, affichés sur toutes les pages publiques.
import { api } from './api.js';
import { h, $, clear, state, waHref } from './ui.js';

const KEY = 'voyageo.chat';
const SUGGESTIONS = ['Comment réserver ?', 'Horaires et tarifs', 'Où embarquer ?', 'Annuler un ticket'];
const HELLO = { de: 'bot', texte: 'Bonjour ! Je suis l’assistant Voyagéo. Posez-moi vos questions sur les horaires, les tarifs, les lieux d’embarquement ou la réservation.', suggestions: SUGGESTIONS, whatsapp: true, question: '' };

function load() { try { const v = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (Array.isArray(v) && v.length) return v; } catch { /* stockage indisponible */ } return [HELLO]; }
function save(list) { try { sessionStorage.setItem(KEY, JSON.stringify(list.slice(-30))); } catch { /* sans importance */ } }
const safeHref = (u) => (typeof u === 'string' && (u.startsWith('/') && !u.startsWith('//') || u.startsWith('https://')) ? u : '#');

export function initChat() {
  if ($('.vy-chat-root')) return;
  let messages = load();
  let open = false, busy = false;

  const log = h('div', { class: 'vy-chat-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation avec l’assistant' });
  const input = h('input', { class: 'form-control', id: 'vy-chat-input', type: 'text', maxlength: 300, placeholder: 'Écrivez votre question…', autocomplete: 'off', 'aria-label': 'Votre question' });
  const sendBtn = h('button', { class: 'btn btn-vy', type: 'submit' }, 'Envoyer');
  const form = h('form', { class: 'vy-chat-form', onsubmit: (e) => { e.preventDefault(); ask(input.value); } }, input, sendBtn);
  const panel = h('section', { class: 'vy-chat-panel', id: 'vy-chat-panel', hidden: true, 'aria-label': 'Assistant Voyagéo' },
    h('header', { class: 'vy-chat-head' },
      h('div', {}, h('strong', {}, 'Assistant Voyagéo'), h('div', { class: 'small' }, 'Réponses immédiates, 24 h/24')),
      h('button', { class: 'vy-chat-close', type: 'button', 'aria-label': 'Fermer l’assistant', onclick: () => toggle(false) }, '×')),
    log, form);

  const launcher = h('button', { class: 'vy-fab vy-fab-chat', type: 'button', 'aria-label': 'Ouvrir l’assistant Voyagéo', 'aria-expanded': 'false', 'aria-controls': 'vy-chat-panel', onclick: () => toggle(!open) },
    h('img', { src: '/img/chat.svg', alt: '', width: 28, height: 28 }));
  const wa = h('a', { class: 'vy-fab vy-fab-wa', href: waHref('Bonjour Voyagéo, j’ai besoin d’aide.'), target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Service client WhatsApp ${state.config.whatsapp?.affichage || ''}`, title: 'Service client WhatsApp' },
    h('img', { src: '/img/whatsapp.svg', alt: '', width: 28, height: 28 }));
  const root = h('div', { class: 'vy-chat-root no-print' }, panel, h('div', { class: 'vy-fabs' }, wa, launcher));
  document.body.append(root);

  function toggle(v) {
    open = v; panel.hidden = !v; launcher.setAttribute('aria-expanded', String(v));
    if (v) { render(); input.focus(); }
  }

  function bubble(m, isLast) {
    if (m.de === 'moi') return h('div', { class: 'vy-msg vy-msg-me' }, m.texte);
    return h('div', { class: 'vy-msg vy-msg-bot' },
      h('div', { class: 'vy-msg-text' }, m.texte),
      (m.liens || []).length ? h('div', { class: 'vy-msg-links' }, m.liens.map((l) => h('a', { href: safeHref(l.href), target: l.href.startsWith('/') ? null : '_blank', rel: 'noopener noreferrer' }, l.label))) : null,
      m.whatsapp ? h('a', { class: 'vy-wa-btn', href: waHref(m.question ? `Bonjour Voyagéo, ma question : « ${m.question} »` : 'Bonjour Voyagéo, j’ai besoin d’aide.'), target: '_blank', rel: 'noopener noreferrer' },
        h('img', { src: '/img/whatsapp.svg', alt: '', width: 18, height: 18 }), 'Continuer sur WhatsApp') : null,
      isLast && (m.suggestions || []).length ? h('div', { class: 'vy-chips' }, m.suggestions.map((s) => h('button', { class: 'vy-chip', type: 'button', onclick: () => ask(s) }, s))) : null);
  }
  function render() {
    clear(log).append(messages.map((m, i) => bubble(m, i === messages.length - 1)), busy ? h('div', { class: 'vy-msg vy-msg-bot vy-typing', 'aria-label': 'L’assistant écrit' }, '…') : null);
    log.scrollTop = log.scrollHeight;
  }

  async function ask(text) {
    const q = String(text || '').trim();
    if (!q || busy) return;
    input.value = '';
    messages.push({ de: 'moi', texte: q });
    busy = true; sendBtn.disabled = true; render();
    try {
      const r = await api.post('/api/bot', { message: q });
      messages.push({ de: 'bot', texte: r.texte, liens: r.liens, suggestions: r.suggestions, whatsapp: r.whatsapp !== false, question: q });
    } catch (e) {
      messages.push({ de: 'bot', texte: 'Je ne peux pas répondre pour le moment. Notre service client vous répond sur WhatsApp.', whatsapp: true, question: q, suggestions: [] });
    }
    busy = false; sendBtn.disabled = false; save(messages); render(); input.focus();
  }
}
