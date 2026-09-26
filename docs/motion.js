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

// A lightweight reading progress line follows scrolling without moving page content.
const progress = document.createElement('div');
progress.className = 'scroll-progress';
progress.setAttribute('aria-hidden', 'true');
document.body.append(progress);
let progressFrame = 0;
function updateProgress() {
  progressFrame = 0;
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  progress.style.transform = `scaleX(${scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0})`;
}
window.addEventListener('scroll', () => {
  if (!progressFrame) progressFrame = requestAnimationFrame(updateProgress);
}, { passive: true });
window.addEventListener('resize', updateProgress);
updateProgress();
