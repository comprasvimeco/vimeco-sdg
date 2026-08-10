/* VIMECO S.A. — Sistema de Gestión — Biblioteca (catálogo de ítems + rubros)
   La receta de cada ítem (líneas de materiales/equipos/mano de obra) se
   edita en item.html?key=... — acá sólo viven los datos básicos y el
   rendimiento. Sin costo: el costo se arma en vivo en el Cómputo de cada
   obra, a partir de esta receta + precios generales. */

const $ = id => document.getElementById(id);

let allItems = [];
let allRubros = [];
let rubrosMap = {};
let editingKey = null;
let editingRubroKey = null;

function metaLine(it) {
  const parts = [];
  if (it.rubroKey && rubrosMap[it.rubroKey]) parts.push(rubrosMap[it.rubroKey]);
  parts.push(it.unidad);
  if (it.rendimiento) parts.push(`rendimiento ${it.rendimiento}/jornada`);
  return parts.filter(Boolean).join(' · ');
}

function renderItems(list) {
  const container = $('items-list');
  if (!list.length) {
    container.innerHTML = '<div class="list-empty">No hay ítems cargados todavía.</div>';
    return;
  }
  container.innerHTML = list.map(it => `
    <div class="item-card" data-key="${escHtml(it.key)}">
      <div class="item-card-info">
        <span class="item-card-title">${escHtml(it.nombre)}</span>
        <span class="item-card-meta">${escHtml(metaLine(it))}</span>
      </div>
      <div class="item-card-actions">
        <button class="btn btn-sm btn-outline btn-edit-item">Datos</button>
        <button class="btn btn-sm btn-primary btn-open-item">Receta</button>
        <button class="btn btn-sm btn-danger btn-del-item">Eliminar</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.item-card').forEach(card => {
    const key = card.dataset.key;
    const it = allItems.find(i => i.key === key);
    card.querySelector('.btn-edit-item').addEventListener('click', () => openEditModal(it));
    card.querySelector('.btn-open-item').addEventListener('click', () => {
      window.location.href = 'item.html?key=' + encodeURIComponent(it.key);
    });
    card.querySelector('.btn-del-item').addEventListener('click', () => deleteItem(it));
  });
}

function applyFilter() {
  const q = $('items-search').value.trim().toLowerCase();
  const rubro = $('items-filtro-rubro').value;
  let list = allItems;
  if (rubro) list = list.filter(it => it.rubroKey === rubro);
  if (q) list = list.filter(it => it.nombre.toLowerCase().includes(q));
  renderItems(list);
}

function populateRubroSelects() {
  const opts = allRubros.map(r => `<option value="${escHtml(r.key)}">${escHtml(r.nombre)}</option>`).join('');
  $('items-filtro-rubro').innerHTML = '<option value="">Todos los rubros</option>' + opts;
  $('item-rubro').innerHTML = '<option value="">— Sin rubro —</option>' + opts;
}

async function loadRubros() {
  try {
    const data = await _fbGet('/rubros.json');
    allRubros = Object.entries(data || {}).map(([key, r]) => ({ key, ...r }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    rubrosMap = {};
    allRubros.forEach(r => { rubrosMap[r.key] = r.nombre; });
    populateRubroSelects();
    renderRubrosModal();
  } catch (_) {}
}

function renderRubrosModal() {
  const container = $('rubros-modal-list');
  if (!allRubros.length) {
    container.innerHTML = '<div class="list-empty">No hay rubros cargados todavía.</div>';
    return;
  }
  container.innerHTML = allRubros.map(r => `
    <div class="item-card" data-key="${escHtml(r.key)}">
      <div class="item-card-info">
        <span class="item-card-title">${escHtml(r.nombre)}</span>
      </div>
      <div class="item-card-actions">
        <button class="btn btn-sm btn-outline btn-edit-rubro">Editar</button>
        <button class="btn btn-sm btn-danger btn-del-rubro">Eliminar</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.item-card').forEach(card => {
    const key = card.dataset.key;
    const rubro = allRubros.find(r => r.key === key);
    card.querySelector('.btn-edit-rubro').addEventListener('click', () => {
      editingRubroKey = rubro.key;
      $('rubro-nombre').value = rubro.nombre;
      $('rubro-nombre').focus();
    });
    card.querySelector('.btn-del-rubro').addEventListener('click', () => deleteRubro(rubro));
  });
}

async function saveRubro() {
  const nombre = $('rubro-nombre').value.trim();
  const errEl = $('modal-rubro-error');
  if (!nombre) {
    errEl.textContent = 'El nombre es requerido.';
    errEl.classList.remove('hidden');
    return;
  }
  errEl.classList.add('hidden');

  const saveBtn = $('btn-guardar-rubro');
  saveBtn.disabled = true;
  try {
    if (editingRubroKey) {
      await _fbPatch(`/rubros/${editingRubroKey}.json`, { nombre });
    } else {
      const key = nombre.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
        + '_' + Date.now();
      await _fbPut(`/rubros/${key}.json`, { nombre, creadoEn: Date.now() });
    }
    editingRubroKey = null;
    $('rubro-nombre').value = '';
    showToast('Rubro guardado.');
    await loadRubros();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
  }
}

async function deleteRubro(rubro) {
  const ok = await showConfirm('Eliminar rubro', `¿Eliminar "${rubro.nombre}"? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await _fbDel(`/rubros/${rubro.key}.json`);
    showToast('Rubro eliminado.');
    await loadRubros();
  } catch (_) {
    showToast('Error al eliminar el rubro.', 'error');
  }
}

async function loadItems() {
  $('items-list').innerHTML = '<div class="list-loading">Cargando ítems…</div>';
  try {
    const data = await _fbGet('/items.json');
    allItems = Object.entries(data || {}).map(([key, it]) => ({ key, ...it }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    applyFilter();
  } catch (_) {
    $('items-list').innerHTML = '<div class="list-empty">Error al cargar ítems.</div>';
  }
}

function openAddModal() {
  editingKey = null;
  $('modal-item-title').textContent = 'Agregar ítem';
  $('modal-item-error').classList.add('hidden');
  $('item-nombre').value = '';
  $('item-unidad').value = '';
  $('item-rubro').value = '';
  $('item-rendimiento').value = '1';
  setCalcFormula($('item-rendimiento'), null);
  $('modal-item').classList.remove('hidden');
  setTimeout(() => $('item-nombre').focus(), 50);
}

function openEditModal(it) {
  editingKey = it.key;
  $('modal-item-title').textContent = 'Editar datos del ítem';
  $('modal-item-error').classList.add('hidden');
  $('item-nombre').value = it.nombre || '';
  $('item-unidad').value = it.unidad || '';
  $('item-rubro').value = it.rubroKey || '';
  $('item-rendimiento').value = it.rendimiento ?? '1';
  setCalcFormula($('item-rendimiento'), it.rendimientoFormula);
  $('modal-item').classList.remove('hidden');
  setTimeout(() => $('item-nombre').focus(), 50);
}

async function saveItemModal() {
  const nombre = $('item-nombre').value.trim();
  const unidad = $('item-unidad').value.trim();
  const rubroKey = $('item-rubro').value;
  const errEl = $('modal-item-error');

  const rendInput = $('item-rendimiento');
  if (rendInput.value.trim().startsWith('=')) rendInput.blur();
  const rendimiento = parseFloat(rendInput.value.replace(',', '.'));

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
  if (isNaN(rendimiento) || rendimiento <= 0) {
    errEl.textContent = 'El rendimiento tiene que ser un número mayor a 0.';
    errEl.classList.remove('hidden');
    return;
  }

  const saveBtn = $('modal-item-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    const data = { nombre, unidad, rubroKey, rendimiento, rendimientoFormula: getCalcFormula(rendInput) };
    if (editingKey) {
      await _fbPatch(`/items/${editingKey}.json`, data);
    } else {
      const key = nombre.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
        + '_' + Date.now();
      await _fbPut(`/items/${key}.json`, { ...data, creadoEn: Date.now() });
    }
    $('modal-item').classList.add('hidden');
    showToast(editingKey ? 'Ítem actualizado.' : 'Ítem creado.');
    await loadItems();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar';
  }
}

async function deleteItem(it) {
  const ok = await showConfirm('Eliminar ítem', `¿Eliminar "${it.nombre}"? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await _fbDel(`/items/${it.key}.json`);
    showToast('Ítem eliminado.');
    await loadItems();
  } catch (_) {
    showToast('Error al eliminar el ítem.', 'error');
  }
}

function closeRubrosModal() {
  editingRubroKey = null;
  $('rubro-nombre').value = '';
  $('modal-rubro-error').classList.add('hidden');
  $('modal-rubros').classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', async () => {
  attachCalcInput($('item-rendimiento'));

  $('btn-add-item').addEventListener('click', openAddModal);
  $('modal-item-close').addEventListener('click',  () => $('modal-item').classList.add('hidden'));
  $('modal-item-cancel').addEventListener('click', () => $('modal-item').classList.add('hidden'));
  $('modal-item-save').addEventListener('click', saveItemModal);
  $('items-search').addEventListener('input', applyFilter);
  $('items-filtro-rubro').addEventListener('change', applyFilter);

  $('btn-rubros').addEventListener('click', () => $('modal-rubros').classList.remove('hidden'));
  $('modal-rubros-close').addEventListener('click', closeRubrosModal);
  $('btn-guardar-rubro').addEventListener('click', saveRubro);
  $('rubro-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveRubro(); });

  await loadRubros();
  await loadItems();
});
