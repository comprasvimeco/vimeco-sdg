/* VIMECO S.A. — UI helpers compartidos */

window.escHtml = function (str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

function _toast(msg, type) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = {
    success: icSvg('checkSm'),
    error:   icSvg('x'),
    warning: icSvg('alert'),
    info:    icSvg('info'),
  };
  el.innerHTML = `<span>${icons[type] || icons.info}</span><span>${escHtml(msg)}</span>`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, 4500);
}

window.toast     = (msg, type = 'info')    => _toast(msg, type);
window.showToast = (msg, type = 'success') => _toast(msg, type);

const HEADER_TABS = [
  { id: 'computo',     label: 'Cómputo',     href: 'computo.html' },
  { id: 'carga-fija',  label: 'Carga Fija',  href: 'carga-fija.html' },
  { id: 'presupuesto', label: 'Presupuesto', href: 'presupuesto.html' },
  { id: 'materiales',  label: 'Materiales',  href: 'materiales-obra.html' },
];

window.renderHeaderTabs = function (obraKey, active) {
  const el = document.getElementById('header-tabs');
  if (!el) return;
  el.innerHTML = HEADER_TABS.map(t =>
    `<a class="header-tab${t.id === active ? ' active' : ''}" href="${t.href}?obra=${encodeURIComponent(obraKey)}">${t.label}</a>`
  ).join('');
};

window.showConfirm = function (title, msg) {
  return new Promise(resolve => {
    document.getElementById('modal-confirm-title').textContent = title;
    document.getElementById('modal-confirm-msg').textContent   = msg;
    const modal = document.getElementById('modal-confirm');
    modal.classList.remove('hidden');
    document.getElementById('modal-confirm-no').onclick  = () => { modal.classList.add('hidden'); resolve(false); };
    document.getElementById('modal-confirm-yes').onclick = () => { modal.classList.add('hidden'); resolve(true); };
  });
};
