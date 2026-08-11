/* VIMECO S.A. — Sistema de Gestión — Obras (CRUD básico) */

const $ = id => document.getElementById(id);

const ESTADOS = {
  preparacion: { label: 'En preparación', badge: 'u-badge-neutro' },
  ejecucion:   { label: 'En ejecución',   badge: 'u-badge-info' },
  terminada:   { label: 'Terminada',      badge: 'u-badge-activo' },
};

let allObras = [];
let editingKey = null;

function renderObras(list) {
  const container = $('obras-list');
  if (!list.length) {
    container.innerHTML = '<div class="list-empty">No hay obras cargadas todavía.</div>';
    return;
  }
  container.innerHTML = list.map(o => {
    const estado = ESTADOS[o.estado] || ESTADOS.preparacion;
    const meta = [o.cliente, o.ubicacion].filter(Boolean).join(' · ');
    return `
      <div class="item-card" data-key="${escHtml(o.key)}">
        <div class="item-card-info">
          <span class="item-card-title">${escHtml(o.nombre)}</span>
          ${meta ? `<span class="item-card-meta">${escHtml(meta)}</span>` : ''}
          <span class="u-badge ${estado.badge}">${estado.label}</span>
        </div>
        <div class="item-card-actions">
          <button class="btn btn-sm btn-outline btn-edit-obra">Editar</button>
          <button class="btn btn-sm btn-primary btn-computo-obra">Cómputo</button>
          <button class="btn btn-sm btn-outline btn-carga-fija-obra">Carga Fija</button>
          <button class="btn btn-sm btn-outline btn-presupuesto-obra">Presupuesto</button>
          <button class="btn btn-sm btn-danger btn-del-obra">Eliminar</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.item-card').forEach(card => {
    const key = card.dataset.key;
    const obra = allObras.find(o => o.key === key);
    card.querySelector('.btn-edit-obra').addEventListener('click', () => openEditModal(obra));
    card.querySelector('.btn-computo-obra').addEventListener('click', () => {
      window.location.href = 'computo.html?obra=' + encodeURIComponent(obra.key);
    });
    card.querySelector('.btn-carga-fija-obra').addEventListener('click', () => {
      window.location.href = 'carga-fija.html?obra=' + encodeURIComponent(obra.key);
    });
    card.querySelector('.btn-presupuesto-obra').addEventListener('click', () => {
      window.location.href = 'presupuesto.html?obra=' + encodeURIComponent(obra.key);
    });
    card.querySelector('.btn-del-obra').addEventListener('click', () => deleteObra(obra));
  });
}

async function loadObras() {
  $('obras-list').innerHTML = '<div class="list-loading">Cargando obras…</div>';
  try {
    const data = await _fbGet('/obras.json');
    allObras = Object.entries(data || {}).map(([key, o]) => ({ key, ...o }))
      .sort((a, b) => (b.creadaEn || 0) - (a.creadaEn || 0));
    renderObras(allObras);
  } catch (_) {
    $('obras-list').innerHTML = '<div class="list-empty">Error al cargar obras.</div>';
  }
}

function openAddModal() {
  editingKey = null;
  $('modal-obra-title').textContent = 'Agregar obra';
  $('modal-obra-error').classList.add('hidden');
  $('obra-nombre').value = '';
  $('obra-cliente').value = '';
  $('obra-ubicacion').value = '';
  $('obra-estado').value = 'preparacion';
  $('modal-obra').classList.remove('hidden');
  setTimeout(() => $('obra-nombre').focus(), 50);
}

function openEditModal(obra) {
  editingKey = obra.key;
  $('modal-obra-title').textContent = 'Editar obra';
  $('modal-obra-error').classList.add('hidden');
  $('obra-nombre').value = obra.nombre || '';
  $('obra-cliente').value = obra.cliente || '';
  $('obra-ubicacion').value = obra.ubicacion || '';
  $('obra-estado').value = obra.estado || 'preparacion';
  $('modal-obra').classList.remove('hidden');
  setTimeout(() => $('obra-nombre').focus(), 50);
}

async function saveObraModal() {
  const nombre    = $('obra-nombre').value.trim();
  const cliente   = $('obra-cliente').value.trim();
  const ubicacion = $('obra-ubicacion').value.trim();
  const estado    = $('obra-estado').value;
  const errEl     = $('modal-obra-error');

  if (!nombre) {
    errEl.textContent = 'El nombre es requerido.';
    errEl.classList.remove('hidden');
    return;
  }

  const saveBtn = $('modal-obra-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    if (editingKey) {
      await _fbPatch(`/obras/${editingKey}.json`, { nombre, cliente, ubicacion, estado });
    } else {
      const key = nombre.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
        + '_' + Date.now();
      await _fbPut(`/obras/${key}.json`, { nombre, cliente, ubicacion, estado, creadaEn: Date.now() });
    }
    $('modal-obra').classList.add('hidden');
    showToast(editingKey ? 'Obra actualizada.' : 'Obra creada.');
    await loadObras();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar';
  }
}

async function deleteObra(obra) {
  const ok = await showConfirm('Eliminar obra', `¿Eliminar "${obra.nombre}"? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await _fbDel(`/obras/${obra.key}.json`);
    showToast('Obra eliminada.');
    await loadObras();
  } catch (_) {
    showToast('Error al eliminar la obra.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('btn-add-obra').addEventListener('click', openAddModal);
  $('modal-obra-close').addEventListener('click',  () => $('modal-obra').classList.add('hidden'));
  $('modal-obra-cancel').addEventListener('click', () => $('modal-obra').classList.add('hidden'));
  $('modal-obra-save').addEventListener('click', saveObraModal);
  $('obra-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveObraModal(); });

  loadObras();
});
