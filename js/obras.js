/* VIMECO S.A. — Sistema de Gestión — Obras (CRUD básico)

   Nombre, ubicación, año y estado son de uso interno: sirven para encontrar
   la obra en esta lista. Los datos que salen impresos (obra, comitente,
   expediente…) se cargan dentro de la obra, en Datos → Datos generales. */

const $ = id => document.getElementById(id);

const ESTADOS = {
  preparacion: { label: 'En preparación', badge: 'u-badge-neutro' },
  ejecucion:   { label: 'En ejecución',   badge: 'u-badge-info' },
  terminada:   { label: 'Terminada',      badge: 'u-badge-activo' },
};
const FILTROS_ESTADO = [
  { value: 'todas', label: 'Todas' },
  { value: 'preparacion', label: ESTADOS.preparacion.label },
  { value: 'ejecucion', label: ESTADOS.ejecucion.label },
  { value: 'terminada', label: ESTADOS.terminada.label },
];
const KEY_GRUPOS_COLAPSADOS = 'obras_grupos_colapsados';

let allObras = [];
let editingKey = null;
let estadoActivo = 'todas';
let gruposColapsados = new Set();

function cargarGruposColapsados() {
  try {
    const guardado = JSON.parse(localStorage.getItem(KEY_GRUPOS_COLAPSADOS) || '[]');
    gruposColapsados = new Set(guardado);
  } catch (_) { gruposColapsados = new Set(); }
}

function guardarGruposColapsados() {
  try { localStorage.setItem(KEY_GRUPOS_COLAPSADOS, JSON.stringify([...gruposColapsados])); } catch (_) {}
}

function renderFiltroEstado() {
  const wrap = $('obras-estado-filtro');
  wrap.innerHTML = FILTROS_ESTADO.map(f => `
    <button class="btn btn-sm ${f.value === estadoActivo ? 'btn-primary' : 'btn-outline'} btn-filtro-estado" data-estado="${f.value}">${f.label}</button>`).join('');
  wrap.querySelectorAll('.btn-filtro-estado').forEach(btn => {
    btn.addEventListener('click', () => {
      estadoActivo = btn.dataset.estado;
      renderFiltroEstado();
      applyFilter();
    });
  });
}

// Agrupa por año descendente, con "Sin año" primero — así las obras viejas
// sin este dato quedan visibles arriba en vez de escondidas al final.
function agruparPorAnio(list) {
  const grupos = new Map();
  list.forEach(o => {
    const key = o.anio ? String(o.anio) : 'sin-anio';
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(o);
  });
  return [...grupos.entries()].sort(([a], [b]) => {
    if (a === 'sin-anio') return -1;
    if (b === 'sin-anio') return 1;
    return Number(b) - Number(a);
  });
}

function renderObraCard(o) {
  const estado = ESTADOS[o.estado] || ESTADOS.preparacion;
  const meta = o.ubicacion || '';
  return `
    <div class="item-card" data-key="${escHtml(o.key)}">
      <div class="item-card-info">
        <span class="item-card-title">${escHtml(o.nombre)}</span>
        ${meta ? `<span class="item-card-meta">${escHtml(meta)}</span>` : ''}
        <div class="item-card-badges">
          <span class="u-badge u-badge-neutro">${o.anio || 'Sin año'}</span>
          <span class="u-badge ${estado.badge}">${estado.label}</span>
        </div>
      </div>
      <div class="item-card-actions">
        <button class="btn btn-sm btn-outline btn-edit-obra">Editar</button>
        <button class="btn btn-sm btn-outline btn-datos-obra">Datos</button>
        <button class="btn btn-sm btn-primary btn-computo-obra">CyP</button>
      </div>
    </div>`;
}

function renderObras(list) {
  const container = $('obras-list');
  if (!list.length) {
    container.innerHTML = '<div class="list-empty">No hay obras que coincidan con la búsqueda.</div>';
    return;
  }

  const grupos = agruparPorAnio(list);
  container.innerHTML = grupos.map(([anioKey, obrasDelGrupo]) => {
    const colapsado = gruposColapsados.has(anioKey);
    const titulo = anioKey === 'sin-anio' ? 'Sin año' : anioKey;
    return `
      <div class="obra-grupo" data-anio="${escHtml(anioKey)}">
        <div class="obra-grupo-header">
          <span>${titulo} · ${obrasDelGrupo.length} obra${obrasDelGrupo.length === 1 ? '' : 's'}</span>
          <span class="icon-chevron ${colapsado ? 'is-colapsado' : ''}">${icSvg('arrowUp')}</span>
        </div>
        <div class="obra-grupo-body list-container ${colapsado ? 'hidden' : ''}">
          ${obrasDelGrupo.map(renderObraCard).join('')}
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.obra-grupo-header').forEach(header => {
    header.addEventListener('click', () => {
      const anioKey = header.closest('.obra-grupo').dataset.anio;
      if (gruposColapsados.has(anioKey)) gruposColapsados.delete(anioKey);
      else gruposColapsados.add(anioKey);
      guardarGruposColapsados();
      renderObras(list);
    });
  });

  container.querySelectorAll('.item-card').forEach(card => {
    const key = card.dataset.key;
    const obra = allObras.find(o => o.key === key);
    card.querySelector('.btn-edit-obra').addEventListener('click', () => openEditModal(obra));
    card.querySelector('.btn-datos-obra').addEventListener('click', () => {
      window.location.href = 'datos-obra.html?obra=' + encodeURIComponent(obra.key);
    });
    card.querySelector('.btn-computo-obra').addEventListener('click', () => {
      window.location.href = 'computo.html?obra=' + encodeURIComponent(obra.key);
    });
  });
}

function applyFilter() {
  const q = $('obras-search').value.trim().toLowerCase();
  const filtered = allObras.filter(o => {
    const pasaEstado = estadoActivo === 'todas' || o.estado === estadoActivo;
    const pasaBusqueda = !q
      || (o.nombre || '').toLowerCase().includes(q)
      || (o.ubicacion || '').toLowerCase().includes(q);
    return pasaEstado && pasaBusqueda;
  });
  renderObras(filtered);
}

async function loadObras() {
  $('obras-list').innerHTML = '<div class="list-loading">Cargando obras…</div>';
  try {
    const data = await _fbGet('/obras.json');
    allObras = Object.entries(data || {}).map(([key, o]) => ({ key, ...o }))
      .sort((a, b) => (b.creadaEn || 0) - (a.creadaEn || 0));
    applyFilter();
  } catch (_) {
    $('obras-list').innerHTML = '<div class="list-empty">Error al cargar obras.</div>';
  }
}

function openAddModal() {
  editingKey = null;
  $('modal-obra-title').textContent = 'Agregar obra';
  $('modal-obra-error').classList.add('hidden');
  $('obra-nombre').value = '';
  $('obra-ubicacion').value = '';
  $('obra-anio').value = new Date().getFullYear();
  $('obra-estado').value = 'preparacion';
  $('modal-obra').classList.remove('hidden');
  setTimeout(() => $('obra-nombre').focus(), 50);
}

function openEditModal(obra) {
  editingKey = obra.key;
  $('modal-obra-title').textContent = 'Editar obra';
  $('modal-obra-error').classList.add('hidden');
  $('obra-nombre').value = obra.nombre || '';
  $('obra-ubicacion').value = obra.ubicacion || '';
  $('obra-anio').value = obra.anio || '';
  $('obra-estado').value = obra.estado || 'preparacion';
  $('modal-obra').classList.remove('hidden');
  setTimeout(() => $('obra-nombre').focus(), 50);
}

async function saveObraModal() {
  const nombre    = $('obra-nombre').value.trim();
  const ubicacion = $('obra-ubicacion').value.trim();
  const anio      = $('obra-anio').value ? parseInt($('obra-anio').value, 10) : null;
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
      await _fbPatch(`/obras/${editingKey}.json`, { nombre, ubicacion, anio, estado });
    } else {
      const key = nombre.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
        + '_' + Date.now();
      await _fbPut(`/obras/${key}.json`, { nombre, ubicacion, anio, estado, creadaEn: Date.now() });
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

document.addEventListener('DOMContentLoaded', () => {
  cargarGruposColapsados();
  renderFiltroEstado();
  $('btn-add-obra').addEventListener('click', openAddModal);
  $('modal-obra-close').addEventListener('click',  () => $('modal-obra').classList.add('hidden'));
  $('modal-obra-cancel').addEventListener('click', () => $('modal-obra').classList.add('hidden'));
  $('modal-obra-save').addEventListener('click', saveObraModal);
  $('obra-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveObraModal(); });
  $('obras-search').addEventListener('input', applyFilter);

  loadObras();
});
