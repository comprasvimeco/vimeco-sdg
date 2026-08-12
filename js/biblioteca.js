/* VIMECO S.A. — Sistema de Gestión — Biblioteca (catálogo de ítems + rubros)
   Acá sólo viven los datos básicos del ítem (nombre, unidad, rubro) — no
   tiene receta propia. La receta (materiales/equipos/mano de obra +
   rendimiento) vive por obra en item.html?key=...&obra=... — un ítem nuevo
   arranca con su primera versión de obra vacía, elegida al crearlo acá. */

const $ = id => document.getElementById(id);

let allItems = [];
let allRubros = [];
let allObras = [];
let rubrosMap = {};
let editingKey = null;
let editingRubroKey = null;

function metaLine(it) {
  const parts = [];
  if (it.rubroKey && rubrosMap[it.rubroKey]) parts.push(rubrosMap[it.rubroKey]);
  parts.push(it.unidad);
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
        <button class="btn btn-sm btn-primary btn-open-item">Rendimientos</button>
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

async function loadObras() {
  try {
    const data = await _fbGet('/obras.json');
    allObras = Object.entries(data || {}).map(([key, o]) => ({ key, ...o }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const opts = allObras.map(o => `<option value="${escHtml(o.key)}">${escHtml(o.nombre)}</option>`).join('');
    $('item-obra').innerHTML = '<option value="">— Elegir obra —</option>' + opts;
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
  $('item-obra').value = '';
  $('item-obra-grupo').classList.remove('hidden');
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
  $('item-obra-grupo').classList.add('hidden');
  $('modal-item').classList.remove('hidden');
  setTimeout(() => $('item-nombre').focus(), 50);
}

async function saveItemModal() {
  const nombre = $('item-nombre').value.trim();
  const unidad = $('item-unidad').value.trim();
  const rubroKey = $('item-rubro').value;
  const obraKey = $('item-obra').value;
  const errEl = $('modal-item-error');

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
  if (!editingKey && !obraKey) {
    errEl.textContent = 'Elegí la primera obra para este ítem.';
    errEl.classList.remove('hidden');
    return;
  }

  const saveBtn = $('modal-item-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    const data = { nombre, unidad, rubroKey };
    if (editingKey) {
      await _fbPatch(`/items/${editingKey}.json`, data);
      $('modal-item').classList.add('hidden');
      showToast('Ítem actualizado.');
      await loadItems();
    } else {
      const key = nombre.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
        + '_' + Date.now();
      await _fbPut(`/items/${key}.json`, { ...data, creadoEn: Date.now() });
      await _fbPut(`/items/${key}/versionesObra/${obraKey}.json`, { rendimiento: 1 });
      // Ítem nuevo: se abre directo su Rendimientos en vez de quedarse en la lista.
      window.location.href = `item.html?key=${encodeURIComponent(key)}&obra=${encodeURIComponent(obraKey)}`;
    }
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
  await loadObras();
  await loadItems();
});
