// Interest forms on the School Safety Desk, pledge and CSR pages (BUILD-SPEC 6.1 to 6.3).
// Posts to the interest-submit function; shows a short status; never shows back what was sent.
import { CONFIG } from './lib/config.js';

for (const form of document.querySelectorAll('form.interest-form')) {
  // Public launch mode: no backend, so no form and no request. The page is built with this notice already.
  if (!CONFIG.backendOn) {
    const p = document.createElement('p');
    p.className = 'notice interest-closed';
    p.setAttribute('role', 'status');
    p.textContent = 'We are not taking sign-ups yet. You can use every check, guide and news update now, for free.';
    form.replaceWith(p);
    continue;
  }
  const out = form.querySelector('.interest-out');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form).entries());
    const body = { kind: form.dataset.kind, ...data, consent_to_contact: data.consent_to_contact === 'on' };
    if (body.kind === 'pledge') { body.amount_minor = Math.round(Number(data.amount) * 100); delete body.amount; }
    const button = form.querySelector('button');
    button.disabled = true;
    out.textContent = 'Sending...';
    try {
      const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/interest-submit`, {
        method: 'POST', credentials: 'omit',
        headers: { 'content-type': 'application/json', apikey: CONFIG.publishableKey },
        body: JSON.stringify(body),
      });
      out.textContent = res.status === 202 ? 'Thank you. We have your details and will be in touch.'
        : res.status === 429 ? 'Too many tries from this connection. Please try again later.'
        : res.status === 422 ? 'Please check the fields and try again.' : 'We could not save this right now. Please try again later.';
      if (res.status === 202) form.reset();
    } catch {
      out.textContent = 'We could not reach the service. Please try again later.';
    } finally {
      button.disabled = false;
    }
  });
}
