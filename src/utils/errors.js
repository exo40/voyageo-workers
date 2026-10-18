'use strict';
/** Erreur "métier" : le message est affiché à l'utilisateur. */
class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
  }
}
/** Permet d'utiliser async/await dans les routes Express 4. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
module.exports = { AppError, asyncHandler };
