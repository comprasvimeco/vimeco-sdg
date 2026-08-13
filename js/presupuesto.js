/* VIMECO S.A. — Sistema de Gestión — Presupuesto de obra
   Pantalla de sólo lectura: aplica el Coeficiente K (Carga Fija) al costo
   unitario de cada línea del Cómputo (ya con precios de esa obra resueltos,
   ver js/calcCostos.js) para sacar el precio unitario, y totaliza. Nada se
   edita acá — cantidades y receta se editan en Cómputo, %Beneficio/
   %CostoFinanciero/%IVA/gastos fijos en Carga Fija.

   K = (1 + %GastosGenerales + %Beneficio) × (1 + %CostoFinanciero) × (1 + Σ%Impuestos)
   %GastosGenerales = (gastos fijos de la obra) / (costo total del Cómputo). */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let rubros = [];   // [{ key, nombre, orden }] — ordenado por `orden`
let lineas = {};   // { lineaKey: { rubroId, nombre, unidad, cantidad, itemKey, orden } }
let items = [];
let materiales = [];
let equipos = [];
let roles = [];
let paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
let paramsMO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };
let preciosObra = {};
let dolarObra = null;   // dólar propio de esta obra (/obras/{obraKey}/dolar)
let cargaFijaLineas = {};
let cargaFijaConfig = { beneficioPct: null, costoFinancieroPct: null };

function versionDe(it) {
  const propia = it.versionesObra && it.versionesObra[obraKey];
  return propia || it;
}

function costoUnitarioDe(itemKey) {
  if (!itemKey) return 0;
  const it = items.find(i => i.key === itemKey);
  if (!it) return 0;
  const version = versionDe(it);
  if (!version.lineas || !Object.keys(version.lineas).length) return 0;
  const catalogos = { materiales, equipos, roles };
  const r = window.calcCostoUnitarioItem(version, version.lineas, catalogos, paramsEquipos, paramsMO, preciosObra, dolarObra);
  return r.costoUnitario;
}

function costoTotalLinea(linea) {
  const costo = costoUnitarioDe(linea.itemKey);
  const cantidad = linea.cantidad != null && !isNaN(linea.cantidad) ? linea.cantidad : 0;
  return costo * cantidad;
}

function costoTotalComputo() {
  return Object.values(lineas).reduce((acc, l) => acc + costoTotalLinea(l), 0);
}

// La fórmula del K vive en calcCostos.js (calcCoeficienteK), compartida con
// Carga Fija, Plan de Avance y el AP — acá sólo se usa el resultado.
function calcularK(costoComputo) {
  const gastosFijos = window.totalGastosFijosCargaFija(cargaFijaLineas, costoComputo, obra ? obra.presupuestoOficial : null);
  return window.calcCoeficienteK(cargaFijaConfig, gastosFijos, costoComputo).k;
}

function lineasDeRubro(rubroId) {
  return Object.entries(lineas)
    .filter(([, l]) => l.rubroId === rubroId)
    .sort((a, b) => (a[1].orden || 0) - (b[1].orden || 0));
}

function ordenarRubros() {
  rubros.sort((a, b) => (a.orden || 0) - (b.orden || 0));
}

function renderLineaRow(lineaKey, linea, numero, k, totalPresupuesto) {
  const precioUnitario = costoUnitarioDe(linea.itemKey) * k;
  const cantidad = linea.cantidad != null && !isNaN(linea.cantidad) ? linea.cantidad : 0;
  const total = precioUnitario * cantidad;
  const incidencia = totalPresupuesto > 0 ? total / totalPresupuesto : 0;
  // Etiqueta con la que se lee una referencia a esta línea desde una fórmula
  // (ver js/refs.js); la numeración la hace única.
  const et = `${numero} ${linea.nombre || 'Ítem'}`;
  const id = `presupuesto:linea:${lineaKey}`;
  return `
    <div class="presupuesto-linea">
      <span class="presupuesto-linea-numero">${numero}</span>
      <span>${escHtml(linea.nombre || '')}</span>
      <span>${escHtml(linea.unidad || '')}</span>
      <span${calcAttrs(linea.cantidad, `${id}:cantidad`, `${et} · Cantidad`)}>${linea.cantidad != null && !isNaN(linea.cantidad) ? fmtNum(linea.cantidad) : '—'}</span>
      <span class="presupuesto-linea-precio"${calcAttrs(precioUnitario, `${id}:precioUnit`, `${et} · Precio unit.`)}>${fmtARS(precioUnitario)}</span>
      <span class="presupuesto-linea-total"${calcAttrs(total, `${id}:total`, `${et} · Total`)}>${fmtARS(total)}</span>
      <span class="presupuesto-linea-incidencia"${calcAttrs(incidencia * 100, `${id}:incidencia`, `${et} · Incidencia %`)}>${fmtPct(incidencia)}</span>
    </div>`;
}

function subtotalRubroConPrecio(grupoLineas, k) {
  return grupoLineas.reduce((acc, [, l]) => {
    const cantidad = l.cantidad != null && !isNaN(l.cantidad) ? l.cantidad : 0;
    return acc + costoUnitarioDe(l.itemKey) * k * cantidad;
  }, 0);
}

function renderTodo() {
  const container = $('lineas-presupuesto');
  const resumen = $('resumen');
  ordenarRubros();

  const costoComputo = costoTotalComputo();
  const k = calcularK(costoComputo);

  if (k == null) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Esta obra todavía no tiene ítems cargados en el Cómputo — no se puede calcular el Presupuesto hasta que haya un costo de obra sobre el cual aplicar el Coeficiente K.</p>';
    resumen.innerHTML = '';
    return;
  }

  const totalPresupuesto = Object.values(lineas).reduce((acc, l) => {
    const cantidad = l.cantidad != null && !isNaN(l.cantidad) ? l.cantidad : 0;
    return acc + costoUnitarioDe(l.itemKey) * k * cantidad;
  }, 0);

  if (!rubros.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Todavía no hay rubros cargados en el Cómputo de esta obra.</p>';
  } else {
    const header = `
      <div class="presupuesto-linea presupuesto-linea-header">
        <span></span><span>Ítem</span><span>Unidad</span><span>Cantidad</span><span>Precio unitario</span><span>Total</span><span>Incidencia</span>
      </div>`;
    container.innerHTML = header + rubros.map((rubro, rubroIdx) => {
      const grupoLineas = lineasDeRubro(rubro.key);
      const subtotalRubro = subtotalRubroConPrecio(grupoLineas, k);
      const incidenciaRubro = totalPresupuesto > 0 ? subtotalRubro / totalPresupuesto : 0;
      const rubroHtml = `
        <div class="presupuesto-rubro-header">
          <span class="presupuesto-rubro-numero">${rubroIdx + 1}.</span>
          <span class="presupuesto-rubro-nombre">${escHtml(rubro.nombre || '(sin nombre)')}</span>
          <span class="presupuesto-rubro-subtotal"${calcAttrs(subtotalRubro, `presupuesto:rubro:${rubro.key}:subtotal`, `${rubroIdx + 1}. ${rubro.nombre || 'Rubro'} · Subtotal`)}>${fmtARS(subtotalRubro)}</span>
          <span class="presupuesto-rubro-incidencia"${calcAttrs(incidenciaRubro * 100, `presupuesto:rubro:${rubro.key}:incidencia`, `${rubroIdx + 1}. ${rubro.nombre || 'Rubro'} · Incidencia %`)}>${fmtPct(incidenciaRubro)}</span>
        </div>`;
      const lineasHtml = grupoLineas.length
        ? grupoLineas.map(([lk, l], i) => renderLineaRow(lk, l, `${rubroIdx + 1}.${i + 1}`, k, totalPresupuesto)).join('')
        : '<p class="text-muted" style="font-size:.8rem;padding:.4rem 0;">Sin líneas en este rubro.</p>';
      return rubroHtml + lineasHtml;
    }).join('');
  }

  resumen.innerHTML = `
    <div class="ap-resumen-row"><span>Costo total del Cómputo</span><span${calcAttrs(costoComputo, 'presupuesto:costoComputo', 'Costo total del Cómputo')}>${fmtARS(costoComputo)}</span></div>
    <div class="ap-resumen-row"><span>Coeficiente K</span><span${calcAttrs(k, 'presupuesto:k', 'Coeficiente K')}>${fmtK(k)}</span></div>
    <div class="ap-resumen-row total"><span>Total del Presupuesto</span><span${calcAttrs(totalPresupuesto, 'presupuesto:total', 'Total del Presupuesto')}>${fmtARS(totalPresupuesto)}</span></div>
    <p class="form-hint" style="margin-top:.5rem;">K se recalcula en vivo a partir de Carga Fija — no se cachea.</p>`;
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, rubrosComputoData, itemsData, materialesData, equiposData, rolesData, cargaFijaLineasData, cargaFijaConfigData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/computo.json`),
    _fbGet(`/obras/${obraKey}/rubrosComputo.json`),
    _fbGet('/items.json'),
    _fbGet('/materiales.json'),
    _fbGet('/equipos.json'),
    _fbGet(`/obras/${obraKey}/roles.json`),
    _fbGet(`/obras/${obraKey}/cargaFija/lineas.json`),
    _fbGet(`/obras/${obraKey}/cargaFija/config.json`),
  ]);

  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;
  lineas = lineasData || {};
  rubros = Object.entries(rubrosComputoData || {}).map(([key, r]) => ({ key, ...r }));
  items = Object.entries(itemsData || {}).map(([key, it]) => ({ key, ...it }));
  materiales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m }));
  equipos = Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e }));
  roles = Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r }));
  paramsEquipos = { ...paramsEquipos, ...(obra.paramsEquipos || {}) };
  paramsMO = { ...paramsMO, ...(obra.paramsMO || {}) };
  dolarObra = obra.dolar ? obra.dolar.valor : null;
  preciosObra = window.resolverPreciosObra(materiales, obraKey);
  cargaFijaLineas = cargaFijaLineasData || {};
  if (cargaFijaConfigData) cargaFijaConfig = { ...cargaFijaConfig, ...cargaFijaConfigData };

  $('header-obra-nombre').textContent = 'Presupuesto — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'presupuesto');
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (obra) renderTodo();
});

window.onDecimalesVista(() => { if (obra) renderTodo(); });
