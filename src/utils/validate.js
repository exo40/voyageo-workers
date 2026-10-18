'use strict';
const { AppError } = require('./errors');
const bad = (msg) => new AppError(400, msg, 'VALIDATION');

function reqStr(v, label, { min = 1, max = 255 } = {}) {
  if (typeof v !== 'string') throw bad(`${label} est obligatoire.`);
  const s = v.trim().replace(/\s+/g, ' ');
  if (s.length < min || (min > 0 && !s)) throw bad(`${label} est obligatoire.`);
  if (s.length > max) throw bad(`${label} est trop long (${max} caractères maximum).`);
  return s;
}
function optStr(v, label, { max = 255 } = {}) {
  if (v === undefined || v === null || v === '') return null;
  return reqStr(v, label, { min: 0, max }) || null;
}
function reqInt(v, label, { min = 0, max = 1e9 } = {}) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} doit être un nombre entier entre ${min} et ${max}.`);
  return n;
}
function reqEnum(v, label, list) {
  if (!list.includes(v)) throw bad(`${label} n'est pas valide.`);
  return v;
}
function reqDate(v, label) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad(`${label} doit être une date valide (AAAA-MM-JJ).`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad(`${label} n'est pas une date valide.`);
  return v;
}
function reqTime(v, label) {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim())) throw bad(`${label} doit être une heure valide (HH:MM).`);
  return v.trim();
}
function reqEmail(v, label = "L'adresse e-mail") {
  const s = reqStr(v, label, { max: 190 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw bad(`${label} n'est pas valide.`);
  return s;
}
function reqPhone(v, label = 'Le numéro de téléphone') {
  const s = reqStr(v, label, { max: 25 });
  const digits = s.replace(/\D/g, '');
  if (!/^\+?[0-9 ().-]+$/.test(s) || digits.length < 8 || digits.length > 15) throw bad(`${label} n'est pas valide (8 à 15 chiffres).`);
  return s;
}
function reqPassword(v, label = 'Le mot de passe') {
  if (typeof v !== 'string' || v.length < 8) throw bad(`${label} doit contenir au moins 8 caractères.`);
  if (v.length > 128) throw bad(`${label} est trop long.`);
  return v;
}
const normCity = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-’']/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/** Lien de carte facultatif : uniquement https:// vers un service de cartographie connu (refuse javascript:, sites inconnus...). */
const MAP_HOSTS = ['google.com', 'google.bj', 'goo.gl', 'maps.app.goo.gl', 'openstreetmap.org', 'osm.org', 'waze.com', 'bing.com', 'what3words.com', 'plus.codes'];
function optMapsUrl(v, label = 'Le lien Google Maps') {
  const s = optStr(v, label, { max: 500 });
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { throw bad(`${label} n'est pas une adresse web valide (collez le lien complet, qui commence par https://).`); }
  const host = u.hostname.toLowerCase();
  const okHost = MAP_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
  if (u.protocol !== 'https:' || !okHost) throw bad(`${label} doit commencer par https:// et venir de Google Maps (ou OpenStreetMap, Waze).`);
  if (/(^|\.)google\.[a-z.]+$/.test(host) && !host.startsWith('maps.') && !u.pathname.startsWith('/maps')) throw bad(`${label} doit être un lien Google Maps.`);
  return u.toString();
}
/** Photo déjà enregistrée par le serveur (/uploads/<nom>.jpg|png|webp) : refuse toute autre adresse. */
function optPhoto(v, label = 'La photo') {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\/uploads\/[a-f0-9]{16}\.(jpg|png|webp)$/.test(v)) throw bad(`${label} est invalide : téléversez à nouveau l'image.`);
  return v;
}
module.exports = { optPhoto, optMapsUrl, reqStr, optStr, reqInt, reqEnum, reqDate, reqTime, reqEmail, reqPhone, reqPassword, normCity };
