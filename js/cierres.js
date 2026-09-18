/* VIMECO S.A. — Sistema de Gestión — Versiones de una obra

   Una versión es la foto de la obra entera en un momento: los A.P. con su
   receta, la ficha de cada máquina, los precios, los roles, el Cómputo, la
   Carga Fija y el Plan. Congela también el catálogo global que la obra usa
   —compartido entre obras, y por eso capaz de moverle el número a una oferta
   ya presentada— y guarda el resultado, para avisar si algún día deja de
   reproducirse. El motor está en js/cierreDatos.js y el modo de consulta en
   js/versionModo.js; acá sólo vive la pantalla.

   El nodo se llama /obras/{obraKey}/cierres, y los archivos cierreDatos.js y
   cierres.js igual: así nacieron en v188, cuando esto era sólo "cerrar un
   presupuesto". "Versión" es cómo se lo nombra en pantalla desde que se lo
   empezó a usar también para guardar los análisis reales antes de retocarlos.

   Guardar una versión no modifica la obra, así que se puede hacer aunque esté
   en modo lectura — que es el estado normal de una obra en ejecución o
   terminada, donde más sentido tiene. Por eso esta pantalla no tiene el botón
   de ojo/lápiz del resto. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let modeloVivo = null;
let planVivo = null;
let insumosVivos = null;
let cierres = [];        // [{ key, meta }] — sólo la ficha, nunca las fotos
let anulandoKey = null;
let restaurandoKey = null;
let editandoKey = null;
let restaurandoCierre = null;
// La obra en modo lectura no se restaura sin desbloquearla antes: restaurar sí
// la modifica, y bastante (ver js/ui.js, modo lectura/edición por obra).
let obraBloqueada = false;

const fmtFechaHora = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

/* ===== Lista ===== */

function renderCierres() {
  const cont = $('lista-cierres');
  if (!cierres.length) {
    cont.innerHTML = `<div class="empty-state"><p>Todavía no se guardó ninguna versión de esta obra.</p></div>`;
    return;
  }

  cont.innerHTML = cierres.map(c => {
    const m = c.meta || {};
    const anulado = !!m.anulado;
    const autor = m.autorNombre || m.autorMail || '';
    const meta = [fmtFechaHora(m.fecha), autor, m.appVersion].filter(Boolean).join(' · ');
    const enviada = !!m.enviada;
    // Se abre en el Cómputo: es el principio de la obra, y desde ahí se llega a
    // todo lo demás con las sub-pestañas, ya paradas en esta versión.
    const href = `computo.html?obra=${encodeURIComponent(obraKey)}&version=${encodeURIComponent(c.key)}`;
    return `
      <div class="item-card cierre-card${anulado ? ' anulado' : ''}" data-key="${escHtml(c.key)}">
        <div class="item-card-info">
          <span class="item-card-title">${escHtml(m.nombre || '(sin nombre)')}</span>
          ${meta ? `<span class="item-card-meta">${escHtml(meta)}</span>` : ''}
          <div class="item-card-badges">
            <span class="cierre-total">${m.total != null ? fmtARS(m.total) : '—'}</span>
            ${anulado ? '<span class="u-badge u-badge-neutro">Anulada</span>' : ''}
            ${enviada && !anulado ? '<span class="u-badge u-badge-activo">Presentada</span>' : ''}
          </div>
          ${m.notas ? `<div class="cierre-notas">${escHtml(m.notas)}</div>` : ''}
          ${anulado ? `<div class="cierre-notas">Anulada el ${escHtml(fmtFechaHora(m.anulado.fecha))}${m.anulado.motivo ? ' — ' + escHtml(m.anulado.motivo) : ''}</div>` : ''}
        </div>
        <div class="item-card-actions">
          <a class="btn btn-sm btn-outline" href="${href}">Ver</a>
          ${anulado ? '' : `<button class="btn btn-sm btn-outline btn-restaurar"${obraBloqueada ? ' disabled title="La obra está en modo lectura"' : ''}>Restaurar</button>`}
          ${anulado ? '' : `
          <span class="cierre-menu-wrap">
            <button class="btn btn-sm btn-outline btn-icon btn-menu" aria-label="Más acciones" title="Más acciones">${icSvg('dots')}</button>
          </span>`}
        </div>
      </div>`;
  }).join('');

  const keyDe = el => el.closest('.cierre-card').dataset.key;
  cont.querySelectorAll('.btn-restaurar').forEach(b => b.addEventListener('click', () => abrirModalRestaurar(keyDe(b))));
  cont.querySelectorAll('.btn-menu').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    abrirMenu(b, keyDe(b));
  }));
}

/* Menú de acciones de una versión.

   Vive en <body> y no dentro de la tarjeta: .card usa overflow:hidden para
   recortar sus bordes redondeados y también recortaba este menú cuando la
   versión era la última de la lista (se veía cortado al medio). Es el mismo
   motivo y la misma solución que el dropdown del buscador — ver .ss-dropdown en
   css/styles.css. */
let menuEl = null;

function cerrarMenus() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}

function abrirMenu(btn, key) {
  const yaAbierto = menuEl && menuEl.dataset.key === key;
  cerrarMenus();
  if (yaAbierto) return;

  const c = cierres.find(x => x.key === key);
  if (!c) return;

  menuEl = document.createElement('div');
  menuEl.className = 'cierre-menu';
  menuEl.dataset.key = key;
  menuEl.innerHTML = `
    <button class="mi-editar">Editar</button>
    ${c.meta.enviada
      ? '<button class="mi-anular peligro">Anular</button>'
      : '<button class="mi-eliminar peligro">Eliminar</button>'}`;
  document.body.appendChild(menuEl);

  // Alineado al borde derecho del botón. Si no entra abajo, se abre hacia
  // arriba — con dos opciones casi nunca pasa, pero la lista puede estar al pie
  // de la pantalla.
  const r = btn.getBoundingClientRect();
  const alto = menuEl.offsetHeight;
  const abajo = r.bottom + 6 + alto <= window.innerHeight;
  menuEl.style.top = (abajo ? r.bottom + 6 : r.top - 6 - alto) + 'px';
  menuEl.style.right = (window.innerWidth - r.right) + 'px';

  menuEl.querySelector('.mi-editar').addEventListener('click', () => abrirModalEditar(key));
  const anular = menuEl.querySelector('.mi-anular');
  if (anular) anular.addEventListener('click', () => abrirModalAnular(key));
  const elim = menuEl.querySelector('.mi-eliminar');
  if (elim) elim.addEventListener('click', () => eliminar(key));
}

// Un click en cualquier otro lado lo cierra, igual que el chip de usuario. Con
// position:fixed también hay que cerrarlo al scrollear o redimensionar: si no,
// queda flotando lejos del botón que lo abrió.
document.addEventListener('click', cerrarMenus);
window.addEventListener('scroll', cerrarMenus, true);
window.addEventListener('resize', cerrarMenus);

/* ===== Restaurar =====

   Devolver la obra a una versión. Lo primero que hace es guardar el estado
   actual como una versión más: así restaurar nunca puede perder nada, y volver
   atrás es restaurar esa. */

async function abrirModalRestaurar(key) {
  const c = cierres.find(x => x.key === key);
  if (!c) return;
  restaurandoKey = key;
  $('restaurar-nombre').textContent = `"${c.meta.nombre || 'sin nombre'}"`;
  $('modal-restaurar-form').classList.remove('hidden');
  $('modal-restaurar-trabajando').classList.add('hidden');
  $('modal-restaurar-listo').classList.add('hidden');
  $('modal-restaurar-ok').classList.remove('hidden');
  $('modal-restaurar-ok').disabled = true;
  $('modal-restaurar-cancelar').textContent = 'Cancelar';
  $('restaurar-global').classList.add('hidden');
  $('modal-restaurar').classList.remove('hidden');

  // La foto completa se pide recién acá: pesa lo que pesa la obra, y la lista
  // no la necesita.
  try {
    restaurandoCierre = await _fbGet(`/obras/${obraKey}/cierres/${key}.json`);
  } catch (_) {
    toast('No se pudo leer la versión.', 'error');
    $('modal-restaurar').classList.add('hidden');
    return;
  }
  const difs = await window.difsCatalogoGlobal(restaurandoCierre.datos);
  if (difs.length) {
    $('restaurar-difs').innerHTML = difs.slice(0, 25).map(d =>
      `<li>${escHtml(d.tipo)} ${escHtml(d.nombre)} · ${escHtml(d.campo)}: ${escHtml(String(d.enVersion))} en la versión, ${escHtml(String(d.hoy))} hoy</li>`
    ).join('') + (difs.length > 25 ? `<li>…y ${difs.length - 25} más.</li>` : '');
    $('restaurar-global').classList.remove('hidden');
  }
  $('modal-restaurar-ok').disabled = false;
}

async function confirmarRestaurar() {
  if (!restaurandoCierre) return;
  const nombreVersion = restaurandoCierre.meta.nombre || 'sin nombre';
  $('modal-restaurar-form').classList.add('hidden');
  $('modal-restaurar-trabajando').classList.remove('hidden');
  $('modal-restaurar-ok').disabled = true;

  try {
    $('restaurar-paso').textContent = 'Guardando el estado actual como una versión…';
    const previa = await window.cerrarPresupuesto(modeloVivo, planVivo, insumosVivos, {
      nombre: `Antes de restaurar ${nombreVersion}`,
      notas: 'Guardada automáticamente al restaurar otra versión.',
    });
    // Si el estado actual no se puede fotografiar, no se restaura: sin red de
    // seguridad, restaurar sería una pérdida sin vuelta atrás.
    if (!previa.ok) throw new Error('No se pudo guardar el estado actual, así que no se restauró nada.');

    $('restaurar-paso').textContent = 'Restaurando la obra…';
    await window.restaurarVersion(obraKey, restaurandoCierre.datos);

    $('restaurar-paso').textContent = 'Recalculando el presupuesto…';
    const m = await window.cargarPresupuestoObra(obraKey);
    const totalVersion = (restaurandoCierre.resultado || {}).total;
    const coincide = m && totalVersion != null && window.round2(m.total) === window.round2(totalVersion);

    $('modal-restaurar-trabajando').classList.add('hidden');
    $('restaurar-resultado').innerHTML = [
      `<li>Total de la versión: ${fmtARS(totalVersion)}</li>`,
      `<li>Total de la obra ahora: ${fmtARS(m ? m.total : null)}</li>`,
      coincide
        ? '<li>Coinciden: la obra quedó exactamente como en esa versión.</li>'
        : '<li style="color:#b26a00;font-weight:600;">No coinciden. Es por el catálogo compartido, que no se toca al restaurar — revisá la lista de diferencias que se mostró antes.</li>',
      `<li>El estado anterior quedó guardado como "Antes de restaurar ${escHtml(nombreVersion)}".</li>`,
    ].join('');
    $('modal-restaurar-listo').classList.remove('hidden');
    $('modal-restaurar-ok').classList.add('hidden');
    $('modal-restaurar-cancelar').textContent = 'Listo';
  } catch (e) {
    $('modal-restaurar-trabajando').classList.add('hidden');
    $('modal-restaurar-form').classList.remove('hidden');
    $('modal-restaurar-ok').disabled = false;
    toast(e && e.message ? e.message : 'Error al restaurar.', 'error');
    return;
  }

  await loadAll();
}

/* Editar cómo se nombra una versión: nombre, notas y si es la que se presentó.
   Los datos guardados y sus números no se tocan — para eso está el lápiz y no
   un botón más grande.

   Más de una versión puede quedar marcada como presentada, a propósito: una
   obra puede presentar una oferta y después una mejora, y las dos se
   presentaron. */
function abrirModalEditar(key) {
  const c = cierres.find(x => x.key === key);
  if (!c) return;
  editandoKey = key;
  $('editar-nombre').value = c.meta.nombre || '';
  $('editar-notas').value = c.meta.notas || '';
  $('editar-presentada').checked = !!c.meta.enviada;
  $('modal-editar').classList.remove('hidden');
  $('editar-nombre').focus();
}

async function confirmarEditar() {
  if (!editandoKey) return;
  const nombre = $('editar-nombre').value.trim();
  if (!nombre) { toast('Poné un nombre para la versión.', 'warning'); $('editar-nombre').focus(); return; }
  try {
    await window.editarMetaVersion(obraKey, editandoKey, {
      nombre,
      notas: $('editar-notas').value.trim() || null,
      enviada: $('editar-presentada').checked,
    });
  } catch (_) {
    toast('Error al guardar los datos de la versión.', 'error');
    return;
  }
  $('modal-editar').classList.add('hidden');
  editandoKey = null;
  await cargarLista();
  renderCierres();
}

/* Eliminar es sólo para las versiones de trabajo. Una marcada como presentada
   se anula en su lugar: queda tachada y sus números se siguen consultando. Son
   dos acciones distintas a propósito, y por eso el menú muestra una o la otra
   según el caso, nunca las dos. */
async function eliminar(key) {
  const c = cierres.find(x => x.key === key);
  if (!c) return;
  const ok = await showConfirm('Eliminar versión',
    `Se elimina "${c.meta.nombre || 'sin nombre'}" y todos sus datos guardados. No se puede deshacer.`);
  if (!ok) return;
  try {
    await window.borrarVersion(obraKey, key);
  } catch (e) {
    toast(e && e.message ? e.message : 'Error al eliminar la versión.', 'error');
    return;
  }
  showToast('Versión eliminada.', 'success');
  await cargarLista();
  renderCierres();
}

/* ===== Guardar una versión ===== */

function abrirModalCerrar() {
  $('cierre-nombre').value = '';
  $('cierre-notas').value = '';
  $('cierre-presentada').checked = false;
  $('modal-cerrar-form').classList.remove('hidden');
  $('modal-cerrar-verificando').classList.add('hidden');
  $('modal-cerrar-error').classList.add('hidden');
  $('modal-cerrar-ok').disabled = false;
  $('modal-cerrar-ok').textContent = 'Guardar versión';
  $('modal-cerrar').classList.remove('hidden');
  $('cierre-nombre').focus();
}

function cerrarModalCerrar() { $('modal-cerrar').classList.add('hidden'); }

async function confirmarCierre() {
  const nombre = $('cierre-nombre').value.trim();
  if (!nombre) { toast('Poné un nombre para la versión.', 'warning'); $('cierre-nombre').focus(); return; }
  if (modeloVivo.k == null) { toast('El presupuesto todavía no tiene Coeficiente K: revisá Carga Fija antes de guardar una versión.', 'warning'); return; }

  $('modal-cerrar-form').classList.add('hidden');
  $('modal-cerrar-error').classList.add('hidden');
  $('modal-cerrar-verificando').classList.remove('hidden');
  $('modal-cerrar-ok').disabled = true;

  let res;
  try {
    res = await window.cerrarPresupuesto(modeloVivo, planVivo, insumosVivos, {
      nombre,
      notas: $('cierre-notas').value.trim() || null,
      enviada: $('cierre-presentada').checked,
    });
  } catch (e) {
    $('modal-cerrar-verificando').classList.add('hidden');
    $('modal-cerrar-form').classList.remove('hidden');
    $('modal-cerrar-ok').disabled = false;
    toast('Error al guardar la versión: ' + (e && e.message ? e.message : e), 'error');
    return;
  }

  $('modal-cerrar-verificando').classList.add('hidden');

  if (!res.ok) {
    // La foto no reprodujo el presupuesto vivo: se le quedó algún dato afuera.
    // No se guarda nada — ver cerrarPresupuesto en js/cierreDatos.js.
    $('modal-cerrar-difs').innerHTML = res.difs.slice(0, 20).map(d => {
      const etiqueta = res.modelo ? window.etiquetaDeDif(d, res.modelo) : d.ruta.join(' · ');
      return `<li>${escHtml(etiqueta)}: ${fmtARS(d.guardado)} → ${fmtARS(d.recalculado)}</li>`;
    }).join('') + (res.difs.length > 20 ? `<li>…y ${res.difs.length - 20} más.</li>` : '');
    $('modal-cerrar-error').classList.remove('hidden');
    $('modal-cerrar-ok').disabled = true;
    return;
  }

  cerrarModalCerrar();
  showToast('Versión guardada.', 'success');
  await cargarLista();
  renderCierres();
}

/* ===== Anular ===== */

function abrirModalAnular(key) {
  anulandoKey = key;
  $('anular-motivo').value = '';
  $('modal-anular').classList.remove('hidden');
  $('anular-motivo').focus();
}

async function confirmarAnular() {
  if (!anulandoKey) return;
  try {
    await window.anularCierre(obraKey, anulandoKey, $('anular-motivo').value.trim() || null);
  } catch (e) {
    toast('Error al anular la versión.', 'error');
    return;
  }
  $('modal-anular').classList.add('hidden');
  anulandoKey = null;
  showToast('Versión anulada.', 'success');
  await cargarLista();
  renderCierres();
}

/* ===== Carga ===== */

/* Las fichas, sin las fotos: cada cierre pesa lo que pesa la obra entera, así
   que primero se piden sólo las keys (?shallow=true) y después el `meta` de
   cada una. */
async function cargarLista() {
  const keys = await _fbGet(`/obras/${obraKey}/cierres.json?shallow=true`) || {};
  const metas = await Promise.all(Object.keys(keys).map(k => _fbGet(`/obras/${obraKey}/cierres/${k}/meta.json`)));
  cierres = Object.keys(keys)
    .map((key, i) => ({ key, meta: metas[i] || {} }))
    .sort((a, b) => (b.meta.fecha || '').localeCompare(a.meta.fecha || ''));
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }

  const [m, planDatos] = await Promise.all([
    window.cargarPresupuestoObra(obraKey),
    window.cargarPlanAvanceObra(obraKey),
  ]);
  if (!m) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  modeloVivo = m;
  planVivo = m.k == null ? null : window.calcPlanAvance(
    window.gruposRubroDesdePresupuesto(m), planDatos.config, planDatos.distItems, planDatos.distRubros);
  insumosVivos = window.calcularInsumosObra(m);

  obraBloqueada = window.obraEsSoloLectura(m.obra);

  $('header-obra-nombre').textContent = 'Versiones — ' + m.obra.nombre;
  renderHeaderTabs(obraKey, 'cierres');
  $('total-vivo').textContent = fmtARS(m.total);

  await cargarLista();
  renderCierres();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-cerrar').addEventListener('click', abrirModalCerrar);
  $('modal-cerrar-x').addEventListener('click', cerrarModalCerrar);
  $('modal-cerrar-cancelar').addEventListener('click', cerrarModalCerrar);
  $('modal-cerrar-ok').addEventListener('click', confirmarCierre);
  $('modal-editar-x').addEventListener('click', () => $('modal-editar').classList.add('hidden'));
  $('modal-editar-cancelar').addEventListener('click', () => $('modal-editar').classList.add('hidden'));
  $('modal-editar-ok').addEventListener('click', confirmarEditar);
  $('modal-restaurar-x').addEventListener('click', () => $('modal-restaurar').classList.add('hidden'));
  $('modal-restaurar-cancelar').addEventListener('click', () => $('modal-restaurar').classList.add('hidden'));
  $('modal-restaurar-ok').addEventListener('click', confirmarRestaurar);
  $('modal-anular-x').addEventListener('click', () => $('modal-anular').classList.add('hidden'));
  $('modal-anular-cancelar').addEventListener('click', () => $('modal-anular').classList.add('hidden'));
  $('modal-anular-ok').addEventListener('click', confirmarAnular);

  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (modeloVivo) $('total-vivo').textContent = fmtARS(modeloVivo.total);
});

/* Esta pantalla no escucha la base en tiempo real: después de un Ctrl+Z
   (js/undo.js) vuelve a pedir los datos y se repinta. */
window.registrarRecargaUndo(loadAll);
