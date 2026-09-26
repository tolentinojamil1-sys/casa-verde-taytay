// Reveal each section once it enters view, without blocking content if JS is unavailable.
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const targets = document.querySelectorAll(
    '.section-head, .experience-card, .amenity-card, .reviews-panel, .calendarCard, .booking > form, .booking > aside, .grid4 > div, .amenities > span'
  );
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -25px 0px' });

  for (const element of targets) {
    if (element.getBoundingClientRect().top < window.innerHeight * 0.9) continue;
    element.classList.add('motion-pending');
    observer.observe(element);
  }
  document.documentElement.classList.add('motion-ready');
}
