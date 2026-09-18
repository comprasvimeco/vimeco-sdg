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
            ${enviada && !anulado ? '<span class="u-badge u-badge-activo">Enviada</span>' : ''}
          </div>
          ${m.notas ? `<div class="cierre-notas">${escHtml(m.notas)}</div>` : ''}
          ${anulado ? `<div class="cierre-notas">Anulada el ${escHtml(fmtFechaHora(m.anulado.fecha))}${m.anulado.motivo ? ' — ' + escHtml(m.anulado.motivo) : ''}</div>` : ''}
        </div>
        <div class="item-card-actions">
          <a class="btn btn-sm btn-outline" href="${href}">Ver</a>
          ${anulado ? '' : `<button class="btn btn-sm btn-outline btn-enviada">${enviada ? 'Quitar marca' : 'Marcar enviada'}</button>`}
          ${anulado ? ''
            : enviada
              ? '<button class="btn btn-sm btn-outline btn-anular">Anular</button>'
              : '<button class="btn btn-sm btn-outline btn-borrar">Borrar</button>'}
        </div>
      </div>`;
  }).join('');

  cont.querySelectorAll('.btn-anular').forEach(btn => {
    btn.addEventListener('click', () => abrirModalAnular(btn.closest('.cierre-card').dataset.key));
  });
  cont.querySelectorAll('.btn-enviada').forEach(btn => {
    btn.addEventListener('click', () => alternarEnviada(btn.closest('.cierre-card').dataset.key));
  });
  cont.querySelectorAll('.btn-borrar').forEach(btn => {
    btn.addEventListener('click', () => borrar(btn.closest('.cierre-card').dataset.key));
  });
}

/* Marcar cuál se presentó. Sólo una por obra tiene sentido como "la enviada",
   pero no se fuerza: una obra puede presentar una oferta y después una mejora,
   y las dos se enviaron. */
async function alternarEnviada(key) {
  const c = cierres.find(x => x.key === key);
  if (!c) return;
  try {
    await window.marcarVersionEnviada(obraKey, key, !c.meta.enviada);
  } catch (_) {
    toast('Error al marcar la versión.', 'error');
    return;
  }
  await cargarLista();
  renderCierres();
}

async function borrar(key) {
  const c = cierres.find(x => x.key === key);
  if (!c) return;
  const ok = await showConfirm('Borrar versión',
    `Se borra "${c.meta.nombre || 'sin nombre'}" y todos sus datos guardados. No se puede deshacer.`);
  if (!ok) return;
  try {
    await window.borrarVersion(obraKey, key);
  } catch (e) {
    toast(e && e.message ? e.message : 'Error al borrar la versión.', 'error');
    return;
  }
  showToast('Versión borrada.', 'success');
  await cargarLista();
  renderCierres();
}

/* ===== Guardar una versión ===== */

function abrirModalCerrar() {
  $('cierre-nombre').value = '';
  $('cierre-notas').value = '';
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
      nombre, notas: $('cierre-notas').value.trim() || null,
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
