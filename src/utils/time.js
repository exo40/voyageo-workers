'use strict';
const config = require('../config');

function offsetMs() {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(config.reservation.utcOffset);
  if (!m) return 3600000;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000;
}
/** Date du jour (AAAA-MM-JJ) à l'heure du Bénin. */
const todayStr = (now = Date.now()) => new Date(now + offsetMs()).toISOString().slice(0, 10);
/** Date + heure du départ en vrai instant (millisecondes). */
const departureTime = (date, heure) => new Date(`${date}T${heure.slice(0, 5)}:00${config.reservation.utcOffset}`).getTime();
const addDays = (dateStr, n) => new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

module.exports = { todayStr, departureTime, addDays };
