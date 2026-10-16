// "Print this page" button for the printable pages (checklist for parents, 5 checks poster). The button is made here,
// so a visitor without JavaScript never sees a button that does nothing; the page text then says to use the browser's
// print command. The label comes from the page (data-label), so it is in the page's own language.
import { icon } from './icons.js';

for (const slot of document.querySelectorAll('[data-print]')) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'primary';
  b.append(icon('print'), slot.dataset.label || 'Print');
  b.addEventListener('click', () => window.print());
  slot.replaceChildren(b);
  slot.hidden = false;
}
