(() => {
  const root = document.documentElement;
  const button = document.getElementById('themeToggle');
  if (!button) return;
  function apply(theme) {
    root.dataset.theme = theme;
    const dark = theme === 'dark';
    button.textContent = dark ? '☀️' : '🌙';
    button.setAttribute('aria-label', dark ? 'Switch to day mode' : 'Switch to dark mode');
    button.title = dark ? 'Day mode' : 'Dark mode';
  }
  apply('light');
  button.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
  });
})();
