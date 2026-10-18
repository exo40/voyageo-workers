// Composants réutilisables de l'administration : badges, boutons, tableaux filtrables, formulaires, confirmations, fiches latérales.
import { api, qs } from './api.js';
import { h, $, clear, toast, alertBox } from './ui.js';
import { icon } from './icons.js';

// ---------- formats ----------
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Porto-Novo' }) : '—');
export const fmtDay = (d) => (d ? new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)) : '—');
export const fmtMoney = (n) => `${new Intl.NumberFormat('fr-FR').format(n || 0).replace(/[\u202f\u00a0]/g, '\u00a0')}\u00a0FCFA`;
export const fmtDuree = (m) => (m == null ? '—' : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`);
export const initials = (u) => `${(u.prenom || '?')[0]}${(u.nom || '')[0] || ''}`.toUpperCase();

// ---------- badges d'état (couleurs identiques partout) ----------
const PILLS = {
  non_requis: ['Sans abonnement', ''], expire: ['Expiré', 'bad'],
  confirmee: ['Confirmée', 'ok'], en_attente: ['En attente', 'warn'], annulee: ['Annulée', 'bad'],
  programme: ['Programmé', 'info'], annule: ['Annulé', 'bad'], termine: ['Terminé', 'ok'],
  actif: ['Actif', 'ok'], bloque: ['Suspendu', 'bad'], active: ['Active', 'ok'], inactive: ['Désactivée', ''],
  confirme: ['Confirmé', 'ok'], simule: ['Simulé', 'info'], a_verifier: ['À vérifier', 'warn'], echoue: ['Échoué', 'bad'], a_rembourser: ['À rembourser', 'bad'], rembourse: ['Remboursé', ''],
  voyageur: ['Voyageur', ''], gestionnaire: ['Gestionnaire', 'info'], admin: ['Administrateur', 'ok'],
};
export const pill = (key) => { const [l, c] = PILLS[key] || [key, '']; return h('span', { class: `pill ${c}`.trim(), text: l }); };
export const ROLE_LABEL = { voyageur: 'Voyageur', gestionnaire: 'Gestionnaire', admin: 'Administrateur' };

// ---------- boutons ----------
export function btnA(label, { ic, danger = false, onclick, title, cls = '' } = {}) {
  const b = h('button', { type: 'button', class: `btn-a ${danger ? 'danger' : ''} ${cls}`.trim(), title: title || null, 'aria-label': title || label }, ic ? icon(ic, 15) : null, label ? h('span', {}, label) : null);
  if (onclick) b.addEventListener('click', (e) => { e.stopPropagation(); onclick(e, b); });
  return b;
}
/** Désactive le bouton pendant l'action (évite les doubles clics) et affiche un indicateur de chargement. */
export async function busy(button, fn) {
  if (!button || button.disabled) return undefined;
  const html = [...button.childNodes];
  button.disabled = true; button.classList.add('loading');
  clear(button).append(h('span', { class: 'spin', 'aria-hidden': 'true' }), ' ', h('span', {}, 'Patientez…'));
  try { return await fn(); } finally { button.disabled = false; button.classList.remove('loading'); clear(button).append(...html); }
}

// ---------- cartes de synthèse ----------
/** cmp : { valeur, precedent, variation_pct }. invert : une hausse est une mauvaise nouvelle (annulations, échecs). */
export function deltaBadge(cmp, { invert = false, unit = '' } = {}) {
  if (!cmp) return null;
  if (cmp.variation_pct == null) return cmp.valeur > 0 ? h('span', { class: 'delta', title: 'Aucune donnée sur la période précédente' }, 'nouveau') : null;
  const up = cmp.variation_pct > 0, flat = cmp.variation_pct === 0;
  const good = flat ? '' : (up !== invert ? 'good' : 'bad');
  return h('span', { class: `delta ${good}`, title: `Période précédente : ${cmp.precedent}${unit}` }, flat ? '=' : icon(up ? 'up' : 'down', 12), `${up ? '+' : ''}${cmp.variation_pct} %`);
}
export function kpiCard({ label, value, delta, note, ic, small = false, warn = false }) {
  return h('div', { class: `kpi-a${warn ? ' kpi-warn' : ''}` }, h('div', { class: 'lbl' }, ic ? icon(ic, 15) : null, label),
    h('div', { class: `val num${small ? ' sm' : ''}` }, value), (delta || note) ? h('div', { class: 'note' }, delta, delta && note ? ' ' : null, note) : null);
}

// ---------- confirmation ----------
export function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    const el = $('#confirmModal');
    const modal = window.bootstrap.Modal.getOrCreateInstance(el);
    $('#confirmTitle').textContent = title;
    clear($('#confirmBody')).append(typeof message === 'string' ? h('p', { class: 'mb-0' }, message) : message);
    const ok = $('#confirmOk');
    ok.textContent = confirmLabel; ok.className = `btn ${danger ? 'btn-danger' : 'btn-vy'}`;
    let result = false;
    ok.onclick = () => { result = true; modal.hide(); };
    el.addEventListener('hidden.bs.modal', () => resolve(result), { once: true });
    modal.show();
  });
}

// ---------- formulaire dans une fenêtre ----------
/** fields : { k, l, t: text|number|select|date|time|tel|email|password|url|textarea, req, options, hint, min, max, placeholder } */
/** Redimensionne la photo choisie dans le navigateur (JPEG, 1280 px max) avant envoi : rapide même avec une photo de téléphone. */
async function resizeImage(file, max = 1280) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choisissez une image JPEG, PNG ou WebP.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Image trop lourde (15 Mo maximum).');
  const bmp = await createImageBitmap(file);
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  let url = c.toDataURL('image/jpeg', 0.82);
  if (url.length > 1.9e6) url = c.toDataURL('image/jpeg', 0.6);
  if (url.length > 1.9e6) throw new Error('Image trop lourde : choisissez une photo plus petite.');
  return url;
}
function imageField(f, value) {
  const el = h('input', { type: 'hidden', id: `f_${f.k}`, value: value ?? '' });
  const fallback = f.round ? '/img/chauffeur-defaut.svg' : '/img/bus-defaut.svg';
  const preview = h('img', { class: `preview${f.round ? ' round' : ''}`, alt: 'Aperçu de la photo' });
  const file = h('input', { type: 'file', class: 'form-control form-control-sm', accept: 'image/jpeg,image/png,image/webp', 'aria-label': f.l });
  const remove = h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary' }, 'Retirer la photo');
  const show = () => { const src = el.dataset.pending || el.value; preview.src = src || fallback; remove.hidden = !src; };
  file.addEventListener('change', async () => {
    const fl = file.files[0]; if (!fl) return;
    try { el.dataset.pending = await resizeImage(fl); clear($('#modalError')); } catch (e) { $('#modalError').textContent = e.message; file.value = ''; return; }
    show();
  });
  remove.addEventListener('click', () => { delete el.dataset.pending; el.value = ''; file.value = ''; show(); });
  show();
  return { el, node: h('div', { class: 'img-field' }, preview, h('div', {}, file, h('div', { class: 'mt-1' }, remove), el)) };
}

export async function openForm({ title, fields, values = {}, submitLabel = 'Enregistrer', onSubmit, intro }) {
  const modalEl = $('#formModal');
  const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
  $('#formModalTitle').textContent = title; $('#modalSubmit').textContent = submitLabel; clear($('#modalError'));
  const inputs = {};
  const body = clear($('#modalBody'));
  if (intro) body.append(h('p', { class: 'note-box' }, intro));
  for (const f of fields) {
    let el, node;
    if (f.t === 'image') {
      ({ el, node } = imageField(f, values[f.k]));
    } else if (f.t === 'select') {
      const opts = typeof f.options === 'function' ? await f.options() : f.options;
      el = h('select', { class: 'form-select', id: `f_${f.k}`, required: !!f.req }, f.placeholder ? h('option', { value: '' }, f.placeholder) : null,
        opts.map(([v, l, c]) => h('option', { value: String(v), 'data-company': c ?? null, selected: String(values[f.k] ?? '') === String(v) }, l)));
    } else if (f.t === 'textarea') {
      el = h('textarea', { class: 'form-control', id: `f_${f.k}`, rows: 3, required: !!f.req, maxlength: f.max || null }, values[f.k] ?? '');
    } else {
      el = h('input', { class: 'form-control', id: `f_${f.k}`, type: f.t || 'text', value: values[f.k] ?? '', required: !!f.req, autocomplete: f.t === 'password' ? 'new-password' : 'off', min: f.min ?? null, max: f.max ?? null, placeholder: f.placeholder || null });
    }
    inputs[f.k] = el;
    body.append(h('div', { class: 'mb-3' }, h('label', { class: `form-label${f.req ? ' required' : ''}`, for: `f_${f.k}` }, f.l), node || el, f.hint ? h('div', { class: 'form-text' }, f.hint) : null));
  }
  // Voyage : seuls les bus de la compagnie du trajet choisi sont sélectionnables.
  if (inputs.id_trajet && inputs.id_bus) {
    const sync = () => {
      const company = inputs.id_trajet.selectedOptions[0]?.dataset.company || '';
      for (const sel of [inputs.id_bus, inputs.id_chauffeur].filter(Boolean)) {
        for (const o of sel.options) { const ok = !company || !o.dataset.company || o.dataset.company === company; o.disabled = !ok; o.hidden = !ok; }
        if (sel.selectedOptions[0]?.disabled) sel.value = '';
      }
    };
    inputs.id_trajet.addEventListener('change', sync); sync();
  }
  const form = $('#modalForm'), submit = $('#modalSubmit');
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    clear($('#modalError'));
    if (!form.checkValidity()) { form.reportValidity(); $('#modalError').textContent = 'Complétez les champs obligatoires.'; return; }
    const label = submit.textContent;
    submit.disabled = true; clear(submit).append(h('span', { class: 'spin', 'aria-hidden': 'true' }), ' Enregistrement…');
    try {
      // Les photos choisies sont envoyées d'abord ; on garde seulement leur adresse.
      for (const el of Object.values(inputs)) if (el.dataset && el.dataset.pending) { el.value = (await api.post('/api/admin/upload', { image: el.dataset.pending })).url; delete el.dataset.pending; }
      const data = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
      await onSubmit(data); modal.hide();
    }
    catch (err) { $('#modalError').textContent = err.message; }
    finally { submit.disabled = false; submit.textContent = label; submit.focus(); }
  };
  modalEl.addEventListener('shown.bs.modal', () => Object.values(inputs)[0]?.focus(), { once: true });
  modal.show();
}

// ---------- fiche latérale ----------
export function openDrawer(title) {
  const el = $('#detailDrawer');
  const oc = window.bootstrap.Offcanvas.getOrCreateInstance(el);
  $('#drawerTitle').textContent = title;
  const body = $('#drawerBody');
  clear(body).append(h('div', { class: 'loading-row' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
  oc.show();
  return {
    setTitle: (t) => { $('#drawerTitle').textContent = t; },
    fill: (...nodes) => clear(body).append(...nodes),
    error: (e) => clear(body).append(alertBox(e.message || 'Chargement impossible.')),
    close: () => oc.hide(),
  };
}
export const dl = (pairs) => h('dl', { class: 'dl' }, pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v ?? '—')]));

// ---------- liste filtrable avec pagination ----------
/**
 * load(params, page, size) -> { rows, total, pages, page }
 * filters : { k, label, type: 'search'|'select'|'date'|'text', options: [[valeur, libellé]], placeholder, datalist }
 */
export function listView({ filters = [], load, columns, actions, onRow, emptyTitle = 'Aucun résultat', emptyText = 'Modifiez les filtres pour élargir la recherche.', pageSize = 25, exportPath = null, initial = {}, rowClass }) {
  const params = { ...initial };
  let page = 1, seq = 0, timer = null, lastTotal = 0;
  const card = h('div', { class: 'tbl-card' });
  const pager = h('div', { class: 'pager', hidden: true });
  const controls = {};
  const reloadSoon = (ms = 0) => { clearTimeout(timer); timer = setTimeout(() => { page = 1; reload(); }, ms); };

  const bar = h('div', { class: 'toolbar' }, filters.map((f) => {
    const id = `flt_${f.k}`;
    let input;
    if (f.type === 'select') {
      input = h('select', { class: 'form-select', id }, f.options.map(([v, l]) => h('option', { value: v, selected: String(params[f.k] ?? '') === String(v) }, l)));
      input.addEventListener('change', () => { params[f.k] = input.value || undefined; reloadSoon(); });
    } else {
      input = h('input', { class: 'form-control', id, type: f.type === 'date' ? 'date' : 'text', value: params[f.k] ?? '', placeholder: f.placeholder || null, list: f.datalist || null, autocomplete: 'off', 'aria-label': f.label });
      input.addEventListener('input', () => { params[f.k] = input.value.trim() || undefined; reloadSoon(f.type === 'date' ? 0 : 300); });
    }
    controls[f.k] = input;
    return h('div', { class: `f${f.type === 'search' ? ' search' : ''}` }, h('label', { for: id }, f.label), f.type === 'search' ? h('div', { class: 'search-wrap' }, icon('search', 16), input) : input);
  }), h('div', { class: 'grow' }),
  filters.length ? btnA('Réinitialiser', { ic: 'undo', onclick: () => { for (const f of filters) { params[f.k] = initial[f.k]; controls[f.k].value = initial[f.k] ?? ''; } page = 1; reload(); } }) : null,
  exportPath ? btnA('Exporter en CSV', { ic: 'download', onclick: () => { window.location.assign(`${exportPath}${qs(params)}`); toast('Export en cours de téléchargement…', 'info'); } }) : null);

  function renderTable(res) {
    lastTotal = res.total;
    const thead = h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col', class: c.cls || '' }, c.l)), actions ? h('th', { scope: 'col', class: 'r' }, 'Actions') : null));
    const tbody = h('tbody', {}, res.rows.map((r) => {
      const tr = h('tr', { class: `${onRow ? 'click' : ''} ${rowClass ? rowClass(r) : ''}`.trim(), tabindex: onRow ? 0 : null });
      if (onRow) { tr.addEventListener('click', () => onRow(r)); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') onRow(r); }); }
      tr.append(columns.map((c) => h('td', { 'data-label': c.l, class: c.cls || '' }, c.f(r) ?? '—')), actions ? h('td', { class: 'acts-cell r' }, h('div', { class: 'acts' }, actions(r))) : null);
      return tr;
    }));
    clear(card).append(res.rows.length ? h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl stack' }, thead, tbody)) : h('div', { class: 'empty' }, h('strong', {}, emptyTitle), emptyText), pager);
    pager.hidden = !res.rows.length;
    const from = (res.page - 1) * pageSize + 1, to = from + res.rows.length - 1;
    clear(pager).append(h('span', { class: 'num' }, `${from}–${to} sur ${res.total}`),
      h('div', { class: 'btns' }, btnA('', { ic: 'chevronL', title: 'Page précédente', onclick: () => { if (res.page > 1) { page = res.page - 1; reload(); } } }),
        h('span', { class: 'num' }, `Page ${res.page} / ${res.pages}`),
        btnA('', { ic: 'chevronR', title: 'Page suivante', onclick: () => { if (res.page < res.pages) { page = res.page + 1; reload(); } } })));
    pager.querySelectorAll('button')[0].disabled = res.page <= 1; pager.querySelectorAll('button')[1].disabled = res.page >= res.pages;
  }
  async function reload() {
    const mine = ++seq;
    clear(card).append(h('div', { class: 'loading-row' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
    try {
      const res = await load({ ...params }, page, pageSize);
      if (mine === seq) renderTable(res);
    } catch (e) {
      if (mine !== seq) return;
      if (e.status === 401) { location.replace(`/connexion.html?suite=${encodeURIComponent(location.pathname)}`); return; }
      clear(card).append(h('div', { class: 'empty' }, h('strong', {}, 'Chargement impossible'), e.message, h('div', { class: 'mt' }, btnA('Réessayer', { ic: 'refresh', onclick: reload }))));
    }
  }
  reload();
  return { el: h('div', {}, filters.length || exportPath ? bar : null, card), reload, total: () => lastTotal };
}

/** Filtrage et pagination en mémoire (petites listes : compagnies, bus, trajets). */
export const localLoader = (getRows, match) => async (params, page, size) => {
  const all = (await getRows()).filter((r) => match(r, params));
  const pages = Math.max(1, Math.ceil(all.length / size)), p = Math.min(page, pages);
  return { rows: all.slice((p - 1) * size, p * size), total: all.length, pages, page: p };
};
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Liste paginée par le serveur : mappe la réponse de l'API vers { rows, total, pages, page }. */
export const remoteLoader = (api, path, key, extra = () => ({})) => async (params, page, size) => {
  const d = await api.get(`${path}${qs({ ...extra(), ...params, page, limite: size })}`);
  return { rows: d[key], total: typeof d.total === 'number' ? d.total : d.total_lignes, pages: d.pages, page: d.page };
};
