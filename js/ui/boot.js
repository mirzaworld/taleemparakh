// Runs before the home page paints (a plain script file, because the CSP forbids inline scripts). It marks that
// JavaScript is on, and whether the address asks for a panel (?tab=...) or the story, so the story and the checks
// never swap places after the first paint (no layout shift). Without JavaScript neither mark is set, and the story
// and the checks both show as plain sections. Nothing is stored or sent.
(function () {
  var d = document.documentElement;
  d.classList.add('js');
  var tab = null;
  try { tab = new URLSearchParams(location.search).get('tab'); } catch (e) { tab = null; }
  d.setAttribute('data-boot', tab ? 'panel' : 'story');
})();
