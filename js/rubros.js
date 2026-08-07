/* VIMECO S.A. — Sistema de Gestión — Rubros (catálogo simple para agrupar Ítems) */

const $ = id => document.getElementById(id);

let allRubros = [];
let editingKey = null;

function renderRubros(list) {
  const container = $('rubros-list');
  if (!list.length) {
    container.innerHTML = '<div class="list-empty">No hay rubros cargados todavía.</div>';
    return;
  }
  container.innerHTML = list.map(r => `
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
    card.querySelector('.btn-edit-rubro').addEventListener('click', () => openEditModal(rubro));
    card.querySelector('.btn-del-rubro').addEventListener('click', () => deleteRubro(rubro));
  });
}

function applyFilter() {
  const q = $('rubros-search').value.trim().toLowerCase();
  const filtered = q
    ? allRubros.filter(r => r.nombre.toLowerCase().includes(q))
    : allRubros;
  renderRubros(filtered);
}

async function loadRubros() {
  $('rubros-list').innerHTML = '<div class="list-loading">Cargando rubros…</div>';
  try {
    const data = await _fbGet('/rubros.json');
    allRubros = Object.entries(data || {}).map(([key, r]) => ({ key, ...r }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    applyFilter();
  } catch (_) {
    $('rubros-list').innerHTML = '<div class="list-empty">Error al cargar rubros.</div>';
  }
}

function openAddModal() {
  editingKey = null;
  $('modal-rubro-title').textContent = 'Agregar rubro';
  $('modal-rubro-error').classList.add('hidden');
  $('rubro-nombre').value = '';
  $('modal-rubro').classList.remove('hidden');
  setTimeout(() => $('rubro-nombre').focus(), 50);
}

function openEditModal(rubro) {
  editingKey = rubro.key;
  $('modal-rubro-title').textContent = 'Editar rubro';
  $('modal-rubro-error').classList.add('hidden');
  $('rubro-nombre').value = rubro.nombre || '';
  $('modal-rubro').classList.remove('hidden');
  setTimeout(() => $('rubro-nombre').focus(), 50);
}

async function saveRubroModal() {
  const nombre = $('rubro-nombre').value.trim();
  const errEl  = $('modal-rubro-error');

  if (!nombre) {
    errEl.textContent = 'El nombre es requerido.';
    errEl.classList.remove('hidden');
    return;
  }

  const saveBtn = $('modal-rubro-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    if (editingKey) {
      await _fbPatch(`/rubros/${editingKey}.json`, { nombre });
    } else {
      const key = nombre.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
        + '_' + Date.now();
      await _fbPut(`/rubros/${key}.json`, { nombre, creadoEn: Date.now() });
    }
    $('modal-rubro').classList.add('hidden');
    showToast(editingKey ? 'Rubro actualizado.' : 'Rubro creado.');
    await loadRubros();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar';
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

document.addEventListener('DOMContentLoaded', () => {
  $('btn-add-rubro').addEventListener('click', openAddModal);
  $('modal-rubro-close').addEventListener('click',  () => $('modal-rubro').classList.add('hidden'));
  $('modal-rubro-cancel').addEventListener('click', () => $('modal-rubro').classList.add('hidden'));
  $('modal-rubro-save').addEventListener('click', saveRubroModal);
  $('rubro-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveRubroModal(); });
  $('rubros-search').addEventListener('input', applyFilter);

  loadRubros();
});
