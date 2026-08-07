/* VIMECO S.A. — Sistema de Gestión — Mano de Obra
   Desglose: Básico ($/hs) -> + Asistencia perfecta (%) -> + Cargas Sociales/ART (%)
   -> + Comida no remunerativa (mensual / (días·8)) = Costo horario -> x8 = Jornal.
   Asistencia perfecta, Cargas Sociales y días laborables son parámetros generales
   (un solo valor para todos los roles, como el dólar). */

const $ = id => document.getElementById(id);

const fmtARSLocal = n => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
const fmtFecha = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

let allRoles = [];
let editingKey = null;
let params = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };

function calcCosto(basico, noRemunerativoMensual, extraPct) {
  const basicoEfectivo = basico * (1 + (extraPct || 0) / 100);
  const conAsistencia = basicoEfectivo * (1 + params.asistenciaPct / 100);
  const conCargas = conAsistencia * (1 + params.cargasPct / 100);
  const comidaPorHora = (noRemunerativoMensual || 0) / (params.diasMes * params.jornadaHoras);
  const costoHorario = conCargas + comidaPorHora;
  return { costoHorario, costoJornal: costoHorario * params.jornadaHoras, comidaPorHora };
}

async function loadParams() {
  try {
    const data = await _fbGet('/config/manoDeObra.json');
    if (data) params = { ...params, ...data };
  } catch (_) {}
  $('param-asistencia').value = params.asistenciaPct;
  $('param-cargas').value = params.cargasPct;
  $('param-dias').value = params.diasMes;
  $('param-jornada').value = params.jornadaHoras;
}

async function saveParams() {
  const asistenciaPct = parseFloat($('param-asistencia').value.replace(',', '.'));
  const cargasPct      = parseFloat($('param-cargas').value.replace(',', '.'));
  const diasMes         = parseFloat($('param-dias').value.replace(',', '.'));
  const jornadaHoras    = parseFloat($('param-jornada').value.replace(',', '.'));
  if ([asistenciaPct, cargasPct, diasMes, jornadaHoras].some(n => isNaN(n) || n < 0)) return;
  params = { asistenciaPct, cargasPct, diasMes, jornadaHoras };
  try {
    await _fbPut('/config/manoDeObra.json', params);
    applyFilter();
  } catch (_) {
    showToast('Error al guardar los parámetros.', 'error');
  }
}

function renderRoles(list) {
  const container = $('mo-list');
  if (!list.length) {
    container.innerHTML = '<div class="list-empty">No hay roles cargados todavía.</div>';
    return;
  }
  container.innerHTML = list.map(r => {
    let meta;
    if (r.basico) {
      const c = calcCosto(r.basico, r.noRemunerativoMensual, r.extraPct);
      meta = [
        `Básico ${fmtARSLocal(r.basico)}/hs`,
        r.extraPct ? `+${r.extraPct}% extra` : '',
        `Costo horario ${fmtARSLocal(c.costoHorario)}/hs`,
        `Jornal (${params.jornadaHoras}hs) ${fmtARSLocal(c.costoJornal)}`,
        r.fecha ? fmtFecha(r.fecha) : ''
      ].filter(Boolean).join(' · ');
    } else {
      meta = 'Sin datos de costo cargados';
    }
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

function updatePreview() {
  const basico = parseFloat($('rol-basico').value.replace(',', '.'));
  const extra  = parseFloat($('rol-extra').value.replace(',', '.')) || 0;
  const noRem  = parseFloat($('rol-no-remunerativo').value.replace(',', '.')) || 0;
  const preview = $('rol-preview');
  if (isNaN(basico) || basico <= 0) {
    preview.textContent = 'Completá el básico para ver el costo calculado.';
    return;
  }
  const c = calcCosto(basico, noRem, extra);
  preview.textContent =
    `Costo horario: ${fmtARSLocal(c.costoHorario)}/hs · Jornal (${params.jornadaHoras}hs): ${fmtARSLocal(c.costoJornal)}`;
}

function openAddModal() {
  editingKey = null;
  $('modal-rol-title').textContent = 'Agregar rol';
  $('modal-rol-error').classList.add('hidden');
  $('rol-nombre').value = '';
  $('rol-basico').value = '';
  $('rol-extra').value = '0';
  $('rol-no-remunerativo').value = '';
  $('rol-fecha').value = todayIso();
  updatePreview();
  $('modal-rol').classList.remove('hidden');
  setTimeout(() => $('rol-nombre').focus(), 50);
}

function openEditModal(rol) {
  editingKey = rol.key;
  $('modal-rol-title').textContent = 'Editar rol';
  $('modal-rol-error').classList.add('hidden');
  $('rol-nombre').value = rol.nombre || '';
  $('rol-basico').value = rol.basico ?? '';
  $('rol-extra').value = rol.extraPct ?? 0;
  $('rol-no-remunerativo').value = rol.noRemunerativoMensual ?? '';
  $('rol-fecha').value = rol.fecha || todayIso();
  updatePreview();
  $('modal-rol').classList.remove('hidden');
  setTimeout(() => $('rol-nombre').focus(), 50);
}

async function saveRolModal() {
  const nombre = $('rol-nombre').value.trim();
  const fecha  = $('rol-fecha').value || todayIso();
  const errEl  = $('modal-rol-error');

  const basicoInput = $('rol-basico');
  if (basicoInput.value.trim().startsWith('=')) { basicoInput.blur(); updatePreview(); }
  const basico = parseFloat(basicoInput.value.replace(',', '.'));

  const extraInput = $('rol-extra');
  if (extraInput.value.trim().startsWith('=')) { extraInput.blur(); updatePreview(); }
  const extraStr = extraInput.value.trim();
  const extraPct = extraStr ? parseFloat(extraStr.replace(',', '.')) : 0;

  const noRemInput = $('rol-no-remunerativo');
  if (noRemInput.value.trim().startsWith('=')) { noRemInput.blur(); updatePreview(); }
  const noRemStr = noRemInput.value.trim();
  const noRemunerativoMensual = noRemStr ? parseFloat(noRemStr.replace(',', '.')) : null;

  if (!nombre) {
    errEl.textContent = 'El rol es requerido.';
    errEl.classList.remove('hidden');
    return;
  }
  if (isNaN(basico) || basico < 0) {
    errEl.textContent = 'El básico no es válido.';
    errEl.classList.remove('hidden');
    return;
  }
  if (isNaN(extraPct) || extraPct < 0) {
    errEl.textContent = 'El extra sobre básico no es válido.';
    errEl.classList.remove('hidden');
    return;
  }

  const saveBtn = $('modal-rol-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    const data = { nombre, basico, extraPct, noRemunerativoMensual, fecha };
    if (editingKey) {
      await _fbPatch(`/manoDeObra/${editingKey}.json`, data);
    } else {
      const key = nombre.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
        + '_' + Date.now();
      await _fbPut(`/manoDeObra/${key}.json`, { ...data, creadoEn: Date.now() });
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
  attachCalcInput($('rol-basico'));
  attachCalcInput($('rol-extra'));
  attachCalcInput($('rol-no-remunerativo'));
  ['rol-basico', 'rol-extra', 'rol-no-remunerativo'].forEach(id => {
    $(id).addEventListener('input', updatePreview);
    $(id).addEventListener('blur', updatePreview);
  });

  $('param-asistencia').addEventListener('blur', saveParams);
  $('param-cargas').addEventListener('blur', saveParams);
  $('param-dias').addEventListener('blur', saveParams);
  $('param-jornada').addEventListener('blur', saveParams);

  $('btn-add-rol').addEventListener('click', openAddModal);
  $('modal-rol-close').addEventListener('click',  () => $('modal-rol').classList.add('hidden'));
  $('modal-rol-cancel').addEventListener('click', () => $('modal-rol').classList.add('hidden'));
  $('modal-rol-save').addEventListener('click', saveRolModal);
  $('rol-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveRolModal(); });
  $('mo-search').addEventListener('input', applyFilter);

  loadParams().then(loadRoles);
});
