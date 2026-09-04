/* VIMECO S.A. — Sistema de Gestión — Insumos de la obra (materiales, equipos y mano de obra)
   Pantalla de sólo lectura: consolida, para toda la obra, qué insumos hacen
   falta — recorriendo cada línea del Cómputo (cantidad × ítem) y, dentro de
   la receta de ese ítem, sus líneas. Un mismo insumo usado en varias líneas
   de Cómputo (de cualquier rubro) se suma en una sola fila. Líneas de
   Cómputo sin ítem vinculado (texto libre, sin receta) no aportan insumos y
   no aparecen acá.

   La consolidación en sí (materiales, equipos, mano de obra) vive en
   js/insumosDatos.js — la comparte con la sección "Insumos" de la
   exportación (js/exportar.js), para que pantalla y PDF salgan iguales. Acá
   sólo se junta lo que necesita ese módulo y se pinta. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let modeloIns = null;   // forma de presupuestoDatos.js: ver js/insumosDatos.js
let ordenPorCosto = false;   // false: orden natural de cada tabla (nombre/código/orden); true: costo estimado, mayor a menor

/* Pinta una de las tres tablas. `resultado` viene de calcularInsumosObra
   (js/insumosDatos.js): { filas: [{ key, nombre, unidad, cantidad,
   costoUnitario, costoTotal, usados }], costoTotal, faltaPrecio }. */
function renderTabla(containerId, resumenId, resultado, opts) {
  const container = $(containerId);
  const resumen = $(resumenId);

  if (!resultado.filas.length) {
    container.innerHTML = `<p class="text-muted" style="font-size:.85rem;">${opts.vacio}</p>`;
    resumen.innerHTML = '';
    return;
  }

  const header = `
    <div class="materiales-linea materiales-linea-header">
      <span>${opts.colNombre}</span><span>Unidad</span><span>${opts.colCantidad}</span><span>Usado en</span><span>Costo estimado</span>
    </div>`;

  const filas = ordenPorCosto
    ? [...resultado.filas].sort((a, b) => (b.costoTotal || 0) - (a.costoTotal || 0))
    : resultado.filas;

  const filasHtml = filas.map(f => {
    const costoStr = f.costoTotal != null ? fmtARS(f.costoTotal) : '—';
    const usadosTexto = f.usados.map(u => u.nombre).join(', ');
    const usadosTitle = f.usados
      .map(u => `${u.nombre}: ${fmtNum(u.cantidad)} ${f.unidad}`)
      .join('\n');
    return `
      <div class="materiales-linea">
        <span>${escHtml(f.nombre)}</span>
        <span>${escHtml(f.unidad)}</span>
        <span class="materiales-cantidad"${calcAttrs(f.cantidad, `${opts.calcNs}:${f.key}:cantidad`, `${f.nombre} · ${opts.colCantidad}`)}>${fmtNum(f.cantidad)}</span>
        <span class="materiales-usados" title="${escHtml(usadosTitle)}">${escHtml(usadosTexto)}</span>
        <span class="materiales-costo"${f.costoTotal != null ? calcAttrs(f.costoTotal, `${opts.calcNs}:${f.key}:costo`, `${f.nombre} · Costo`) : ''}>${costoStr}</span>
      </div>`;
  }).join('');

  container.innerHTML = header + filasHtml;

  resumen.innerHTML = `
    <div class="ap-resumen-row total"><span>${opts.labelTotal}</span><span${calcAttrs(resultado.costoTotal, `${opts.calcNs}:total`, opts.labelTotal)}>${fmtARS(resultado.costoTotal)}</span></div>
    ${resultado.faltaPrecio ? `<p class="form-hint" style="margin-top:.5rem;">${opts.avisoSinPrecio}</p>` : ''}`;
}

function renderTodo() {
  const insumos = window.calcularInsumosObra(modeloIns);

  renderTabla('lineas-materiales', 'resumen', insumos.materiales, {
    calcNs: 'materiales',
    colNombre: 'Material',
    colCantidad: 'Cantidad necesaria',
    labelTotal: 'Costo total estimado de materiales',
    vacio: 'Todavía no hay materiales para mostrar — cargá líneas en el Cómputo vinculadas a un ítem con receta de materiales.',
    avisoSinPrecio: 'Algunos materiales no tienen precio cargado para esta obra — no se incluyen en el costo total.',
  });

  renderTabla('lineas-equipos', 'resumen-equipos', insumos.equipos, {
    calcNs: 'equipos',
    colNombre: 'Equipo',
    colCantidad: 'Días de uso',
    labelTotal: 'Costo total estimado de equipos',
    vacio: 'Todavía no hay equipos para mostrar — cargá líneas en el Cómputo vinculadas a un ítem con equipos en su receta.',
    avisoSinPrecio: 'Algunos equipos no tienen costo calculable en esta obra (falta costo, vida útil, uso anual o el dólar de la obra) — no se incluyen en el costo total.',
  });

  renderTabla('lineas-mano-de-obra', 'resumen-mano-de-obra', insumos.manoDeObra, {
    calcNs: 'manoDeObra',
    colNombre: 'Categoría',
    colCantidad: 'Días necesarios',
    labelTotal: 'Costo total estimado de mano de obra',
    vacio: 'Todavía no hay mano de obra para mostrar — cargá líneas en el Cómputo vinculadas a un ítem con mano de obra en su receta.',
    avisoSinPrecio: 'Algunas categorías no tienen básico cargado en Mano de Obra de esta obra — no se incluyen en el costo total.',
  });
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, itemsData, materialesData, equiposData, rolesData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/computo.json`),
    _fbGet('/items.json'),
    _fbGet('/materiales.json'),
    _fbGet('/equipos.json'),
    _fbGet(`/obras/${obraKey}/roles.json`),
  ]);

  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;
  const materiales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m }));
  const paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0, ...(obra.paramsEquipos || {}) };
  const paramsMO = {
    asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8,
    seguridadCapatazActivo: false, seguridadCapatazPct: 0,
    comidaActivo: false, comidaMonto: 0,
    ...(obra.paramsMO || {}),
  };
  const dolarObra = obra.dolar ? obra.dolar.valor : null;
  window.setCotizacionObra(dolarObra);

  modeloIns = {
    obraKey,
    catalogos: {
      items: Object.entries(itemsData || {}).map(([key, it]) => ({ key, ...it })),
      materiales,
      equipos: Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e })),
      roles: Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r })),
    },
    computo: lineasData || {},
    preciosObra: window.resolverPreciosObra(materiales, obraKey),
    paramsEquipos,
    paramsMO,
    dolarObra,
  };

  $('header-obra-nombre').textContent = 'Insumos — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'insumos');
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('chk-orden-costo').addEventListener('change', e => {
    ordenPorCosto = e.target.checked;
    if (modeloIns) renderTodo();
  });
  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (modeloIns) renderTodo();
});

window.onDecimalesVista(() => { if (modeloIns) renderTodo(); });
