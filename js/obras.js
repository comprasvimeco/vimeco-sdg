/* VIMECO S.A. — Sistema de Gestión — Obras (CRUD básico)

   Nombre, ubicación, año y estado son de uso interno: sirven para encontrar
   la obra en esta lista. Los datos que salen impresos (obra, comitente,
   expediente…) se cargan dentro de la obra, en Datos → Datos generales. */

const $ = id => document.getElementById(id);

const ESTADOS = {
  preparacion: { label: 'En preparación', badge: 'u-badge-neutro' },
  cerrada:     { label: 'Cerrada',        badge: 'u-badge-aviso' },
  ejecucion:   { label: 'En ejecución',   badge: 'u-badge-info' },
  terminada:   { label: 'Terminada',      badge: 'u-badge-activo' },
};
const FILTROS_ESTADO = [
  { value: 'todas', label: 'Todas' },
  { value: 'preparacion', label: ESTADOS.preparacion.label },
  { value: 'cerrada', label: ESTADOS.cerrada.label },
  { value: 'ejecucion', label: ESTADOS.ejecucion.label },
  { value: 'terminada', label: ESTADOS.terminada.label },
];
const KEY_GRUPOS_COLAPSADOS = 'obras_grupos_colapsados';
const KEY_ANEXOS_ABIERTOS = 'obras_anexos_abiertos';

let allObras = [];
let editingKey = null;
let duplicandoKey = null;
let estadoActivo = 'todas';
let gruposColapsados = new Set();
let anexosAbiertos = new Set();

function cargarAnexosAbiertos() {
  try { anexosAbiertos = new Set(JSON.parse(localStorage.getItem(KEY_ANEXOS_ABIERTOS) || '[]')); }
  catch (_) { anexosAbiertos = new Set(); }
}

function guardarAnexosAbiertos() {
  try { localStorage.setItem(KEY_ANEXOS_ABIERTOS, JSON.stringify([...anexosAbiertos])); } catch (_) {}
}

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

// Una obra con `padreKey` es anexo de esa obra principal: se lista adentro de
// su tarjeta y va en el grupo de año de la principal. Es sólo orden visual,
// cada presupuesto sigue siendo independiente. Un solo nivel: un anexo no
// tiene anexos. Si la principal ya no existe, el anexo se muestra suelto.
const esAnexo = o => !!(o.padreKey && allObras.some(p => p.key === o.padreKey && !p.padreKey));
const anexosDe = key => allObras.filter(o => o.padreKey === key);

function renderAnexo(o) {
  const estado = ESTADOS[o.estado] || ESTADOS.preparacion;
  return `
    <div class="obra-anexo" data-key="${escHtml(o.key)}" title="Abrir Cómputo y Presupuesto">
      <span class="obra-anexo-nombre">${icSvg('subnivel')}<span>${escHtml(o.nombre)}</span></span>
      <span class="u-badge ${estado.badge}">${estado.label}</span>
      <button class="obra-card-menu" aria-label="Más acciones" title="Más acciones">${icSvg('dots')}</button>
    </div>`;
}

function renderObraCard({ obra: o, anexos, atenuada, abierta }) {
  const estado = ESTADOS[o.estado] || ESTADOS.preparacion;
  const total = anexosDe(o.key).length;
  return `
    <div class="obra-card obra-card--${escHtml(o.estado || 'preparacion')} ${atenuada ? 'is-atenuada' : ''}" data-key="${escHtml(o.key)}" title="Abrir Cómputo y Presupuesto">
      <div class="obra-card-head">
        <div class="obra-card-info">
          <span class="obra-card-title">${escHtml(o.nombre)}</span>
          ${o.ubicacion ? `<span class="obra-card-meta">${escHtml(o.ubicacion)}</span>` : ''}
        </div>
        <button class="obra-card-menu" aria-label="Más acciones" title="Más acciones">${icSvg('dots')}</button>
      </div>
      <div class="obra-card-foot">
        <span class="u-badge ${estado.badge}">${estado.label}</span>
        ${anexos.length ? `
          <button class="obra-card-anexos-toggle ${abierta ? 'is-abierta' : ''}" title="${abierta ? 'Ocultar' : 'Ver'} anexos">
            ${anexos.length < total ? `${anexos.length} de ${total}` : total} anexo${total === 1 ? '' : 's'} ${icSvg('arrowDown')}
          </button>` : ''}
        <button class="btn btn-sm btn-primary btn-computo-obra">CyP</button>
      </div>
      ${anexos.length && abierta ? `<div class="obra-anexos">${anexos.map(renderAnexo).join('')}</div>` : ''}
    </div>`;
}

// Menú ⋯ de una tarjeta o de un anexo. Uno solo, montado en <body> con
// position:fixed, así ninguna tarjeta lo recorta.
function cerrarMenuObra() {
  const m = $('obra-menu');
  if (m) m.remove();
}

function abrirMenuObra(btn, obra) {
  const yaAbierto = $('obra-menu') && $('obra-menu').dataset.key === obra.key;
  cerrarMenuObra();
  if (yaAbierto) return;
  const menu = document.createElement('div');
  menu.id = 'obra-menu';
  menu.className = 'obra-menu';
  menu.dataset.key = obra.key;
  menu.innerHTML = `
    <button data-accion="editar">${icSvg('edit')}Editar</button>
    <button data-accion="duplicar">${icSvg('copy')}Duplicar</button>
    <button data-accion="datos">${icSvg('file')}Datos</button>
    ${esAnexo(obra) ? '' : `<button data-accion="anexo">${icSvg('plus')}Agregar anexo</button>`}`;
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
  const top = r.bottom + 4 + menu.offsetHeight > window.innerHeight ? r.top - menu.offsetHeight - 4 : r.bottom + 4;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.addEventListener('click', e => {
    const b = e.target.closest('button[data-accion]');
    if (!b) return;
    cerrarMenuObra();
    if (b.dataset.accion === 'editar') openEditModal(obra);
    else if (b.dataset.accion === 'duplicar') openDuplicarModal(obra);
    else if (b.dataset.accion === 'datos') window.location.href = 'datos-obra.html?obra=' + encodeURIComponent(obra.key);
    else if (b.dataset.accion === 'anexo') openAddModal(obra.key);
  });
}

function renderObras(entradas) {
  const container = $('obras-list');
  cerrarMenuObra();
  if (!entradas.length) {
    container.innerHTML = '<div class="list-empty">No hay obras que coincidan con la búsqueda.</div>';
    return;
  }

  const grupos = agruparPorAnio(entradas.map(e => ({ ...e, anio: e.obra.anio })));
  container.innerHTML = grupos.map(([anioKey, delGrupo]) => {
    const colapsado = gruposColapsados.has(anioKey);
    const titulo = anioKey === 'sin-anio' ? 'Sin año' : anioKey;
    const cant = delGrupo.reduce((n, e) => n + (e.atenuada ? 0 : 1) + e.anexos.length, 0);
    return `
      <div class="obra-grupo" data-anio="${escHtml(anioKey)}">
        <div class="obra-grupo-header">
          <span>${titulo} <span class="obra-grupo-cant">${cant} obra${cant === 1 ? '' : 's'}</span></span>
          <span class="icon-chevron ${colapsado ? 'is-colapsado' : ''}">${icSvg('arrowUp')}</span>
        </div>
        <div class="obra-grupo-body obras-grid ${colapsado ? 'hidden' : ''}">
          ${delGrupo.map(renderObraCard).join('')}
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.obra-grupo-header').forEach(header => {
    header.addEventListener('click', () => {
      const anioKey = header.closest('.obra-grupo').dataset.anio;
      if (gruposColapsados.has(anioKey)) gruposColapsados.delete(anioKey);
      else gruposColapsados.add(anioKey);
      guardarGruposColapsados();
      renderObras(entradas);
    });
  });
}

// Click en cualquier parte de una tarjeta o de un anexo abre su CyP (con
// Ctrl/Cmd, en otra pestaña); los botones de adentro hacen lo suyo.
function onClickLista(e) {
  const el = e.target.closest('[data-key]');
  if (!el || el.closest('.obra-grupo-header')) return;
  const obra = allObras.find(o => o.key === el.dataset.key);
  if (!obra) return;
  const menuBtn = e.target.closest('.obra-card-menu');
  if (menuBtn) {
    e.stopPropagation();
    abrirMenuObra(menuBtn, obra);
    return;
  }
  if (e.target.closest('.obra-card-anexos-toggle')) {
    if (anexosAbiertos.has(obra.key)) anexosAbiertos.delete(obra.key);
    else anexosAbiertos.add(obra.key);
    guardarAnexosAbiertos();
    applyFilter();
    return;
  }
  const url = 'computo.html?obra=' + encodeURIComponent(obra.key);
  if (e.ctrlKey || e.metaKey) window.open(url, '_blank');
  else window.location.href = url;
}

// Cada entrada es una obra principal con los anexos que se muestran. Si hay
// filtro y sólo coincide un anexo, la principal aparece atenuada, como
// contexto, con ese anexo a la vista.
function applyFilter() {
  const query = $('obras-search').value;
  const filtroActivo = estadoActivo !== 'todas' || !!window.normBusqueda(query);
  const delEstado = allObras.filter(o => estadoActivo === 'todas' || o.estado === estadoActivo);
  const coinciden = new Set(window.buscarSimilares(delEstado, query,
    o => `${o.nombre || ''} ${o.ubicacion || ''}`).lista.map(o => o.key));

  const entradas = [];
  allObras.filter(o => !esAnexo(o)).forEach(obra => {
    const todos = anexosDe(obra.key);
    const anexos = filtroActivo ? todos.filter(a => coinciden.has(a.key)) : todos;
    const coincide = coinciden.has(obra.key);
    if (!coincide && !anexos.length) return;
    entradas.push({
      obra, anexos,
      atenuada: !coincide,
      abierta: anexosAbiertos.has(obra.key) || (filtroActivo && anexos.length > 0),
    });
  });
  renderObras(entradas);
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

// "Anexo de": sólo obras principales y nunca la propia. Una obra que ya
// tiene anexos no puede pasar a ser anexo (un solo nivel).
function llenarSelectPadre(propiaKey, padreKey) {
  const sel = $('obra-padre');
  const nota = $('obra-padre-nota');
  const opciones = allObras
    .filter(o => !esAnexo(o) && o.key !== propiaKey)
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
  sel.innerHTML = '<option value="">— Ninguna (obra principal) —</option>' +
    opciones.map(o => `<option value="${escHtml(o.key)}">${escHtml(o.nombre)}</option>`).join('');
  sel.value = opciones.some(o => o.key === padreKey) ? padreKey : '';
  const propios = propiaKey ? anexosDe(propiaKey).length : 0;
  sel.disabled = propios > 0;
  nota.textContent = propios ? `Tiene ${propios} anexo${propios === 1 ? '' : 's'}: no puede ser anexo de otra obra.` : '';
  nota.classList.toggle('hidden', !propios);
}

function openAddModal(padreKey) {
  const padre = typeof padreKey === 'string' && allObras.find(o => o.key === padreKey);
  editingKey = null;
  duplicandoKey = null;
  $('modal-obra-title').textContent = padre ? 'Agregar anexo' : 'Agregar obra';
  $('modal-obra-error').classList.add('hidden');
  $('obra-nombre').value = '';
  $('obra-ubicacion').value = padre ? padre.ubicacion || '' : '';
  $('obra-anio').value = padre && padre.anio ? padre.anio : new Date().getFullYear();
  $('obra-estado').value = 'preparacion';
  llenarSelectPadre(null, padre ? padre.key : '');
  $('modal-obra').classList.remove('hidden');
  setTimeout(() => $('obra-nombre').focus(), 50);
}

function openEditModal(obra) {
  editingKey = obra.key;
  duplicandoKey = null;
  $('modal-obra-title').textContent = 'Editar obra';
  $('modal-obra-error').classList.add('hidden');
  $('obra-nombre').value = obra.nombre || '';
  $('obra-ubicacion').value = obra.ubicacion || '';
  $('obra-anio').value = obra.anio || '';
  $('obra-estado').value = obra.estado || 'preparacion';
  llenarSelectPadre(obra.key, obra.padreKey);
  $('modal-obra').classList.remove('hidden');
  setTimeout(() => $('obra-nombre').focus(), 50);
}

function openDuplicarModal(obra) {
  editingKey = null;
  duplicandoKey = obra.key;
  $('modal-obra-title').textContent = 'Duplicar obra';
  $('modal-obra-error').classList.add('hidden');
  $('obra-nombre').value = (obra.nombre || '') + ' (copia)';
  $('obra-ubicacion').value = obra.ubicacion || '';
  $('obra-anio').value = obra.anio || '';
  $('obra-estado').value = obra.estado || 'preparacion';
  llenarSelectPadre(null, obra.padreKey);
  $('modal-obra').classList.remove('hidden');
  setTimeout(() => { $('obra-nombre').focus(); $('obra-nombre').select(); }, 50);
}

/* Copia exacta de una obra bajo una key nueva. Lo de la obra vive en tres
   lugares: su propio nodo, la versión de cada ítem (/items/{k}/versionesObra/
   {obraKey}) y el precio propio de cada material (/materiales/{k}/precios/
   {obraKey}). Las dos últimas se copian primero y el nodo de la obra al final,
   así la obra no aparece en la lista hasta estar completa.
   Cada ítem se copia como un ítem NUEVO, con las líneas del Cómputo y los
   auxiliares de la copia apuntando a él: si la copia colgara su versión del
   mismo ítem, el A.P. quedaría compartido entre las dos obras (pestañas por
   obra en item.html, y renombrarlo en una lo renombraría en la otra).
   Las Versiones guardadas (`cierres`) no se copian: sus fotos guardan ítems y
   precios bajo la key de la obra original, y restaurarlas en la copia
   escribiría sobre la original. */
async function duplicarObra(origenKey, nuevaKey, campos) {
  const [obra, items, materiales] = await Promise.all([
    _fbGet(`/obras/${origenKey}.json`),
    _fbGet('/items.json'),
    _fbGet('/materiales.json'),
  ]);
  if (!obra) throw new Error('La obra original ya no existe.');

  const escrituras = [];
  const itemNuevo = {};   // itemKey original → itemKey de la copia
  const ahora = Date.now();
  Object.entries(items || {}).forEach(([k, it], i) => {
    const v = it && it.versionesObra && it.versionesObra[origenKey];
    if (!v) return;
    const key = (it.nombre || 'item').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
      + '_' + (ahora + i);
    itemNuevo[k] = key;
    const copiaItem = { ...it, creadoEn: ahora, versionesObra: { [nuevaKey]: v } };
    escrituras.push(() => _fbPut(`/items/${key}.json`, copiaItem));
  });
  Object.entries(materiales || {}).forEach(([k, m]) => {
    const p = m && m.precios && m.precios[origenKey];
    if (p) escrituras.push(() => _fbPut(`/materiales/${k}/precios/${nuevaKey}.json`, p));
    // Los otros proveedores de la comparativa (js/preciosMaterial.js) también.
    const alt = m && m.proveedores && m.proveedores[origenKey];
    if (alt) escrituras.push(() => _fbPut(`/materiales/${k}/proveedores/${nuevaKey}.json`, alt));
  });

  const copia = { ...obra, ...campos, creadaEn: Date.now() };
  delete copia.cierres;
  ['computo', 'auxiliares'].forEach(nodo => {
    Object.values(copia[nodo] || {}).forEach(l => {
      if (l && itemNuevo[l.itemKey]) l.itemKey = itemNuevo[l.itemKey];
    });
  });

  // Nodos compartidos (/items, /materiales): raíces null, cada escritura se
  // anota por separado (ver CLAUDE.md, Deshacer).
  await window.undoAgrupar('Duplicar obra', null, async () => {
    for (let i = 0; i < escrituras.length; i += 20) {
      await Promise.all(escrituras.slice(i, i + 20).map(f => f()));
    }
    await _fbPut(`/obras/${nuevaKey}.json`, copia);
  });
}

async function saveObraModal() {
  const nombre    = $('obra-nombre').value.trim();
  const ubicacion = $('obra-ubicacion').value.trim();
  const anio      = $('obra-anio').value ? parseInt($('obra-anio').value, 10) : null;
  const estado    = $('obra-estado').value;
  const padreKey  = $('obra-padre').value || null;
  const errEl     = $('modal-obra-error');

  if (!nombre) {
    errEl.textContent = 'El nombre es requerido.';
    errEl.classList.remove('hidden');
    return;
  }

  const saveBtn = $('modal-obra-save');
  saveBtn.disabled = true;
  saveBtn.textContent = duplicandoKey ? 'Duplicando…' : 'Guardando…';

  try {
    if (editingKey) {
      await _fbPatch(`/obras/${editingKey}.json`, { nombre, ubicacion, anio, estado, padreKey });
    } else {
      const key = nombre.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
        + '_' + Date.now();
      if (duplicandoKey) await duplicarObra(duplicandoKey, key, { nombre, ubicacion, anio, estado, padreKey });
      else await _fbPut(`/obras/${key}.json`, { nombre, ubicacion, anio, estado, padreKey, creadaEn: Date.now() });
    }
    $('modal-obra').classList.add('hidden');
    showToast(editingKey ? 'Obra actualizada.' : duplicandoKey ? 'Obra duplicada.' : 'Obra creada.');
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
  cargarAnexosAbiertos();
  renderFiltroEstado();
  $('btn-add-obra').addEventListener('click', () => openAddModal());
  $('obras-list').addEventListener('click', onClickLista);
  document.addEventListener('click', e => { if (!e.target.closest('#obra-menu')) cerrarMenuObra(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarMenuObra(); });
  window.addEventListener('scroll', cerrarMenuObra, { passive: true });
  window.addEventListener('resize', cerrarMenuObra);
  $('modal-obra-close').addEventListener('click',  () => $('modal-obra').classList.add('hidden'));
  $('modal-obra-cancel').addEventListener('click', () => $('modal-obra').classList.add('hidden'));
  $('modal-obra-save').addEventListener('click', saveObraModal);
  $('obra-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveObraModal(); });
  $('obras-search').addEventListener('input', applyFilter);

  loadObras();
});

/* Esta pantalla no escucha la base en tiempo real: después de un Ctrl+Z
   (js/undo.js) vuelve a pedir los datos y se repinta. */
window.registrarRecargaUndo(loadObras);
