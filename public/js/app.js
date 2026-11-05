// Progressive enhancements only — every feature works without JavaScript.
document.addEventListener('DOMContentLoaded', () => {
  // Confirm dangerous actions (forms or buttons with data-confirm).
  document.addEventListener('submit', (e) => {
    const msg = e.target.dataset.confirm || (e.submitter && e.submitter.dataset.confirm);
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // Listing photo gallery.
  document.querySelectorAll('[data-gallery]').forEach((g) => {
    const main = g.querySelector('[data-main]');
    g.querySelectorAll('.thumb').forEach((t) => t.addEventListener('click', () => {
      main.src = t.dataset.src;
      g.querySelectorAll('.thumb').forEach((x) => x.classList.toggle('on', x === t));
    }));
  });

  // Preview photos before upload.
  document.querySelectorAll('input[data-preview]').forEach((input) => {
    const out = document.querySelector('[data-preview-out]');
    input.addEventListener('change', () => {
      out.innerHTML = '';
      [...input.files].slice(0, 10).forEach((f) => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        img.alt = f.name;
        out.appendChild(img);
      });
    });
  });

  // Keep chats scrolled to the newest message.
  const latest = document.getElementById('latest');
  if (latest) latest.scrollIntoView({ block: 'end' });
});
