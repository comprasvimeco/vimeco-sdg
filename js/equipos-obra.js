/* VIMECO S.A. — Sistema de Gestión — Equipos de obra
   Parámetros de costo de equipo (tasa interés, combustible, etc.) propios de
   esta obra — el catálogo físico de equipos (código, tipo, potencia, vida
   útil, costo) sigue siendo global, se administra en equipos.html. Acá solo
   se ve el costo de uso resultante para esta obra en particular, con estos
   parámetros y el dólar de esta obra (pestaña Datos). */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let allEquipos = [];
let paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
let jornadaHoras = 8;   // se toma de /config/manoDeObra.json (misma jornada que las cuadrillas, hasta que Mano de Obra sea por obra)
let dolarObra = null;

function fillParamsForm() {
  $('param-interes').value = paramsEquipos.tasaInteresPct;
  $('param-reparaciones').value = paramsEquipos.reparacionesPct;
  $('param-lubricantes').value = paramsEquipos.lubricantesPct;
  $('param-consumo').value = paramsEquipos.combustibleLtsPorHp;
  $('param-combustible').value = formatMoneyString(paramsEquipos.precioCombustibleLitro);
}

async function saveParams() {
  const tasaInteresPct        = parseFloat($('param-interes').value.replace(',', '.'));
  const reparacionesPct       = parseFloat($('param-reparaciones').value.replace(',', '.'));
  const lubricantesPct        = parseFloat($('param-lubricantes').value.replace(',', '.'));
  const combustibleLtsPorHp   = parseFloat($('param-consumo').value.replace(',', '.'));
  const precioCombustibleLitro = parseMoneyString($('param-combustible').value);
  if ([tasaInteresPct, reparacionesPct, lubricantesPct, combustibleLtsPorHp, precioCombustibleLitro].some(n => isNaN(n) || n < 0)) return;
  paramsEquipos = { tasaInteresPct, reparacionesPct, lubricantesPct, combustibleLtsPorHp, precioCombustibleLitro };
  try {
    await _fbPut(`/obras/${obraKey}/paramsEquipos.json`, paramsEquipos);
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
  const costoDiario = window.calcCostoDiarioEquipo(e, paramsEquipos, jornadaHoras, dolarObra);
  if (costoDiario != null) parts.push(`Costo de uso en esta obra: ${fmtARS(costoDiario)}/día`);
  else if (!dolarObra) parts.push('Cargá el dólar de esta obra (pestaña Datos) para ver el costo de uso');
  return parts.join(' · ') || 'Sin datos de costo cargados';
}

function renderEquipos(list) {
  const container = $('equipos-list');
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
    </div>`).join('');
}

function applyFilter() {
  const q = $('equipos-search').value.trim().toLowerCase();
  const filtered = q
    ? allEquipos.filter(e => (e.codigo || '').toLowerCase().includes(q) || (e.tipo || '').toLowerCase().includes(q))
    : allEquipos;
  renderEquipos(filtered);
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, equiposData, cfgMO] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet('/equipos.json'),
    _fbGet('/config/manoDeObra.json'),
  ]);

  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;
  allEquipos = Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es'));
  if (cfgMO && cfgMO.jornadaHoras) jornadaHoras = cfgMO.jornadaHoras;
  paramsEquipos = { ...paramsEquipos, ...(obra.paramsEquipos || {}) };
  dolarObra = obra.dolar ? obra.dolar.valor : null;

  $('header-obra-nombre').textContent = 'Equipos — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'equipos');
  fillParamsForm();
  applyFilter();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  attachMoneyInput($('param-combustible'));
  ['param-interes', 'param-reparaciones', 'param-lubricantes', 'param-consumo', 'param-combustible']
    .forEach(id => $(id).addEventListener('blur', saveParams));
  $('equipos-search').addEventListener('input', applyFilter);

  await loadAll();
  await getDolarSnapshot().catch(() => {});
});

window.onDecimalesVista(() => applyFilter());
