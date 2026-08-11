/* VIMECO S.A. — Sistema de Gestión — Mano de Obra de obra
   Mismo desglose que la Mano de Obra global (calcCostoManoDeObra), pero
   roles y parámetros son propios de esta obra — cada obra puede tener sus
   propias categorías, básicos, extras y no remunerativo.

   Seed inicial: si esta obra todavía no tiene roles propios, se clona una
   sola vez el catálogo global (/manoDeObra + /config/manoDeObra.json) como
   punto de partida editable — después de eso cada obra vive por su cuenta. */

const $ = id => document.getElementById(id);

const fmtARSLocal = n => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
const fmtFecha = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let allRoles = [];
let editingKey = null;
let paramsMO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };

function calcCosto(basico, noRemunerativoMensual, extraPct) {
  return window.calcCostoManoDeObra({ basico, extraPct, noRemunerativoMensual }, paramsMO);
}

function fillParamsForm() {
  $('param-asistencia').value = paramsMO.asistenciaPct;
  $('param-cargas').value = paramsMO.cargasPct;
  $('param-dias').value = paramsMO.diasMes;
  $('param-jornada').value = paramsMO.jornadaHoras;
}

async function saveParams() {
  const asistenciaPct = parseFloat($('param-asistencia').value.replace(',', '.'));
  const cargasPct      = parseFloat($('param-cargas').value.replace(',', '.'));
  const diasMes         = parseFloat($('param-dias').value.replace(',', '.'));
  const jornadaHoras    = parseFloat($('param-jornada').value.replace(',', '.'));
  if ([asistenciaPct, cargasPct, diasMes, jornadaHoras].some(n => isNaN(n) || n < 0)) return;
  paramsMO = { asistenciaPct, cargasPct, diasMes, jornadaHoras };
  try {
    await _fbPut(`/obras/${obraKey}/paramsMO.json`, paramsMO);
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
        `Jornal (${paramsMO.jornadaHoras}hs) ${fmtARSLocal(c.costoJornal)}`,
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
  const data = await _fbGet(`/obras/${obraKey}/roles.json`);
  allRoles = Object.entries(data || {}).map(([key, r]) => ({ key, ...r }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  applyFilter();
}

// Primera vez que se entra a Mano de Obra en esta obra (sin roles propios
// todavía): clona el catálogo y parámetros globales como punto de partida
// editable. Una sola vez — de ahí en más cada obra vive por su cuenta.
async function seedSiHaceFalta() {
  const [rolesData, paramsData] = await Promise.all([
    _fbGet(`/obras/${obraKey}/roles.json`),
    _fbGet(`/obras/${obraKey}/paramsMO.json`),
  ]);
  if (rolesData && Object.keys(rolesData).length) return;

  const [globalRoles, globalParams] = await Promise.all([
    _fbGet('/manoDeObra.json'),
    _fbGet('/config/manoDeObra.json'),
  ]);
  const tareas = Object.entries(globalRoles || {}).map(([key, r]) =>
    _fbPut(`/obras/${obraKey}/roles/${key}.json`, r));
  if (!paramsData && globalParams) {
    tareas.push(_fbPut(`/obras/${obraKey}/paramsMO.json`, globalParams));
  }
  if (tareas.length) await Promise.all(tareas);
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
  ['rol-basico', 'rol-extra', 'rol-no-remunerativo'].forEach(id => setCalcFormula($(id), null));
  updatePreview();
  $('modal-rol').classList.remove('hidden');
  setTimeout(() => $('rol-nombre').focus(), 50);
}

function openEditModal(rol) {
  editingKey = rol.key;
  $('modal-rol-title').textContent = 'Editar rol';
  $('modal-rol-error').classList.add('hidden');
  $('rol-nombre').value = rol.nombre || '';
  $('rol-basico').value = formatMoneyString(rol.basico);
  $('rol-extra').value = rol.extraPct ?? 0;
  $('rol-no-remunerativo').value = formatMoneyString(rol.noRemunerativoMensual);
  $('rol-fecha').value = rol.fecha || todayIso();
  setCalcFormula($('rol-basico'), rol.basicoFormula);
  setCalcFormula($('rol-extra'), rol.extraPctFormula);
  setCalcFormula($('rol-no-remunerativo'), rol.noRemunerativoMensualFormula);
  updatePreview();
  $('modal-rol').classList.remove('hidden');
  setTimeout(() => $('rol-nombre').focus(), 50);
}

function updatePreview() {
  const basico = parseMoneyString($('rol-basico').value);
  const extra  = parseFloat($('rol-extra').value.replace(',', '.')) || 0;
  const noRem  = parseMoneyString($('rol-no-remunerativo').value) || 0;
  const preview = $('rol-preview');
  if (isNaN(basico) || basico <= 0) {
    preview.textContent = 'Completá el básico para ver el costo calculado.';
    return;
  }
  const c = calcCosto(basico, noRem, extra);
  preview.textContent =
    `Costo horario: ${fmtARSLocal(c.costoHorario)}/hs · Jornal (${paramsMO.jornadaHoras}hs): ${fmtARSLocal(c.costoJornal)}`;
}

async function saveRolModal() {
  const nombre = $('rol-nombre').value.trim();
  const fecha  = $('rol-fecha').value || todayIso();
  const errEl  = $('modal-rol-error');

  const basicoInput = $('rol-basico');
  if (basicoInput.value.trim().startsWith('=')) { basicoInput.blur(); updatePreview(); }
  const basico = parseMoneyString(basicoInput.value);

  const extraInput = $('rol-extra');
  if (extraInput.value.trim().startsWith('=')) { extraInput.blur(); updatePreview(); }
  const extraStr = extraInput.value.trim();
  const extraPct = extraStr ? parseFloat(extraStr.replace(',', '.')) : 0;

  const noRemInput = $('rol-no-remunerativo');
  if (noRemInput.value.trim().startsWith('=')) { noRemInput.blur(); updatePreview(); }
  const noRemStr = noRemInput.value.trim();
  const noRemunerativoMensual = noRemStr ? parseMoneyString(noRemStr) : null;

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

  const basicoFormula = getCalcFormula(basicoInput);
  const extraPctFormula = getCalcFormula(extraInput);
  const noRemunerativoMensualFormula = getCalcFormula(noRemInput);

  try {
    const data = {
      nombre, basico, extraPct, noRemunerativoMensual, fecha,
      basicoFormula, extraPctFormula, noRemunerativoMensualFormula,
    };
    if (editingKey) {
      await _fbPatch(`/obras/${obraKey}/roles/${editingKey}.json`, data);
    } else {
      const key = nombre.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
        + '_' + Date.now();
      await _fbPut(`/obras/${obraKey}/roles/${key}.json`, { ...data, creadoEn: Date.now() });
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
    await _fbDel(`/obras/${obraKey}/roles/${rol.key}.json`);
    showToast('Rol eliminado.');
    await loadRoles();
  } catch (_) {
    showToast('Error al eliminar el rol.', 'error');
  }
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const obraData = await _fbGet(`/obras/${obraKey}.json`);
  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;

  await seedSiHaceFalta();
  const paramsData = await _fbGet(`/obras/${obraKey}/paramsMO.json`);
  if (paramsData) paramsMO = { ...paramsMO, ...paramsData };

  $('header-obra-nombre').textContent = 'Mano de Obra — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'mano-obra');
  fillParamsForm();
  await loadRoles();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  attachCalcInput($('rol-basico'));
  attachMoneyInput($('rol-basico'));
  attachCalcInput($('rol-extra'));
  attachCalcInput($('rol-no-remunerativo'));
  attachMoneyInput($('rol-no-remunerativo'));
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

  await loadAll();
});
