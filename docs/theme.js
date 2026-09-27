(() => {
  const root = document.documentElement;
  const button = document.getElementById('themeToggle');
  if (!button) return;
  const saved = localStorage.getItem('casa-verde-theme');
  const preferredDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  function apply(theme) {
    root.dataset.theme = theme;
    const dark = theme === 'dark';
    button.textContent = dark ? '☀️' : '🌙';
    button.setAttribute('aria-label', dark ? 'Switch to day mode' : 'Switch to dark mode');
    button.title = dark ? 'Day mode' : 'Dark mode';
  }
  apply(saved || (preferredDark ? 'dark' : 'light'));
  button.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('casa-verde-theme', next);
    apply(next);
  });
})();
