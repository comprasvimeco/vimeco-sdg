/* VIMECO S.A. — Sistema de Gestión — Equipos (costo horario para Análisis de Precios) */

const $ = id => document.getElementById(id);

// Misma lista de identidad (código, tipo) que vimeco-oc usa para su flota —
// acá se le suman los datos de costo que vimeco-oc no trackea.
const SEED_EQUIPOS = [
  ['AC 86', 'Acoplado'],
  ['AT 286', 'Acoplado Tanque'],
  ['BS 103', 'Barredora Sopladora'],
  ['C 172', 'Camion L111'],
  ['C 23', 'Camión F6000'],
  ['C 301', 'Camion Tractor 1722'],
  ['C 316', 'Camion Tractor 1722'],
  ['C 321', 'Camion Tractor 1933'],
  ['C 340', 'Camion Homigonero 4M3'],
  ['C 362', 'Camion Stralis 440'],
  ['C 378', 'Camion Atego'],
  ['C 50', 'Camión Regador F700'],
  ['C 76', 'Camión Dist. Asfalto F700'],
  ['CB 306', 'Batea'],
  ['CB 319', 'Batea'],
  ['CJ 197', 'Cortadora De Juntas'],
  ['CPT 297', 'Compactador Pison Tremix'],
  ['CVA 332', 'Compactador Vibrador Ammann'],
  ['D 210', 'Desmalezadora'],
  ['D 380', 'Desmalezadora De Tiro'],
  ['DA 90', 'Distribuidora De Piedra'],
  ['GE 279', 'Grupo Electrógeno'],
  ['GE 294', 'Grupo Electrógeno'],
  ['GE 400', 'Grupo Electrog. Portatil 3Hp'],
  ['LAB 394', 'Laboratorio'],
  ['MB 270', 'Motobomba Bounus'],
  ['MB 271', 'Motobomba Bounus'],
  ['MC 16', 'Motocompactador'],
  ['MCASE 406', 'Martillo P/Case'],
  ['MG 356', 'Motoguadaña 280'],
  ['MG 384', 'Motoguadaña Sthil 291'],
  ['MN 291', 'Motoniveladora 140 H'],
  ['MN 358', 'Motoniveladora'],
  ['MN 72', 'Motoniveladora 14E'],
  ['MPC 4', 'Comp. Gig.,Terraco 1'],
  ['MS 386', 'Motosierra Stihl 250'],
  ['MS 392', 'Motosierra Stihl 250'],
  ['MTX 318', 'Bobcat'],
  ['MTX 328', 'Bobcat'],
  ['MTX 376', 'Bobcat'],
  ['MTXB 398', 'Barredora Angular'],
  ['MTXC 326', 'Comp. Rodillo P/Bobcat'],
  ['MTXF 382', 'Fresadora P/Bobcat'],
  ['MTXM 329', 'Martillo P/Bobcat'],
  ['MTXM 330', 'Martillo P/Bobcat'],
  ['MTXP 408', 'Paletizador P/Bobcat'],
  ['MTXT 331', 'Trailer Para Bobcat'],
  ['MTXZ 327', 'Zanjadora P/Bobcat'],
  ['P 288', 'Pick Up Ranger'],
  ['P 296', 'Pick Up S-10'],
  ['P 312', 'Pick Up Hilux'],
  ['P 313', 'Pick Up Hilux'],
  ['P 314', 'Pick Up Hilux'],
  ['P 317', 'Pick Up Ranger 4X4 Xlt'],
  ['P 319', 'Pick Up Saveiro'],
  ['P 320', 'Pick Up Hilux'],
  ['P 322', 'Ranger Xls'],
  ['P 350', 'Pick Up'],
  ['P 352', 'Pick Up'],
  ['P 366', 'Pick Up Alaskan 2,3 Tdi 4X4'],
  ['P 374', 'Pick Up Ranger 2,2 4X2'],
  ['P 412', 'Pick Up Hilux'],
  ['P 413', 'Pick Up Hilux'],
  ['P 414', 'Pick Up Hilux'],
  ['PA 290', 'Planta De Asfalto'],
  ['PA 311', 'Auto'],
  ['PA 354', 'Auto Versa'],
  ['PA 360', 'Auto Taos Suv'],
  ['PC 104', 'Pta.Clasif.De Aridos'],
  ['PH 238', 'Pala Hidráulica tiro'],
  ['PT 231', 'Planta De Trituración'],
  ['PTC 325', 'Trituradora Cono 2 Pies'],
  ['PU 368', 'Kangoo'],
  ['PU 370', 'Kangoo'],
  ['RD 177', 'Rastra A Discos'],
  ['RD 189', 'Rastra A Discos'],
  ['RE 305', 'Retroexc. Cat 320'],
  ['RE 388', 'Retroexcavadora Sany 215'],
  ['REC 310', 'Retropala Case 580 4Wd'],
  ['REC 315', 'Retropala Case 580 4Wd'],
  ['RLV 281', 'Comp. Rodillo Liso Vibrante'],
  ['RLV 299', 'Compactador'],
  ['RLV 364', 'Compactador'],
  ['RLV 78', 'Comp.Rodillo Liso Vibrante RVT100'],
  ['RNA 17', 'Comp. Rodillo Neum.Autoprop.'],
  ['RNV 342', 'Comp. Neum. Vibrante'],
  ['RPC 180', 'Comp. Rodillo Pata De Cabra'],
  ['RPP 410', 'Paletizador P/Case'],
  ['S 390', 'Semirremolque'],
  ['S 57', 'Semirremolque'],
  ['SC 58', 'Semirremolque Carreton'],
  ['TA 304', 'Terminadora Asfalto'],
  ['TO 102', 'Tractor Oruga D7 F'],
  ['TR 187', 'Tractor 727'],
  ['TR 188', 'Tractor 727'],
  ['TR 8', 'Tractor 780 R'],
  ['TR 94', 'Tractor 780 R'],
  ['TX 252', 'Cargador Frontal 930'],
  ['TX 268', 'Cargador Frontal 930'],
  ['TX 307', 'Cargadora Frontal'],
  ['TX 321', 'Cargadora Frontal'],
  ['TXM 372', 'Manitou'],
  ['VQ 217', 'Volqueta'],
  ['VQ 218', 'Volqueta'],
];

// Misma derivación de key que vimeco-oc, para que el código siga identificando
// al mismo equipo físico en las dos apps.
function equipoKey(codigo) {
  return String(codigo).trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

let allEquipos = [];
let editingKey = null;
let params = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
let jornadaHoras = 8; // se toma de /config/manoDeObra.json (misma jornada que las cuadrillas)

async function loadParams() {
  try {
    const data = await _fbGet('/config/equipos.json');
    if (data) params = { ...params, ...data };
  } catch (_) {}
  try {
    const mo = await _fbGet('/config/manoDeObra.json');
    if (mo && mo.jornadaHoras) jornadaHoras = mo.jornadaHoras;
  } catch (_) {}
  $('param-interes').value = params.tasaInteresPct;
  $('param-reparaciones').value = params.reparacionesPct;
  $('param-lubricantes').value = params.lubricantesPct;
  $('param-consumo').value = params.combustibleLtsPorHp;
  $('param-combustible').value = formatMoneyString(params.precioCombustibleLitro);
}

async function saveParams() {
  const tasaInteresPct        = parseFloat($('param-interes').value.replace(',', '.'));
  const reparacionesPct       = parseFloat($('param-reparaciones').value.replace(',', '.'));
  const lubricantesPct        = parseFloat($('param-lubricantes').value.replace(',', '.'));
  const combustibleLtsPorHp   = parseFloat($('param-consumo').value.replace(',', '.'));
  const precioCombustibleLitro = parseMoneyString($('param-combustible').value);
  if ([tasaInteresPct, reparacionesPct, lubricantesPct, combustibleLtsPorHp, precioCombustibleLitro].some(n => isNaN(n) || n < 0)) return;
  params = { tasaInteresPct, reparacionesPct, lubricantesPct, combustibleLtsPorHp, precioCombustibleLitro };
  try {
    await _fbPut('/config/equipos.json', params);
    applyFilter();
  } catch (_) {
    showToast('Error al guardar los parámetros.', 'error');
  }
}

function metaLine(e) {
  const parts = [];
  if (e.potencia)  parts.push(`${e.potencia} HP`);
  if (e.usoAnual)  parts.push(`${e.usoAnual} hs/año`);
  if (e.vidaUtil)  parts.push(`vida útil ${e.vidaUtil} hs`);
  if (e.costoUSD)  parts.push(fmtUSDConEquivalente(e.costoUSD));
  const costoDiario = window.calcCostoDiarioEquipo(e, params, jornadaHoras);
  if (costoDiario != null) parts.push(`Costo de uso ${fmtARS(costoDiario)}/día`);
  return parts.join(' · ') || 'Sin datos de costo cargados';
}

function renderEquipos(list) {
  const container = $('equipos-list');
  const seedBtn = $('btn-seed');
  seedBtn.classList.toggle('hidden', allEquipos.length > 0);

  if (!list.length) {
    container.innerHTML = '<div class="list-empty">No hay equipos cargados todavía.</div>';
    return;
  }
  container.innerHTML = list.map(e => `
    <div class="item-card" data-key="${escHtml(e.key)}">
      <div class="item-card-info">
        <span class="item-card-title">${escHtml(e.tipo || '')} <span class="text-muted">${escHtml(e.codigo)}</span></span>
        <span class="item-card-meta">${escHtml(metaLine(e))}</span>
      </div>
      <div class="item-card-actions">
        <button class="btn btn-sm btn-outline btn-edit-equipo">Editar</button>
        <button class="btn btn-sm btn-danger btn-del-equipo">Eliminar</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.item-card').forEach(card => {
    const key = card.dataset.key;
    const equipo = allEquipos.find(e => e.key === key);
    card.querySelector('.btn-edit-equipo').addEventListener('click', () => openEditModal(equipo));
    card.querySelector('.btn-del-equipo').addEventListener('click', () => deleteEquipo(equipo));
  });
}

function applyFilter() {
  const q = $('equipos-search').value.trim().toLowerCase();
  const filtered = q
    ? allEquipos.filter(e => (e.codigo || '').toLowerCase().includes(q) || (e.tipo || '').toLowerCase().includes(q))
    : allEquipos;
  renderEquipos(filtered);
}

async function loadEquipos() {
  $('equipos-list').innerHTML = '<div class="list-loading">Cargando equipos…</div>';
  try {
    const data = await _fbGet('/equipos.json');
    allEquipos = Object.entries(data || {}).map(([key, e]) => ({ key, ...e }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es'));
    applyFilter();
  } catch (_) {
    $('equipos-list').innerHTML = '<div class="list-empty">Error al cargar equipos.</div>';
  }
}

function openAddModal() {
  editingKey = null;
  $('modal-equipo-title').textContent = 'Agregar equipo';
  $('modal-equipo-error').classList.add('hidden');
  $('equipo-codigo').value = '';
  $('equipo-tipo').value = '';
  $('equipo-potencia').value = '';
  $('equipo-uso-anual').value = '';
  $('equipo-vida-util').value = '';
  $('equipo-costo').value = '';
  ['equipo-potencia', 'equipo-uso-anual', 'equipo-vida-util', 'equipo-costo'].forEach(id => setCalcFormula($(id), null));
  $('modal-equipo').classList.remove('hidden');
  setTimeout(() => $('equipo-codigo').focus(), 50);
}

function openEditModal(equipo) {
  editingKey = equipo.key;
  $('modal-equipo-title').textContent = 'Editar equipo';
  $('modal-equipo-error').classList.add('hidden');
  $('equipo-codigo').value = equipo.codigo || '';
  $('equipo-tipo').value = equipo.tipo || '';
  $('equipo-potencia').value = equipo.potencia ?? '';
  $('equipo-uso-anual').value = equipo.usoAnual ?? '';
  $('equipo-vida-util').value = equipo.vidaUtil ?? '';
  $('equipo-costo').value = formatMoneyString(equipo.costoUSD);
  setCalcFormula($('equipo-potencia'), equipo.potenciaFormula);
  setCalcFormula($('equipo-uso-anual'), equipo.usoAnualFormula);
  setCalcFormula($('equipo-vida-util'), equipo.vidaUtilFormula);
  setCalcFormula($('equipo-costo'), equipo.costoUSDFormula);
  $('modal-equipo').classList.remove('hidden');
  setTimeout(() => $('equipo-codigo').focus(), 50);
}

function numOrNull(input) {
  if (input.value.trim().startsWith('=')) input.blur();
  const v = input.value.trim();
  if (!v) return null;
  const n = parseFloat(v.replace(',', '.'));
  return isNaN(n) ? null : n;
}

function moneyOrNull(input) {
  if (input.value.trim().startsWith('=')) input.blur();
  const v = input.value.trim();
  if (!v) return null;
  const n = parseMoneyString(v);
  return isNaN(n) ? null : n;
}

async function saveEquipoModal() {
  const codigo = $('equipo-codigo').value.trim();
  const tipo   = $('equipo-tipo').value.trim();
  const errEl  = $('modal-equipo-error');

  if (!codigo) {
    errEl.textContent = 'El código es requerido.';
    errEl.classList.remove('hidden');
    return;
  }

  const key = equipoKey(codigo);
  if (!editingKey && allEquipos.some(e => e.key === key)) {
    errEl.textContent = 'Ya existe un equipo con ese código.';
    errEl.classList.remove('hidden');
    return;
  }

  const potencia = numOrNull($('equipo-potencia'));
  const usoAnual = numOrNull($('equipo-uso-anual'));
  const vidaUtil = numOrNull($('equipo-vida-util'));
  const costoUSD = moneyOrNull($('equipo-costo'));
  const potenciaFormula = getCalcFormula($('equipo-potencia'));
  const usoAnualFormula = getCalcFormula($('equipo-uso-anual'));
  const vidaUtilFormula = getCalcFormula($('equipo-vida-util'));
  const costoUSDFormula = getCalcFormula($('equipo-costo'));

  const saveBtn = $('modal-equipo-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    const data = {
      codigo, tipo, potencia, usoAnual, vidaUtil, costoUSD,
      potenciaFormula, usoAnualFormula, vidaUtilFormula, costoUSDFormula,
    };
    if (editingKey) {
      await _fbPatch(`/equipos/${editingKey}.json`, data);
    } else {
      await _fbPut(`/equipos/${key}.json`, { ...data, creadoEn: Date.now() });
    }
    $('modal-equipo').classList.add('hidden');
    showToast(editingKey ? 'Equipo actualizado.' : 'Equipo creado.');
    await loadEquipos();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar';
  }
}

async function deleteEquipo(equipo) {
  const ok = await showConfirm('Eliminar equipo', `¿Eliminar "${equipo.codigo}"? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await _fbDel(`/equipos/${equipo.key}.json`);
    showToast('Equipo eliminado.');
    await loadEquipos();
  } catch (_) {
    showToast('Error al eliminar el equipo.', 'error');
  }
}

async function seedEquipos() {
  const ok = await showConfirm(
    'Importar lista de vimeco-oc',
    `Se van a cargar ${SEED_EQUIPOS.length} equipos (código y tipo, sin datos de costo). Los que ya existan con ese código se van a sobrescribir.`
  );
  if (!ok) return;

  const btn = $('btn-seed');
  btn.disabled = true;
  btn.textContent = 'Importando…';
  try {
    await Promise.all(SEED_EQUIPOS.map(([codigo, tipo]) =>
      _fbPut(`/equipos/${equipoKey(codigo)}.json`, { codigo, tipo, creadoEn: Date.now() })
    ));
    showToast('Lista importada.');
    await loadEquipos();
  } catch (_) {
    showToast('Error al importar la lista.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Importar lista de vimeco-oc';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  attachCalcInput($('equipo-potencia'));
  attachCalcInput($('equipo-uso-anual'));
  attachCalcInput($('equipo-vida-util'));
  attachCalcInput($('equipo-costo'));
  attachMoneyInput($('equipo-costo'));
  attachMoneyInput($('param-combustible'));

  $('btn-add-equipo').addEventListener('click', openAddModal);
  $('btn-seed').addEventListener('click', seedEquipos);
  $('modal-equipo-close').addEventListener('click',  () => $('modal-equipo').classList.add('hidden'));
  $('modal-equipo-cancel').addEventListener('click', () => $('modal-equipo').classList.add('hidden'));
  $('modal-equipo-save').addEventListener('click', saveEquipoModal);
  $('equipo-codigo').addEventListener('keydown', e => { if (e.key === 'Enter') saveEquipoModal(); });
  $('equipos-search').addEventListener('input', applyFilter);

  ['param-interes', 'param-reparaciones', 'param-lubricantes', 'param-consumo', 'param-combustible']
    .forEach(id => $(id).addEventListener('blur', saveParams));

  loadParams().then(loadEquipos);
  // Refresca la cotización y repinta la lista una vez que llega (para mostrar
  // el equivalente en pesos aunque no hubiera nada cacheado al entrar).
  getDolarSnapshot().then(() => applyFilter()).catch(() => {});
});
