/* VIMECO S.A. — Sistema de Gestión — Mano de Obra de obra
   Mismo desglose que la Mano de Obra global (calcCostoManoDeObra), pero
   roles y parámetros son propios de esta obra — cada obra puede tener sus
   propias categorías, básicos, extras y no remunerativo.

   Seed inicial: si esta obra todavía no tiene roles propios, se clona una
   sola vez el catálogo global (/manoDeObra + /config/manoDeObra.json) como
   punto de partida editable — después de eso cada obra vive por su cuenta. */

const $ = id => document.getElementById(id);

const fmtFecha = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Key de un rol nuevo: el nombre normalizado + timestamp, así dos obras que
// crean "Oficial" por separado no comparten key.
function keyDeRol(nombre) {
  return nombre.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
    + '_' + Date.now();
}

// Para cruzar roles entre obras: las keys no sirven (cada obra genera la suya),
// el nombre sí — "Oficial" es el mismo rol en las dos.
const normNombre = s => (s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let allRoles = [];
let editingKey = null;
let paramsMO = {
  asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8,
  seguridadCapatazActivo: false, seguridadCapatazPct: 0,
  comidaActivo: false, comidaMonto: 0,
};

function calcCosto(basico, noRemunerativoMensual, extraPct) {
  return window.calcCostoManoDeObra({ basico, extraPct, noRemunerativoMensual }, paramsMO);
}

function fillParamsForm() {
  $('param-asistencia').value = paramsMO.asistenciaPct;
  $('param-cargas').value = paramsMO.cargasPct;
  $('param-dias').value = paramsMO.diasMes;
  $('param-jornada').value = paramsMO.jornadaHoras;
  $('param-seg-cap-activo').checked = !!paramsMO.seguridadCapatazActivo;
  $('param-seg-cap-pct').value = paramsMO.seguridadCapatazPct || '';
  $('param-seg-cap-pct').disabled = !paramsMO.seguridadCapatazActivo;
  $('param-comida-activo').checked = !!paramsMO.comidaActivo;
  $('param-comida-monto').value = formatMoneyString(paramsMO.comidaMonto);
  $('param-comida-monto').disabled = !paramsMO.comidaActivo;
}

async function saveParams() {
  const asistenciaPct = parseFloat($('param-asistencia').value.replace(',', '.'));
  const cargasPct      = parseFloat($('param-cargas').value.replace(',', '.'));
  const diasMes         = parseFloat($('param-dias').value.replace(',', '.'));
  const jornadaHoras    = parseFloat($('param-jornada').value.replace(',', '.'));
  if ([asistenciaPct, cargasPct, diasMes, jornadaHoras].some(n => isNaN(n) || n < 0)) return;

  const seguridadCapatazActivo = $('param-seg-cap-activo').checked;
  const seguridadCapatazPctRaw = parseFloat($('param-seg-cap-pct').value.replace(',', '.'));
  const seguridadCapatazPct = isNaN(seguridadCapatazPctRaw) ? 0 : seguridadCapatazPctRaw;

  const comidaActivo = $('param-comida-activo').checked;
  const comidaMontoRaw = parseMoneyString($('param-comida-monto').value);
  const comidaMonto = isNaN(comidaMontoRaw) ? 0 : comidaMontoRaw;

  paramsMO = { asistenciaPct, cargasPct, diasMes, jornadaHoras, seguridadCapatazActivo, seguridadCapatazPct, comidaActivo, comidaMonto };
  try {
    await _fbPut(`/obras/${obraKey}/paramsMO.json`, paramsMO);
    applyFilter();
  } catch (_) {
    showToast('Error al guardar los parámetros.', 'error');
  }
}

/* ===== Orden de los roles =====
   Los roles se muestran por su campo `orden` (flechas ↑/↓), y ese mismo orden
   es el que sale en los A.P y en la exportación (window.rolesOrdenados). Las
   obras cargadas antes de que existiera `orden` no lo tienen guardado: se
   siguen viendo alfabéticas y recién se les escribe el orden a todas juntas
   cuando se mueve algo, en un solo PATCH que sólo toca ese campo. */
function ultimoOrden() {
  return allRoles.reduce((max, r) => (r.orden != null && r.orden > max ? r.orden : max), 0);
}

// Para poder decir "este rol nuevo va último" todos los de arriba tienen que
// tener `orden`; si la obra viene de antes y no lo tiene, se lo asigna a todos
// en el orden en el que se están viendo. Una sola vez, al agregar o importar.
async function asegurarOrden() {
  if (allRoles.every(r => r.orden != null)) return;
  const cambios = {};
  allRoles.forEach((r, i) => { r.orden = i + 1; cambios[`${r.key}/orden`] = i + 1; });
  await _fbPatch(`/obras/${obraKey}/roles.json`, cambios);
}

function moverRol(rolKey, dir) {
  const idx = allRoles.findIndex(r => r.key === rolKey);
  const otroIdx = idx + dir;
  if (idx < 0 || otroIdx < 0 || otroIdx >= allRoles.length) return;
  const tmp = allRoles[idx];
  allRoles[idx] = allRoles[otroIdx];
  allRoles[otroIdx] = tmp;

  // PATCH multi-path sobre el árbol de roles: sólo escribe `orden` en cada
  // uno, sin reescribir los nodos (que tienen básico, fórmulas, creadoEn).
  const cambios = {};
  allRoles.forEach((r, i) => {
    r.orden = i + 1;
    cambios[`${r.key}/orden`] = i + 1;
  });
  applyFilter();
  _fbPatch(`/obras/${obraKey}/roles.json`, cambios)
    .catch(() => showToast('Error al guardar el orden de los roles.', 'error'));
}

// `ordenable` es false mientras hay una búsqueda activa: la lista filtrada no
// muestra el orden real, así que mover ahí adentro sería a ciegas.
function renderRoles(list, ordenable) {
  const container = $('mo-list');
  if (!list.length) {
    container.innerHTML = '<div class="list-empty">No hay roles cargados todavía.</div>';
    return;
  }
  container.innerHTML = list.map((r, idx) => {
    let meta;
    if (r.basico) {
      const c = calcCosto(r.basico, r.noRemunerativoMensual, r.extraPct);
      meta = [
        `Básico ${fmtARS(r.basico)}/hs`,
        r.extraPct ? `+${r.extraPct}% extra` : '',
        `Costo horario ${fmtARS(c.costoHorario)}/hs`,
        `Jornal (${paramsMO.jornadaHoras}hs) ${fmtARS(c.costoJornal)}`,
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
          ${ordenable ? `
          <button class="btn btn-sm btn-outline btn-icon btn-mover-rol" data-dir="-1" title="Subir" ${idx === 0 ? 'disabled' : ''}>${icSvg('arrowUp')}</button>
          <button class="btn btn-sm btn-outline btn-icon btn-mover-rol" data-dir="1" title="Bajar" ${idx === list.length - 1 ? 'disabled' : ''}>${icSvg('arrowDown')}</button>` : ''}
          <button class="btn btn-sm btn-outline btn-edit-rol">Editar</button>
          <button class="btn btn-sm btn-danger btn-del-rol">Eliminar</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.item-card').forEach(card => {
    const key = card.dataset.key;
    const rol = allRoles.find(r => r.key === key);
    card.querySelectorAll('.btn-mover-rol').forEach(btn => {
      btn.addEventListener('click', () => moverRol(key, parseInt(btn.dataset.dir, 10)));
    });
    card.querySelector('.btn-edit-rol').addEventListener('click', () => openEditModal(rol));
    card.querySelector('.btn-del-rol').addEventListener('click', () => deleteRol(rol));
  });
}

function applyFilter() {
  const q = $('mo-search').value.trim().toLowerCase();
  const filtered = q
    ? allRoles.filter(r => r.nombre.toLowerCase().includes(q))
    : allRoles;
  renderRoles(filtered, !q);
}

async function loadRoles() {
  const data = await _fbGet(`/obras/${obraKey}/roles.json`);
  allRoles = window.rolesOrdenados(Object.entries(data || {}).map(([key, r]) => ({ key, ...r })));
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
    `Costo horario: ${fmtARS(c.costoHorario)}/hs · Jornal (${paramsMO.jornadaHoras}hs): ${fmtARS(c.costoJornal)}`;
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
      await asegurarOrden();
      const key = keyDeRol(nombre);
      await _fbPut(`/obras/${obraKey}/roles/${key}.json`, { ...data, creadoEn: Date.now(), orden: ultimoOrden() + 1 });
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

/* ===== Importar de otra obra =====
   Dos cosas independientes, cada una con su casilla: los parámetros generales
   (reemplazan a los de esta obra) y los roles con sus básicos. Un rol que ya
   existe acá con el mismo nombre se actualiza con los valores de la obra
   origen — no se duplica la categoría. */

let obrasParaImportar = null;   // cache: [{key, nombre}] — todas menos la actual
let importarMoSelect = null;
let paramsOrigen = null;        // paramsMO de la obra elegida, o null
let rolesOrigen = null;         // { key: rol } de la obra elegida, o null

function resumenParams(p) {
  const partes = [
    `Asistencia ${p.asistenciaPct ?? 0}%`,
    `Cargas ${p.cargasPct ?? 0}%`,
    `${p.diasMes ?? 0} días/mes`,
    `Jornada ${p.jornadaHoras ?? 0} hs`,
  ];
  if (p.seguridadCapatazActivo) partes.push(`Seg. y capataz ${p.seguridadCapatazPct || 0}%`);
  if (p.comidaActivo) partes.push(`Comida ${fmtARS(p.comidaMonto || 0)}/día`);
  return partes.join(' · ');
}

async function abrirModalImportarMo() {
  $('importar-mo-confirmar').disabled = true;
  paramsOrigen = null;
  rolesOrigen = null;
  ['importar-mo-params', 'importar-mo-roles'].forEach(id => {
    $(id).checked = true;
    $(id).disabled = true;
  });
  $('importar-mo-params-info').textContent = 'Elegí la obra origen.';
  $('importar-mo-roles-info').textContent = 'Elegí la obra origen.';

  if (!obrasParaImportar) {
    const data = await _fbGet('/obras.json');
    obrasParaImportar = Object.entries(data || {})
      .filter(([key]) => key !== obraKey)
      .map(([key, o]) => ({ key, nombre: o.nombre || key }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  importarMoSelect = createSearchableSelect($('importar-mo-select'), {
    options: obrasParaImportar.map(o => ({ value: o.key, label: o.nombre })),
    placeholder: 'Buscar obra…',
    onChange: onElegirObraOrigenMo,
  });

  $('modal-importar-mo').classList.remove('hidden');
}

function cerrarModalImportarMo() {
  $('modal-importar-mo').classList.add('hidden');
}

async function onElegirObraOrigenMo(obraOrigenKey) {
  $('importar-mo-confirmar').disabled = true;
  $('importar-mo-params-info').textContent = 'Buscando…';
  $('importar-mo-roles-info').textContent = '';

  const [pData, rData] = await Promise.all([
    _fbGet(`/obras/${obraOrigenKey}/paramsMO.json`),
    _fbGet(`/obras/${obraOrigenKey}/roles.json`),
  ]);

  paramsOrigen = pData || null;
  $('importar-mo-params').disabled = !paramsOrigen;
  $('importar-mo-params').checked = !!paramsOrigen;
  $('importar-mo-params-info').textContent = paramsOrigen
    ? resumenParams(paramsOrigen)
    : 'Esa obra no tiene parámetros propios cargados.';

  const listaOrigen = Object.entries(rData || {});
  rolesOrigen = listaOrigen.length ? rData : null;
  $('importar-mo-roles').disabled = !rolesOrigen;
  $('importar-mo-roles').checked = !!rolesOrigen;
  if (rolesOrigen) {
    const existentes = new Set(allRoles.map(r => normNombre(r.nombre)));
    const pisan = listaOrigen.filter(([, r]) => existentes.has(normNombre(r.nombre))).length;
    const nuevos = listaOrigen.length - pisan;
    const partes = [];
    if (nuevos) partes.push(`${nuevos} se agrega${nuevos === 1 ? '' : 'n'}`);
    if (pisan)  partes.push(`${pisan} pisa${pisan === 1 ? '' : 'n'} al rol que ya tiene esta obra`);
    $('importar-mo-roles-info').textContent = `${listaOrigen.length} rol${listaOrigen.length === 1 ? '' : 'es'}: ${partes.join(', ')}.`;
  } else {
    $('importar-mo-roles-info').textContent = 'Esa obra no tiene roles cargados.';
  }

  $('importar-mo-confirmar').disabled = !paramsOrigen && !rolesOrigen;
}

async function confirmarImportarMo() {
  const traerParams = paramsOrigen && $('importar-mo-params').checked;
  const traerRoles  = rolesOrigen  && $('importar-mo-roles').checked;
  if (!traerParams && !traerRoles) return;

  const btn = $('importar-mo-confirmar');
  btn.disabled = true;
  btn.textContent = 'Importando…';

  const tareas = [];
  let nuevosParams = null;
  if (traerParams) {
    // Merge sobre los actuales: una obra vieja puede no tener todos los
    // campos, y así el nodo guardado nunca queda incompleto.
    nuevosParams = { ...paramsMO, ...paramsOrigen };
    tareas.push(_fbPut(`/obras/${obraKey}/paramsMO.json`, nuevosParams));
  }

  let cuantosRoles = 0;

  try {
    if (traerRoles) {
      // Los que se agregan van al final, en el orden que tienen en la obra
      // origen. A los que ya están acá no se les toca el orden: el de esta
      // obra manda.
      await asegurarOrden();
      let orden = ultimoOrden();
      const porNombre = {};
      allRoles.forEach(r => { porNombre[normNombre(r.nombre)] = r.key; });
      const listaOrigen = window.rolesOrdenados(
        Object.entries(rolesOrigen).map(([key, r]) => ({ key, ...r })));

      listaOrigen.forEach(r => {
        const data = {
          nombre: r.nombre,
          basico: r.basico ?? null,
          extraPct: r.extraPct ?? 0,
          noRemunerativoMensual: r.noRemunerativoMensual ?? null,
          fecha: r.fecha || todayIso(),
          basicoFormula: r.basicoFormula ?? null,
          extraPctFormula: r.extraPctFormula ?? null,
          noRemunerativoMensualFormula: r.noRemunerativoMensualFormula ?? null,
        };
        const existente = porNombre[normNombre(r.nombre)];
        cuantosRoles++;
        // PATCH por rol (no PUT del árbol de roles): el nodo de un rol que ya
        // está acá tiene campos propios — creadoEn, orden — que no hay que perder.
        if (existente) tareas.push(_fbPatch(`/obras/${obraKey}/roles/${existente}.json`, data));
        else tareas.push(_fbPut(`/obras/${obraKey}/roles/${keyDeRol(r.nombre)}.json`, { ...data, creadoEn: Date.now(), orden: ++orden }));
      });
    }
    await Promise.all(tareas);
    if (nuevosParams) {
      paramsMO = nuevosParams;
      fillParamsForm();
    }
    if (traerRoles) await loadRoles(); else applyFilter();
    cerrarModalImportarMo();
    const que = [
      traerParams ? 'Parámetros' : '',
      cuantosRoles ? `${cuantosRoles} rol${cuantosRoles === 1 ? '' : 'es'}` : '',
    ].filter(Boolean).join(' y ');
    showToast(`${que} importado${traerParams && cuantosRoles ? 's' : ''}.`);
  } catch (_) {
    showToast('Error al importar.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Importar';
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
  window.setCotizacionObra(obra.dolar ? obra.dolar.valor : null);

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

  attachMoneyInput($('param-comida-monto'));

  $('param-asistencia').addEventListener('blur', saveParams);
  $('param-cargas').addEventListener('blur', saveParams);
  $('param-dias').addEventListener('blur', saveParams);
  $('param-jornada').addEventListener('blur', saveParams);
  $('param-seg-cap-pct').addEventListener('blur', saveParams);
  $('param-comida-monto').addEventListener('blur', saveParams);
  $('param-seg-cap-activo').addEventListener('change', () => {
    $('param-seg-cap-pct').disabled = !$('param-seg-cap-activo').checked;
    saveParams();
  });
  $('param-comida-activo').addEventListener('change', () => {
    $('param-comida-monto').disabled = !$('param-comida-activo').checked;
    saveParams();
  });

  $('btn-importar-mo').addEventListener('click', abrirModalImportarMo);
  $('importar-mo-close').addEventListener('click', cerrarModalImportarMo);
  $('importar-mo-cancelar').addEventListener('click', cerrarModalImportarMo);
  $('importar-mo-confirmar').addEventListener('click', confirmarImportarMo);

  $('btn-add-rol').addEventListener('click', openAddModal);
  $('modal-rol-close').addEventListener('click',  () => $('modal-rol').classList.add('hidden'));
  $('modal-rol-cancel').addEventListener('click', () => $('modal-rol').classList.add('hidden'));
  $('modal-rol-save').addEventListener('click', saveRolModal);
  $('rol-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveRolModal(); });
  $('mo-search').addEventListener('input', applyFilter);

  await loadAll();
});

window.onDecimalesVista(() => applyFilter());
