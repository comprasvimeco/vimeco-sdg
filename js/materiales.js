/* VIMECO S.A. — Sistema de Gestión — Materiales (catálogo + precio actual) */

const $ = id => document.getElementById(id);

const fmtFecha  = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

let allMateriales = [];
let editingKey = null;
let monedaActual = 'USD';

function setMoneda(m) {
  monedaActual = m;
  $('btn-moneda-usd').classList.toggle('is-active', m === 'USD');
  $('btn-moneda-ars').classList.toggle('is-active', m === 'ARS');
  actualizarEquivalente();
}

function actualizarEquivalente() {
  const hint = $('material-precio-equivalente');
  const raw = $('material-precio').value.trim();
  if (raw.startsWith('=')) { hint.textContent = 'Podés escribir una fórmula empezando con "="'; return; }
  const n = parseFloat(raw.replace(',', '.'));
  if (isNaN(n)) { hint.textContent = 'Podés escribir una fórmula empezando con "="'; return; }
  const r = resolveDualPrecio(monedaActual, n);
  if (!r) { hint.textContent = 'Sin cotización del dólar disponible todavía — reintentá en un momento.'; return; }
  hint.textContent = monedaActual === 'USD'
    ? `≈ ${fmtARS(r.precioARS)}`
    : `≈ ${fmtUSD(r.precioUSD)}`;
}

function renderMateriales(list) {
  const container = $('materiales-list');
  if (!list.length) {
    container.innerHTML = '<div class="list-empty">No hay materiales cargados todavía.</div>';
    return;
  }
  container.innerHTML = list.map(m => {
    const meta = [m.unidad, fmtUSDConEquivalente(m.precioUSD), m.proveedor, m.fecha ? fmtFecha(m.fecha) : '']
      .filter(Boolean).join(' · ');
    return `
      <div class="item-card" data-key="${escHtml(m.key)}">
        <div class="item-card-info">
          <span class="item-card-title">${escHtml(m.nombre)}</span>
          <span class="item-card-meta">${escHtml(meta)}</span>
        </div>
        <div class="item-card-actions">
          <button class="btn btn-sm btn-outline btn-edit-material">Editar</button>
          <button class="btn btn-sm btn-danger btn-del-material">Eliminar</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.item-card').forEach(card => {
    const key = card.dataset.key;
    const material = allMateriales.find(m => m.key === key);
    card.querySelector('.btn-edit-material').addEventListener('click', () => openEditModal(material));
    card.querySelector('.btn-del-material').addEventListener('click', () => deleteMaterial(material));
  });
}

function applyFilter() {
  const q = $('materiales-search').value.trim().toLowerCase();
  const filtered = q
    ? allMateriales.filter(m => m.nombre.toLowerCase().includes(q))
    : allMateriales;
  renderMateriales(filtered);
}

async function loadMateriales() {
  $('materiales-list').innerHTML = '<div class="list-loading">Cargando materiales…</div>';
  try {
    const data = await _fbGet('/materiales.json');
    allMateriales = Object.entries(data || {}).map(([key, m]) => ({ key, ...m }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    applyFilter();
  } catch (_) {
    $('materiales-list').innerHTML = '<div class="list-empty">Error al cargar materiales.</div>';
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function openAddModal() {
  editingKey = null;
  $('modal-material-title').textContent = 'Agregar material';
  $('modal-material-error').classList.add('hidden');
  $('material-nombre').value = '';
  $('material-unidad').value = '';
  $('material-precio').value = '';
  setCalcFormula($('material-precio'), null);
  $('material-proveedor').value = '';
  $('material-fecha').value = todayIso();
  setMoneda('USD');
  $('modal-material').classList.remove('hidden');
  setTimeout(() => $('material-nombre').focus(), 50);
}

function openEditModal(material) {
  editingKey = material.key;
  $('modal-material-title').textContent = 'Editar material';
  $('modal-material-error').classList.add('hidden');
  $('material-nombre').value = material.nombre || '';
  $('material-unidad').value = material.unidad || '';
  $('material-precio').value = material.precioUSD ?? '';
  setCalcFormula($('material-precio'), material.precioFormula);
  $('material-proveedor').value = material.proveedor || '';
  $('material-fecha').value = material.fecha || todayIso();
  setMoneda('USD');
  $('modal-material').classList.remove('hidden');
  setTimeout(() => $('material-nombre').focus(), 50);
}

async function saveMaterialModal() {
  const nombre    = $('material-nombre').value.trim();
  const unidad    = $('material-unidad').value.trim();
  const proveedor = $('material-proveedor').value.trim();
  const fecha     = $('material-fecha').value || todayIso();
  const errEl     = $('modal-material-error');

  const precioInput = $('material-precio');
  if (precioInput.value.trim().startsWith('=')) precioInput.blur();
  const precioIngresado = parseFloat(precioInput.value.replace(',', '.'));

  if (!nombre) {
    errEl.textContent = 'El nombre es requerido.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!unidad) {
    errEl.textContent = 'La unidad es requerida.';
    errEl.classList.remove('hidden');
    return;
  }
  if (isNaN(precioIngresado) || precioIngresado < 0) {
    errEl.textContent = 'El precio no es válido.';
    errEl.classList.remove('hidden');
    return;
  }
  const dual = resolveDualPrecio(monedaActual, precioIngresado);
  if (!dual) {
    errEl.textContent = 'No se pudo obtener la cotización del dólar. Reintentá en un momento.';
    errEl.classList.remove('hidden');
    return;
  }
  const { precioUSD, precioARS } = dual;
  const precioFormula = getCalcFormula(precioInput);

  const saveBtn = $('modal-material-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    if (editingKey) {
      await _fbPatch(`/materiales/${editingKey}.json`, { nombre, unidad, precioUSD, precioARS, precioFormula, proveedor, fecha });
    } else {
      const key = nombre.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
        + '_' + Date.now();
      await _fbPut(`/materiales/${key}.json`, { nombre, unidad, precioUSD, precioARS, precioFormula, proveedor, fecha, creadoEn: Date.now() });
    }
    $('modal-material').classList.add('hidden');
    showToast(editingKey ? 'Material actualizado.' : 'Material creado.');
    await loadMateriales();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar';
  }
}

async function deleteMaterial(material) {
  const ok = await showConfirm('Eliminar material', `¿Eliminar "${material.nombre}"? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await _fbDel(`/materiales/${material.key}.json`);
    showToast('Material eliminado.');
    await loadMateriales();
  } catch (_) {
    showToast('Error al eliminar el material.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  attachCalcInput($('material-precio'));
  $('material-precio').addEventListener('input', actualizarEquivalente);
  $('material-precio').addEventListener('blur', actualizarEquivalente);
  $('btn-moneda-usd').addEventListener('click', () => setMoneda('USD'));
  $('btn-moneda-ars').addEventListener('click', () => setMoneda('ARS'));

  $('btn-add-material').addEventListener('click', openAddModal);
  $('modal-material-close').addEventListener('click',  () => $('modal-material').classList.add('hidden'));
  $('modal-material-cancel').addEventListener('click', () => $('modal-material').classList.add('hidden'));
  $('modal-material-save').addEventListener('click', saveMaterialModal);
  $('material-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveMaterialModal(); });
  $('materiales-search').addEventListener('input', applyFilter);

  loadMateriales();
  getDolarSnapshot().then(() => applyFilter()).catch(() => {});
});
