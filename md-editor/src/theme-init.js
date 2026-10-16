// Runs before the page paints, so the first frame already has the right colours.
// 'theme' = auto (follow the system) | light | dark; 'night' is the pre-Auto key ('1' = the user chose dark).
(function () {
  var pref = 'auto';
  try {
    pref = localStorage.getItem('theme');
    if (pref !== 'light' && pref !== 'dark' && pref !== 'auto') pref = localStorage.getItem('night') === '1' ? 'dark' : 'auto';
  } catch (e) {
    pref = 'auto';
  }
  var dark = pref === 'dark' || (pref === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.themePref = pref;
})();
