/* VIMECO S.A. — Sistema de Gestión — Cierres del presupuesto de una obra

   Un cierre es la foto de un presupuesto tal como se envió: congela todo lo
   que entra al cálculo —incluido el catálogo global de equipos y materiales,
   que es compartido entre obras y por eso puede moverle el número a una oferta
   ya presentada— y guarda además el resultado, para poder avisar si algún día
   deja de reproducirse. El motor está en js/cierreDatos.js; acá sólo vive la
   pantalla.

   Cerrar no modifica la obra, así que se puede cerrar aunque esté en modo
   lectura — que es justamente el estado normal de una obra en ejecución o
   terminada, donde más sentido tiene hacerlo. Por eso esta pantalla no tiene
   el botón de ojo/lápiz del resto. */

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
    cont.innerHTML = `<div class="empty-state"><p>Todavía no hay ningún presupuesto cerrado para esta obra.</p></div>`;
    return;
  }

  cont.innerHTML = cierres.map(c => {
    const m = c.meta || {};
    const anulado = !!m.anulado;
    const autor = m.autorNombre || m.autorMail || '';
    const meta = [fmtFechaHora(m.fecha), autor, m.appVersion].filter(Boolean).join(' · ');
    const href = `presupuesto.html?obra=${encodeURIComponent(obraKey)}&cierre=${encodeURIComponent(c.key)}`;
    return `
      <div class="item-card cierre-card${anulado ? ' anulado' : ''}" data-key="${escHtml(c.key)}">
        <div class="item-card-info">
          <span class="item-card-title">${escHtml(m.nombre || '(sin nombre)')}</span>
          ${meta ? `<span class="item-card-meta">${escHtml(meta)}</span>` : ''}
          <div class="item-card-badges">
            <span class="cierre-total">${m.total != null ? fmtARS(m.total) : '—'}</span>
            ${anulado ? '<span class="u-badge u-badge-neutro">Anulado</span>' : '<span class="u-badge u-badge-activo">Vigente</span>'}
          </div>
          ${m.notas ? `<div class="cierre-notas">${escHtml(m.notas)}</div>` : ''}
          ${anulado ? `<div class="cierre-notas">Anulado el ${escHtml(fmtFechaHora(m.anulado.fecha))}${m.anulado.motivo ? ' — ' + escHtml(m.anulado.motivo) : ''}</div>` : ''}
        </div>
        <div class="item-card-actions">
          <a class="btn btn-sm btn-outline" href="${href}">Ver</a>
          ${anulado ? '' : '<button class="btn btn-sm btn-outline btn-anular">Anular</button>'}
        </div>
      </div>`;
  }).join('');

  cont.querySelectorAll('.btn-anular').forEach(btn => {
    btn.addEventListener('click', () => abrirModalAnular(btn.closest('.cierre-card').dataset.key));
  });
}

/* ===== Cerrar ===== */

function abrirModalCerrar() {
  $('cierre-nombre').value = '';
  $('cierre-notas').value = '';
  $('modal-cerrar-form').classList.remove('hidden');
  $('modal-cerrar-verificando').classList.add('hidden');
  $('modal-cerrar-error').classList.add('hidden');
  $('modal-cerrar-ok').disabled = false;
  $('modal-cerrar-ok').textContent = 'Cerrar presupuesto';
  $('modal-cerrar').classList.remove('hidden');
  $('cierre-nombre').focus();
}

function cerrarModalCerrar() { $('modal-cerrar').classList.add('hidden'); }

async function confirmarCierre() {
  const nombre = $('cierre-nombre').value.trim();
  if (!nombre) { toast('Poné un nombre para el cierre.', 'warning'); $('cierre-nombre').focus(); return; }
  if (modeloVivo.k == null) { toast('El presupuesto todavía no tiene Coeficiente K: revisá Carga Fija antes de cerrar.', 'warning'); return; }

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
    toast('Error al guardar el cierre: ' + (e && e.message ? e.message : e), 'error');
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
  showToast('Presupuesto cerrado.', 'success');
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
    toast('Error al anular el cierre.', 'error');
    return;
  }
  $('modal-anular').classList.add('hidden');
  anulandoKey = null;
  showToast('Cierre anulado.', 'success');
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

  $('header-obra-nombre').textContent = 'Cierres — ' + m.obra.nombre;
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
