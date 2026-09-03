/* VIMECO S.A. — Sistema de Gestión — Materiales (catálogo + precio actual) */

const $ = id => document.getElementById(id);

const fmtFecha  = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

let allMateriales = [];
let allObras = [];
let obrasMap = {};
let editingKey = null;
let fuenteSelect = null;

function renderMateriales(list) {
  const container = $('materiales-list');
  if (!list.length) {
    container.innerHTML = '<div class="list-empty">No hay materiales cargados todavía.</div>';
    return;
  }
  container.innerHTML = list.map(m => {
    const def = window.precioDefaultDe(m);
    const fuente = def ? (obrasMap[def.obraKey] || def.obraKey) : null;
    const meta = def
      ? [m.unidad, fmtUSDConEquivalente(def.precio.precioUSD), def.precio.proveedor, def.precio.fecha ? fmtFecha(def.precio.fecha) : '', `Fuente: ${fuente}`].filter(Boolean).join(' · ')
      : [m.unidad, 'Sin precio cargado'].filter(Boolean).join(' · ');
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
    const [data, obrasData] = await Promise.all([
      _fbGet('/materiales.json'),
      _fbGet('/obras.json'),
    ]);
    allMateriales = Object.entries(data || {}).map(([key, m]) => ({ key, ...m }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    allObras = Object.entries(obrasData || {}).map(([key, o]) => ({ key, ...o }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    obrasMap = {};
    allObras.forEach(o => { obrasMap[o.key] = o.nombre; });
    applyFilter();
  } catch (_) {
    $('materiales-list').innerHTML = '<div class="list-empty">Error al cargar materiales.</div>';
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function onFuenteChange(material, obraKey) {
  const disabled = !obraKey;
  ['material-precio-usd', 'material-precio-ars', 'material-proveedor', 'material-fecha'].forEach(id => { $(id).disabled = disabled; });
  const p = obraKey && material && material.precios ? material.precios[obraKey] : null;
  $('material-precio-usd').value = p ? formatMoneyString(p.precioUSD) : '';
  $('material-precio-ars').value = p ? formatMoneyString(p.precioARS) : '';
  setCalcFormula($('material-precio-usd'), p ? p.precioFormula : null);
  setCalcFormula($('material-precio-ars'), null);
  $('material-proveedor').value = p ? (p.proveedor || '') : '';
  $('material-fecha').value = p ? (p.fecha || todayIso()) : todayIso();
  $('material-precio-nota').textContent = p && p.cotizacionUsada ? `Cotización usada: USD = ${fmtARSFijo(p.cotizacionUsada)}` : '';
}

// material: null en alta (sin precios todavía). En edición, muestra TODAS
// las obras (no sólo las que ya tienen precio) para poder cargar el primero.
function renderFuenteSelect(material) {
  const def = material ? window.precioDefaultDe(material) : null;
  const options = allObras.map(o => {
    const p = material && material.precios ? material.precios[o.key] : null;
    const sublabel = p
      ? `Precio: ${fmtFecha(p.fecha)}${def && def.obraKey === o.key ? ' · vigente' : ''}`
      : 'Sin precio cargado';
    return { value: o.key, label: o.nombre, sublabel };
  });
  fuenteSelect = createSearchableSelect($('material-fuente-container'), {
    options,
    value: def ? def.obraKey : null,
    placeholder: 'Buscar obra…',
    onChange: obraKey => onFuenteChange(material, obraKey),
  });
  onFuenteChange(material, def ? def.obraKey : null);
}

function openAddModal() {
  editingKey = null;
  $('modal-material-title').textContent = 'Agregar material';
  $('modal-material-error').classList.add('hidden');
  $('material-nombre').value = '';
  $('material-unidad').value = '';
  renderFuenteSelect(null);
  $('modal-material').classList.remove('hidden');
  setTimeout(() => $('material-nombre').focus(), 50);
}

function openEditModal(material) {
  editingKey = material.key;
  $('modal-material-title').textContent = 'Editar material';
  $('modal-material-error').classList.add('hidden');
  $('material-nombre').value = material.nombre || '';
  $('material-unidad').value = material.unidad || '';
  renderFuenteSelect(material);
  $('modal-material').classList.remove('hidden');
  setTimeout(() => $('material-nombre').focus(), 50);
}

async function saveMaterialModal() {
  const nombre = $('material-nombre').value.trim();
  const unidad = $('material-unidad').value.trim();
  const errEl  = $('modal-material-error');

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

  const obraKey = fuenteSelect ? fuenteSelect.getValue() : null;
  let precioData = null;
  if (obraKey) {
    const proveedor = $('material-proveedor').value.trim();
    const fecha = $('material-fecha').value || todayIso();
    const usdInput = $('material-precio-usd');
    const arsInput = $('material-precio-ars');
    if (usdInput.value.trim().startsWith('=')) usdInput.blur();
    if (arsInput.value.trim().startsWith('=')) arsInput.blur();
    const precioUSD = parseMoneyString(usdInput.value);
    const precioARS = parseMoneyString(arsInput.value);
    if (isNaN(precioUSD) || precioUSD < 0 || isNaN(precioARS) || precioARS < 0) {
      errEl.textContent = 'El precio no es válido.';
      errEl.classList.remove('hidden');
      return;
    }
    const cotizacionUsada = window.dolarOficialVenta();
    if (!cotizacionUsada) {
      errEl.textContent = 'No se pudo obtener la cotización del dólar. Reintentá en un momento.';
      errEl.classList.remove('hidden');
      return;
    }
    const fc = getCalcFormulaConMoneda(usdInput, arsInput);
    precioData = { precioUSD, precioARS, precioFormula: fc.formula, precioFormulaMoneda: fc.moneda, proveedor, fecha, cotizacionUsada };
  }

  const saveBtn = $('modal-material-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    let key = editingKey;
    if (editingKey) {
      await _fbPatch(`/materiales/${editingKey}.json`, { nombre, unidad });
    } else {
      key = nombre.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
        + '_' + Date.now();
      await _fbPut(`/materiales/${key}.json`, { nombre, unidad, creadoEn: Date.now() });
    }
    if (precioData) await _fbPut(`/materiales/${key}/precios/${obraKey}.json`, precioData);
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

document.addEventListener('DOMContentLoaded', async () => {
  attachCalcInput($('material-precio-usd'));
  attachMoneyInput($('material-precio-usd'));
  attachCalcInput($('material-precio-ars'));
  attachMoneyInput($('material-precio-ars'));
  attachDualPrecioInputs({ usdInput: $('material-precio-usd'), arsInput: $('material-precio-ars'), notaEl: $('material-precio-nota') });

  $('btn-add-material').addEventListener('click', openAddModal);
  $('modal-material-close').addEventListener('click',  () => $('modal-material').classList.add('hidden'));
  $('modal-material-cancel').addEventListener('click', () => $('modal-material').classList.add('hidden'));
  $('modal-material-save').addEventListener('click', saveMaterialModal);
  $('material-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveMaterialModal(); });
  $('materiales-search').addEventListener('input', applyFilter);

  await loadMateriales();
  getDolarSnapshot().then(() => applyFilter()).catch(() => {});

  // Llegada desde otra pantalla (ej. Análisis de Precio) para cargar un
  // precio nuevo de un material puntual: abre directo su modal de edición.
  const editarKey = new URLSearchParams(window.location.search).get('editar');
  if (editarKey) {
    const material = allMateriales.find(m => m.key === editarKey);
    if (material) openEditModal(material);
  }
});

window.onDecimalesVista(() => applyFilter());
