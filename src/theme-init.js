try {
  if (localStorage.getItem('night') === '1') document.documentElement.dataset.theme = 'dark';
} catch {}
