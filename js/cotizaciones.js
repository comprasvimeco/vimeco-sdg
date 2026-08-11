/* VIMECO S.A. — Sistema de Gestión — Cotizaciones (CRUD básico)
   Fuente de precios de materiales/ítems, real y con carga manual (la IA
   queda para más adelante). Puede estar asociada a una obra puntual
   (obraKey) o ser general/de referencia (obraKey null, ej. "CHANDÍAS" o
   un catálogo de proveedor sin obra todavía) — preparación para los
   puntos siguientes del plan (Fuente en Materiales/Ítems, precios por
   obra). */

const $ = id => document.getElementById(id);

const fmtFecha = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

let allCotizaciones = [];
let allObras = [];
let obrasMap = {};
let editingKey = null;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function renderCotizaciones(list) {
  const container = $('cotizaciones-list');
  if (!list.length) {
    container.innerHTML = '<div class="list-empty">No hay cotizaciones cargadas todavía.</div>';
    return;
  }
  container.innerHTML = list.map(c => {
    const obraNombre = c.obraKey ? (obrasMap[c.obraKey] || '(obra eliminada)') : 'General';
    const meta = [obraNombre, c.proveedor, c.fecha ? fmtFecha(c.fecha) : ''].filter(Boolean).join(' · ');
    return `
      <div class="item-card" data-key="${escHtml(c.key)}">
        <div class="item-card-info">
          <span class="item-card-title">${escHtml(c.nombre)}</span>
          <span class="item-card-meta">${escHtml(meta)}</span>
        </div>
        <div class="item-card-actions">
          <button class="btn btn-sm btn-outline btn-edit-cotizacion">Editar</button>
          <button class="btn btn-sm btn-danger btn-del-cotizacion">Eliminar</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.item-card').forEach(card => {
    const key = card.dataset.key;
    const cotizacion = allCotizaciones.find(c => c.key === key);
    card.querySelector('.btn-edit-cotizacion').addEventListener('click', () => openEditModal(cotizacion));
    card.querySelector('.btn-del-cotizacion').addEventListener('click', () => deleteCotizacion(cotizacion));
  });
}

function populateObraSelect() {
  const opts = allObras.map(o => `<option value="${escHtml(o.key)}">${escHtml(o.nombre)}</option>`).join('');
  $('cotizacion-obra').innerHTML = '<option value="">— General (sin obra) —</option>' + opts;
}

async function loadAll() {
  $('cotizaciones-list').innerHTML = '<div class="list-loading">Cargando cotizaciones…</div>';
  try {
    const [cotizacionesData, obrasData] = await Promise.all([
      _fbGet('/cotizaciones.json'),
      _fbGet('/obras.json'),
    ]);
    allObras = Object.entries(obrasData || {}).map(([key, o]) => ({ key, ...o }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    obrasMap = {};
    allObras.forEach(o => { obrasMap[o.key] = o.nombre; });
    populateObraSelect();

    allCotizaciones = Object.entries(cotizacionesData || {}).map(([key, c]) => ({ key, ...c }))
      .sort((a, b) => (b.creadoEn || 0) - (a.creadoEn || 0));
    renderCotizaciones(allCotizaciones);
  } catch (_) {
    $('cotizaciones-list').innerHTML = '<div class="list-empty">Error al cargar cotizaciones.</div>';
  }
}

function openAddModal() {
  editingKey = null;
  $('modal-cotizacion-title').textContent = 'Agregar cotización';
  $('modal-cotizacion-error').classList.add('hidden');
  $('cotizacion-nombre').value = '';
  $('cotizacion-obra').value = '';
  $('cotizacion-proveedor').value = '';
  $('cotizacion-fecha').value = todayIso();
  $('modal-cotizacion').classList.remove('hidden');
  setTimeout(() => $('cotizacion-nombre').focus(), 50);
}

function openEditModal(cotizacion) {
  editingKey = cotizacion.key;
  $('modal-cotizacion-title').textContent = 'Editar cotización';
  $('modal-cotizacion-error').classList.add('hidden');
  $('cotizacion-nombre').value = cotizacion.nombre || '';
  $('cotizacion-obra').value = cotizacion.obraKey || '';
  $('cotizacion-proveedor').value = cotizacion.proveedor || '';
  $('cotizacion-fecha').value = cotizacion.fecha || todayIso();
  $('modal-cotizacion').classList.remove('hidden');
  setTimeout(() => $('cotizacion-nombre').focus(), 50);
}

async function saveCotizacionModal() {
  const nombre    = $('cotizacion-nombre').value.trim();
  const obraKey   = $('cotizacion-obra').value || null;
  const proveedor = $('cotizacion-proveedor').value.trim();
  const fecha     = $('cotizacion-fecha').value || todayIso();
  const errEl     = $('modal-cotizacion-error');

  if (!nombre) {
    errEl.textContent = 'El nombre es requerido.';
    errEl.classList.remove('hidden');
    return;
  }

  const saveBtn = $('modal-cotizacion-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    const data = { nombre, obraKey, proveedor, fecha, tipo: 'manual' };
    if (editingKey) {
      await _fbPatch(`/cotizaciones/${editingKey}.json`, data);
    } else {
      const key = nombre.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
        + '_' + Date.now();
      await _fbPut(`/cotizaciones/${key}.json`, { ...data, creadoEn: Date.now() });
    }
    $('modal-cotizacion').classList.add('hidden');
    showToast(editingKey ? 'Cotización actualizada.' : 'Cotización creada.');
    await loadAll();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar';
  }
}

async function deleteCotizacion(cotizacion) {
  const ok = await showConfirm('Eliminar cotización', `¿Eliminar "${cotizacion.nombre}"? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await _fbDel(`/cotizaciones/${cotizacion.key}.json`);
    showToast('Cotización eliminada.');
    await loadAll();
  } catch (_) {
    showToast('Error al eliminar la cotización.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('btn-add-cotizacion').addEventListener('click', openAddModal);
  $('modal-cotizacion-close').addEventListener('click',  () => $('modal-cotizacion').classList.add('hidden'));
  $('modal-cotizacion-cancel').addEventListener('click', () => $('modal-cotizacion').classList.add('hidden'));
  $('modal-cotizacion-save').addEventListener('click', saveCotizacionModal);
  $('cotizacion-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveCotizacionModal(); });

  loadAll();
});
