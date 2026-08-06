/* VIMECO S.A. — Sistema de Gestión — Mano de Obra (roles + costo diario en $) */

const $ = id => document.getElementById(id);

const fmtARSLocal = n => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
const fmtFecha = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

let allRoles = [];
let editingKey = null;

function renderRoles(list) {
  const container = $('mo-list');
  if (!list.length) {
    container.innerHTML = '<div class="list-empty">No hay roles cargados todavía.</div>';
    return;
  }
  container.innerHTML = list.map(r => {
    const meta = [fmtARSLocal(r.costoDiario) + '/día', r.fecha ? fmtFecha(r.fecha) : '']
      .filter(Boolean).join(' · ');
    return `
      <div class="item-card" data-key="${escHtml(r.key)}">
        <div class="item-card-info">
          <span class="item-card-title">${escHtml(r.nombre)}</span>
          <span class="item-card-meta">${escHtml(meta)}</span>
        </div>
        <div class="item-card-actions">
          <button class="btn btn-sm btn-outline btn-edit-rol">Editar</button>
          <button class="btn btn-sm btn-danger btn-del-rol">Eliminar</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.item-card').forEach(card => {
    const key = card.dataset.key;
    const rol = allRoles.find(r => r.key === key);
    card.querySelector('.btn-edit-rol').addEventListener('click', () => openEditModal(rol));
    card.querySelector('.btn-del-rol').addEventListener('click', () => deleteRol(rol));
  });
}

function applyFilter() {
  const q = $('mo-search').value.trim().toLowerCase();
  const filtered = q
    ? allRoles.filter(r => r.nombre.toLowerCase().includes(q))
    : allRoles;
  renderRoles(filtered);
}

async function loadRoles() {
  $('mo-list').innerHTML = '<div class="list-loading">Cargando roles…</div>';
  try {
    const data = await _fbGet('/manoDeObra.json');
    allRoles = Object.entries(data || {}).map(([key, r]) => ({ key, ...r }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    applyFilter();
  } catch (_) {
    $('mo-list').innerHTML = '<div class="list-empty">Error al cargar roles.</div>';
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function openAddModal() {
  editingKey = null;
  $('modal-rol-title').textContent = 'Agregar rol';
  $('modal-rol-error').classList.add('hidden');
  $('rol-nombre').value = '';
  $('rol-costo').value = '';
  $('rol-fecha').value = todayIso();
  $('modal-rol').classList.remove('hidden');
  setTimeout(() => $('rol-nombre').focus(), 50);
}

function openEditModal(rol) {
  editingKey = rol.key;
  $('modal-rol-title').textContent = 'Editar rol';
  $('modal-rol-error').classList.add('hidden');
  $('rol-nombre').value = rol.nombre || '';
  $('rol-costo').value = rol.costoDiario ?? '';
  $('rol-fecha').value = rol.fecha || todayIso();
  $('modal-rol').classList.remove('hidden');
  setTimeout(() => $('rol-nombre').focus(), 50);
}

async function saveRolModal() {
  const nombre = $('rol-nombre').value.trim();
  const fecha  = $('rol-fecha').value || todayIso();
  const errEl  = $('modal-rol-error');

  const costoInput = $('rol-costo');
  if (costoInput.value.trim().startsWith('=')) costoInput.blur();
  const costoDiario = parseFloat(costoInput.value.replace(',', '.'));

  if (!nombre) {
    errEl.textContent = 'El rol es requerido.';
    errEl.classList.remove('hidden');
    return;
  }
  if (isNaN(costoDiario) || costoDiario < 0) {
    errEl.textContent = 'El costo diario no es válido.';
    errEl.classList.remove('hidden');
    return;
  }

  const saveBtn = $('modal-rol-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    if (editingKey) {
      await _fbPatch(`/manoDeObra/${editingKey}.json`, { nombre, costoDiario, fecha });
    } else {
      const key = nombre.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
        + '_' + Date.now();
      await _fbPut(`/manoDeObra/${key}.json`, { nombre, costoDiario, fecha, creadoEn: Date.now() });
    }
    $('modal-rol').classList.add('hidden');
    showToast(editingKey ? 'Rol actualizado.' : 'Rol creado.');
    await loadRoles();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar';
  }
}

async function deleteRol(rol) {
  const ok = await showConfirm('Eliminar rol', `¿Eliminar "${rol.nombre}"? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await _fbDel(`/manoDeObra/${rol.key}.json`);
    showToast('Rol eliminado.');
    await loadRoles();
  } catch (_) {
    showToast('Error al eliminar el rol.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  attachCalcInput($('rol-costo'));

  $('btn-add-rol').addEventListener('click', openAddModal);
  $('modal-rol-close').addEventListener('click',  () => $('modal-rol').classList.add('hidden'));
  $('modal-rol-cancel').addEventListener('click', () => $('modal-rol').classList.add('hidden'));
  $('modal-rol-save').addEventListener('click', saveRolModal);
  $('rol-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveRolModal(); });
  $('mo-search').addEventListener('input', applyFilter);

  loadRoles();
});
