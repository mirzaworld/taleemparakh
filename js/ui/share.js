// Share buttons for the About page (Lane B, 2026-10-16, Laiba audit G1). The Web Share API where the phone has it,
// a copy button where the clipboard is allowed, and two plain links (WhatsApp, email) that open the person's own app.
// No third-party scripts, nothing is sent from this page, and nothing is stored. Built with textContent only.
import { icon } from './icons.js';

export function mountShare(box, t) {
  if (!box) return;
  const url = box.dataset.shareUrl || 'https://taleemparakh.org/';
  const text = t('share.text');
  const status = document.createElement('span');
  status.className = 'small muted';
  status.setAttribute('role', 'status');
  const parts = [];
  if (navigator.share) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'primary';
    b.append(icon('share'), t('share.btn'));
    b.addEventListener('click', () => { navigator.share({ title: 'TaleemParakh', text, url }).catch(() => { /* closed without sharing */ }); });
    parts.push(b);
  }
  if (navigator.clipboard?.writeText) {
    const b = document.createElement('button');
    b.type = 'button';
    b.append(icon('link'), t('share.copy'));
    b.addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => { status.textContent = t('share.copied'); }).catch(() => { status.textContent = url; });
    });
    parts.push(b);
  }
  const link = (href, label, ic, external) => {
    const a = document.createElement('a');
    a.className = 'btn'; a.href = href;
    if (external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    a.append(icon(ic), label);
    return a;
  };
  parts.push(link(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, t('share.whatsapp'), 'chat', true));
  parts.push(link(`mailto:?subject=${encodeURIComponent('TaleemParakh')}&body=${encodeURIComponent(`${text} ${url}`)}`, t('share.email'), 'mail', false));
  box.replaceChildren(...parts, status);
}
