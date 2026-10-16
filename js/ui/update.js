// "A new version is ready" bar (addendum F.3; service worker flow from Lane C). The worker waits instead of taking
// over mid-use; this shows one bar, and "Update now" asks the waiting worker to take over, then reloads once.
// Never blocks reading: the bar is a polite status region with one button.
export function watchUpdates({ text, button }) {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  let reloading = false;
  let bar = null;
  const show = (reg) => {
    if (!reg?.waiting || bar) return;
    bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.setAttribute('role', 'status');
    const p = document.createElement('p');
    p.textContent = text;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'primary';
    b.textContent = button;
    b.addEventListener('click', () => { reloading = true; b.disabled = true; reg.waiting?.postMessage({ type: 'TP_SKIP_WAITING' }); });
    bar.append(p, b);
    document.body.append(bar);
  };
  const check = () => sw.getRegistration().then(show).catch(() => {});
  sw.addEventListener('message', (e) => { if (e.data?.type === 'TP_UPDATE_READY') check(); });
  sw.addEventListener('controllerchange', () => { if (reloading) location.reload(); });
  sw.getRegistration().then((reg) => {
    if (!reg) return;
    show(reg);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && sw.controller) show(reg); });
    });
  }).catch(() => {});
  setInterval(() => { if (document.visibilityState === 'visible') sw.getRegistration().then((r) => r?.update()).catch(() => {}); }, 30 * 60 * 1000);
}
