/* VIMECO S.A. — Sistema de Gestión — Ítems (catálogo, lista)
   El Análisis de Precios de cada ítem (líneas de materiales/equipos/mano de
   obra) se edita en item.html?key=... — acá sólo viven los datos básicos y el
   precio unitario ya calculado (cache que se actualiza al guardar la receta). */

const $ = id => document.getElementById(id);

let allItems = [];
let allRubros = [];
let rubrosMap = {};
let editingKey = null;
let params = { utilidadPct: 10 };

async function loadParams() {
  try {
    const data = await _fbGet('/config/itemsPrecios.json');
    if (data) params = { ...params, ...data };
  } catch (_) {}
  $('param-utilidad').value = params.utilidadPct;
}

async function saveParams() {
  const utilidadPct = parseFloat($('param-utilidad').value.replace(',', '.'));
  if (isNaN(utilidadPct) || utilidadPct < 0) return;
  params = { utilidadPct };
  try {
    await _fbPut('/config/itemsPrecios.json', params);
  } catch (_) {
    showToast('Error al guardar el parámetro.', 'error');
  }
}

function metaLine(it) {
  const parts = [];
  if (it.rubroKey && rubrosMap[it.rubroKey]) parts.push(rubrosMap[it.rubroKey]);
  parts.push(it.unidad);
  if (it.rendimiento) parts.push(`rendimiento ${it.rendimiento}/jornada`);
  if (it.precioUnitarioCache != null) parts.push(`Precio unitario ${fmtARS(it.precioUnitarioCache)}`);
  else parts.push('Sin Análisis de Precios cargado');
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
        <span class="item-card-title">${escHtml(it.nombre)}${it.codigo ? ` <span class="text-muted">${escHtml(it.codigo)}</span>` : ''}</span>
        <span class="item-card-meta">${escHtml(metaLine(it))}</span>
      </div>
      <div class="item-card-actions">
        <button class="btn btn-sm btn-outline btn-edit-item">Datos</button>
        <button class="btn btn-sm btn-primary btn-open-item">Análisis de Precio</button>
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
  if (q) list = list.filter(it =>
    it.nombre.toLowerCase().includes(q) || (it.codigo || '').toLowerCase().includes(q));
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
  } catch (_) {}
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
  $('item-codigo').value = '';
  $('item-nombre').value = '';
  $('item-unidad').value = '';
  $('item-rubro').value = '';
  $('item-rendimiento').value = '1';
  $('modal-item').classList.remove('hidden');
  setTimeout(() => $('item-nombre').focus(), 50);
}

function openEditModal(it) {
  editingKey = it.key;
  $('modal-item-title').textContent = 'Editar datos del ítem';
  $('modal-item-error').classList.add('hidden');
  $('item-codigo').value = it.codigo || '';
  $('item-nombre').value = it.nombre || '';
  $('item-unidad').value = it.unidad || '';
  $('item-rubro').value = it.rubroKey || '';
  $('item-rendimiento').value = it.rendimiento ?? '1';
  $('modal-item').classList.remove('hidden');
  setTimeout(() => $('item-nombre').focus(), 50);
}

async function saveItemModal() {
  const codigo = $('item-codigo').value.trim();
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
    const data = { codigo, nombre, unidad, rubroKey, rendimiento };
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

document.addEventListener('DOMContentLoaded', async () => {
  attachCalcInput($('item-rendimiento'));

  $('btn-add-item').addEventListener('click', openAddModal);
  $('modal-item-close').addEventListener('click',  () => $('modal-item').classList.add('hidden'));
  $('modal-item-cancel').addEventListener('click', () => $('modal-item').classList.add('hidden'));
  $('modal-item-save').addEventListener('click', saveItemModal);
  $('items-search').addEventListener('input', applyFilter);
  $('items-filtro-rubro').addEventListener('change', applyFilter);
  $('param-utilidad').addEventListener('blur', saveParams);

  await loadRubros();
  await loadParams();
  await loadItems();
});
