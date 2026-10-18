// Thème clair / sombre. Chargé en tout début de page (avant l'affichage) pour éviter un éclair blanc.
// Règle : le choix de la personne (mémorisé sur son appareil) l'emporte ; sinon on suit le réglage de son appareil.
(function () {
  var KEY = 'vy-theme', root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function stored() { try { var v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; } catch (e) { return null; } }
  function system() { return mq && mq.matches ? 'dark' : 'light'; }
  function current() { return stored() || system(); }
  function apply(t) {
    root.setAttribute('data-theme', t); root.setAttribute('data-bs-theme', t);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'dark' ? '#0E1620' : '#1F3A5F');
  }
  function set(t) { try { localStorage.setItem(KEY, t); } catch (e) { /* stockage indisponible : le choix vaut pour cette page seulement */ } apply(t); }
  apply(current());
  window.vyTheme = { current: current, set: set, toggle: function () { set(current() === 'dark' ? 'light' : 'dark'); } };
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (!stored()) apply(system()); });
})();
