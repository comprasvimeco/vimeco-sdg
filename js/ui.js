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
      { id: 'computo',          label: 'Cómputo',           href: 'computo.html' },
      { id: 'analisis-precio',  label: 'Análisis de Precio', href: 'item.html' },
      { id: 'carga-fija',       label: 'Carga Fija',        href: 'carga-fija.html' },
      { id: 'presupuesto',      label: 'Presupuesto',       href: 'presupuesto.html' },
      { id: 'plan-avance',      label: 'Plan de Avance',    href: 'plan-avance.html' },
      { id: 'insumos',          label: 'Insumos',           href: 'insumos-obra.html' },
      { id: 'exportar',         label: 'Exportar',          href: 'exportar.html' },
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
    el.classList.remove('hidden');
  }

  const sub = document.getElementById('header-subtabs');
  if (sub) {
    sub.innerHTML = `<div class="subtabs">${grupo.tabs.map(t =>
      `<a class="subtab${t.id === active ? ' active' : ''}" href="${t.href}${q}">${t.label}</a>`
    ).join('')}</div>`;
    sub.classList.remove('hidden');
  }
};

// -- Offsets de las barras fijas (header, sub-pestañas, y en item.html la
// barra terciaria de A.P.) — se miden en vivo porque en mobile el header
// cambia de alto según cuánto contenido envuelva, y las sub-pestañas recién
// tienen contenido después de renderHeaderTabs (fetch de la obra de por
// medio). CSS los lee como var(--header-h) / var(--subtabs-h) para apilar
// cada barra sticky justo debajo de la anterior sin pisarse. */
(function () {
  const root = document.documentElement;
  const header = document.querySelector('.app-header');
  if (!header) return;
  const subtabs = document.getElementById('header-subtabs');

  function medir(el) {
    return el && !el.classList.contains('hidden') ? el.offsetHeight : 0;
  }
  function actualizar() {
    root.style.setProperty('--header-h', medir(header) + 'px');
    root.style.setProperty('--subtabs-h', medir(subtabs) + 'px');
  }
  actualizar();

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(actualizar);
    ro.observe(header);
    if (subtabs) ro.observe(subtabs);
  } else {
    window.addEventListener('resize', actualizar);
  }
})();

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

/* Modo lectura / edición de una obra. En Ejecución o Terminada el default es
   siempre lectura (aunque se confirme editar, es un desbloqueo temporal de
   esta carga de página, nunca se persiste); en Preparación es un candado
   manual guardado en obra.soloLectura, que sí queda entre sesiones.
   window._soloLectura es lo que consultan los guards de guardado de cada
   pantalla (ver guardBloqueoObra). */
window.obraEsSoloLectura = function (obra) {
  const forzadaLectura = obra.estado === 'ejecucion' || obra.estado === 'terminada';
  return forzadaLectura || !!obra.soloLectura;
};

// Botones/inputs que sólo tienen sentido en modo edición pero no se
// regeneran en cada render (viven fijos en el HTML, engancha su listener
// una sola vez en DOMContentLoaded) — se marcan con data-solo-edicion y esta
// función los deshabilita/habilita cada vez que cambia el modo. Lo que sí se
// regenera en cada render (inputs de una lista, botones por fila) resuelve su
// propio "disabled" leyendo window._soloLectura directo en la plantilla.
window.aplicarModoLecturaEstatico = function () {
  document.querySelectorAll('[data-solo-edicion]').forEach(el => {
    el.disabled = !!window._soloLectura;
  });
};

window.setModoObra = function (obraKey, obra, onChange) {
  const forzadaLectura = obra.estado === 'ejecucion' || obra.estado === 'terminada';
  window._soloLectura = forzadaLectura || !!obra.soloLectura;

  const btn = document.getElementById('header-modo');
  if (!btn) return;

  function pintar() {
    btn.innerHTML = icSvg(window._soloLectura ? 'eye' : 'edit');
    btn.title = window._soloLectura
      ? 'Obra en modo lectura — clic para pasar a edición'
      : 'Obra en modo edición — clic para pasar a lectura';
    btn.setAttribute('aria-label', btn.title);
    window.aplicarModoLecturaEstatico();
  }
  pintar();

  function aplicarCambio() {
    pintar();
    if (typeof onChange === 'function') onChange();
  }

  btn.onclick = async () => {
    if (window._soloLectura) {
      if (forzadaLectura) {
        const label = obra.estado === 'terminada' ? 'terminada' : 'en ejecución';
        const ok = await showConfirm('Pasar a modo edición',
          `Esta obra está ${label}. ¿Confirmás editar igual? Al volver a entrar queda en modo lectura de nuevo.`);
        if (!ok) return;
        window._soloLectura = false;
        aplicarCambio();
      } else {
        try {
          await _fbPatch(`/obras/${obraKey}.json`, { soloLectura: false });
        } catch (_) {
          showToast('Error al cambiar el modo de la obra.', 'error');
          return;
        }
        window._soloLectura = false;
        aplicarCambio();
      }
    } else {
      if (forzadaLectura) {
        window._soloLectura = true;
        aplicarCambio();
      } else {
        try {
          await _fbPatch(`/obras/${obraKey}.json`, { soloLectura: true });
        } catch (_) {
          showToast('Error al cambiar el modo de la obra.', 'error');
          return;
        }
        window._soloLectura = true;
        aplicarCambio();
      }
    }
  };
};

// Red de seguridad: con los controles ya deshabilitados en modo lectura esto
// no debería dispararse en el uso normal, pero queda como última barrera
// (y para cualquier escritura que se dispare por código, no por un control).
window.guardBloqueoObra = function () {
  if (window._soloLectura) {
    toast('Esta obra está en modo lectura. Activá el modo edición en el encabezado para guardar cambios.', 'warning');
    return true;
  }
  return false;
};
