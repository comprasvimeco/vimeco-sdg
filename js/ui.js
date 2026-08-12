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

/* Navegación de dos niveles dentro de una obra: "Datos" y "CyP" son las dos
   pantallas principales (pastillas del header azul) y cada una agrupa sus
   sub-pantallas (barra clara debajo del header). Se puede saltar de un grupo
   al otro sin pasar por obras.html: la pastilla lleva a la primera
   sub-pantalla del grupo. */
const HEADER_GROUPS = [
  {
    id: 'datos', label: 'Datos', tabs: [
      { id: 'datos',        label: 'Datos',        href: 'datos-obra.html' },
      { id: 'mano-obra',    label: 'Mano de Obra', href: 'mano-de-obra-obra.html' },
      { id: 'equipos',      label: 'Equipos',      href: 'equipos-obra.html' },
      { id: 'cotizaciones', label: 'Cotizaciones', href: 'cotizaciones-obra.html' },
    ],
  },
  {
    id: 'cyp', label: 'CyP', tabs: [
      { id: 'computo',     label: 'Cómputo',     href: 'computo.html' },
      { id: 'carga-fija',  label: 'Carga Fija',  href: 'carga-fija.html' },
      { id: 'presupuesto', label: 'Presupuesto', href: 'presupuesto.html' },
      { id: 'plan-avance', label: 'Plan de Avance', href: 'plan-avance.html' },
      { id: 'materiales',  label: 'Materiales',  href: 'materiales-obra.html' },
    ],
  },
];

window.renderHeaderTabs = function (obraKey, active) {
  const q = '?obra=' + encodeURIComponent(obraKey);
  const grupo = HEADER_GROUPS.find(g => g.tabs.some(t => t.id === active)) || HEADER_GROUPS[0];

  const el = document.getElementById('header-tabs');
  if (el) {
    el.innerHTML = HEADER_GROUPS.map(g =>
      `<a class="header-tab${g.id === grupo.id ? ' active' : ''}" href="${g.tabs[0].href}${q}">${g.label}</a>`
    ).join('');
  }

  const sub = document.getElementById('header-subtabs');
  if (sub) {
    sub.innerHTML = `<div class="subtabs">${grupo.tabs.map(t =>
      `<a class="subtab${t.id === active ? ' active' : ''}" href="${t.href}${q}">${t.label}</a>`
    ).join('')}</div>`;
  }
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
