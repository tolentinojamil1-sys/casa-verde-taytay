(() => {
  const root = document.documentElement;
  const button = document.getElementById('themeToggle');
  if (!button) return;

  const saved = localStorage.getItem('casa-verde-theme');
  const preferredDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initial = saved || (preferredDark ? 'dark' : 'light');

  function apply(theme) {
    root.dataset.theme = theme;
    const dark = theme === 'dark';
    button.textContent = dark ? '☀️' : '🌙';
    button.setAttribute('aria-label', dark ? 'Switch to day mode' : 'Switch to dark mode');
    button.setAttribute('title', dark ? 'Day mode' : 'Dark mode');
  }

  apply(initial);

  button.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('casa-verde-theme', next);
    apply(next);
  });
})();
