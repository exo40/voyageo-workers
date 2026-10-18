'use strict';

const session = require('express-session');
const db = require('../db');

class MySQLSessionStore extends session.Store {
  get(sid, callback) {
    db.getSession(sid).then(
      (value) => callback(null, value),
      (error) => callback(error)
    );
  }

  set(sid, sessionData, callback = () => {}) {
    const cookie = sessionData.cookie || {};
    const expires = cookie.expires
      ? new Date(cookie.expires).getTime()
      : Date.now() + (Number(cookie.originalMaxAge) || 86400000);

    db.setSession(sid, sessionData, expires).then(
      () => callback(null),
      (error) => callback(error)
    );
  }

  destroy(sid, callback = () => {}) {
    db.deleteSession(sid).then(
      () => callback(null),
      (error) => callback(error)
    );
  }

  touch(sid, sessionData, callback = () => {}) {
    const cookie = sessionData.cookie || {};
    const expires = cookie.expires
      ? new Date(cookie.expires).getTime()
      : Date.now() + (Number(cookie.originalMaxAge) || 86400000);

    db.touchSession(sid, expires).then(
      () => callback(null),
      (error) => callback(error)
    );
  }
}

module.exports = MySQLSessionStore;
