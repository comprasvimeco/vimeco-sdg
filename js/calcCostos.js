/* VIMECO S.A. — Fórmulas de costo compartidas (Equipos y Mano de Obra).
   Usado por equipos.js, manoDeObra.js e items.js — una sola fuente de verdad
   para que el costo de un equipo/rol sea el mismo se mire desde donde se mire.
   Fórmulas verificadas centavo a centavo contra la planilla de referencia
   (CyP Taller Río Cuarto.xlsx, hoja A.P.). */

// rol: { basico, extraPct, noRemunerativoMensual }
// params: { asistenciaPct, cargasPct, diasMes, jornadaHoras }
window.calcCostoManoDeObra = function (rol, params) {
  const basicoEfectivo = rol.basico * (1 + (rol.extraPct || 0) / 100);
  const conAsistencia = basicoEfectivo * (1 + params.asistenciaPct / 100);
  const conCargas = conAsistencia * (1 + params.cargasPct / 100);
  const comidaPorHora = (rol.noRemunerativoMensual || 0) / (params.diasMes * params.jornadaHoras);
  const costoHorario = conCargas + comidaPorHora;
  return { costoHorario, costoJornal: costoHorario * params.jornadaHoras, comidaPorHora };
};

// equipo: { costoUSD, vidaUtil, usoAnual, potencia }
// params: { tasaInteresPct, reparacionesPct, lubricantesPct, combustibleLtsPorHp, precioCombustibleLitro }
// Devuelve null si falta algún dato necesario (costo, vida útil, uso anual, cotización del dólar).
window.calcCostoDiarioEquipo = function (equipo, params, jornadaHoras) {
  const venta = window.dolarOficialVenta && window.dolarOficialVenta();
  if (!equipo.costoUSD || !equipo.vidaUtil || !equipo.usoAnual || !venta) return null;
  const costoActual = equipo.costoUSD * venta;
  const amortizacionDia = costoActual * jornadaHoras / equipo.vidaUtil;
  const interesesDia = (costoActual * params.tasaInteresPct / 100 / 2) / equipo.usoAnual * jornadaHoras;
  const reparacionesDia = amortizacionDia * params.reparacionesPct / 100;
  const combustibleDia = (params.combustibleLtsPorHp * (equipo.potencia || 0) * jornadaHoras) * params.precioCombustibleLitro;
  const lubricantesDia = combustibleDia * params.lubricantesPct / 100;
  return amortizacionDia + interesesDia + reparacionesDia + combustibleDia + lubricantesDia;
};

// Entre las cotizaciones asociadas a una obra puntual, arma el mapa de
// precios de materiales "ganador" (la fecha más reciente gana si hay más
// de una cotización con precio para el mismo material) — listo para
// pasarle a calcCostoUnitarioItem. Sin cotizaciones para esa obra, o sin
// obraKey, devuelve {} (comportamiento idéntico al de siempre: precio
// global). cotizaciones: array de { key, obraKey, precios: {materialKey: {...}} }.
window.resolverPreciosObra = function (cotizaciones, obraKey) {
  const resultado = {};
  if (!obraKey) return resultado;
  (cotizaciones || []).filter(c => c.obraKey === obraKey).forEach(c => {
    Object.entries(c.precios || {}).forEach(([materialKey, precio]) => {
      const actual = resultado[materialKey];
      if (!actual || (precio.fecha || '') >= (actual.fecha || '')) resultado[materialKey] = precio;
    });
  });
  return resultado;
};

// Costo unitario de un ítem de Biblioteca a partir de su receta (líneas) y
// rendimiento, con precios generales (materiales/equipos/MO). Usado por
// computo.js y carga-fija.js para calcular en vivo — la Biblioteca ya no
// cachea ningún costo (ver item.js, que sólo edita la receta).
// catalogos: { materiales, equipos, roles }
// preciosObra (opcional): mapa {materialKey: {precioUSD,...}} ya resuelto
// con resolverPreciosObra — pisa el precio global de ese material sólo acá.
window.calcCostoUnitarioItem = function (item, lineasItem, catalogos, paramsEquipos, paramsMO, preciosObra) {
  preciosObra = preciosObra || {};
  function catalogoFor(tipo) {
    if (tipo === 'material') return catalogos.materiales;
    if (tipo === 'equipo') return catalogos.equipos;
    return catalogos.roles;
  }
  function precioUnitarioMaterial(mat) {
    const venta = window.dolarOficialVenta();
    if (!mat || !venta) return null;
    const precioUSD = preciosObra[mat.key] ? preciosObra[mat.key].precioUSD : mat.precioUSD;
    if (!precioUSD) return null;
    return precioUSD * venta;
  }
  // costoUnitario acá es el precio de LA UNIDAD del material/equipo/rol
  // (ej. $/kg, costo diario del equipo, costo del jornal) — no el costo
  // unitario del ítem (eso es el agregado, más abajo). costoTotal es
  // cantidad × ese precio, sin dividir por rendimiento — para mostrar en
  // la fila de cada línea, no para el agregado.
  function costoLineaDetalle(linea) {
    const cat = catalogoFor(linea.tipo);
    const entidad = cat.find(c => c.key === linea.refKey);
    if (!entidad || linea.cantidad == null || isNaN(linea.cantidad)) return null;
    let costoUnitario;
    if (linea.tipo === 'material') {
      costoUnitario = precioUnitarioMaterial(entidad);
    } else if (linea.tipo === 'equipo') {
      costoUnitario = window.calcCostoDiarioEquipo(entidad, paramsEquipos, paramsMO.jornadaHoras);
    } else {
      costoUnitario = window.calcCostoManoDeObra(entidad, paramsMO).costoJornal;
    }
    if (costoUnitario == null) return null;
    return { costoUnitario, costoTotal: linea.cantidad * costoUnitario };
  }

  const rendimiento = item.rendimiento || 1;
  let costoMateriales = 0;
  let costoDiarioEquipos = 0;
  let costoDiarioMO = 0;
  const detallePorLinea = {};   // { lineaKey: { costoUnitario, costoTotal } }
  Object.entries(lineasItem || {}).forEach(([lineaKey, l]) => {
    const d = costoLineaDetalle(l);
    if (!d) return;
    detallePorLinea[lineaKey] = d;
    if (l.tipo === 'material') costoMateriales += d.costoTotal;
    else if (l.tipo === 'equipo') costoDiarioEquipos += d.costoTotal;
    else costoDiarioMO += d.costoTotal;
  });
  // Equipos (A) y Mano de Obra (B) se dividen por rendimiento cada uno por
  // separado (no combinados) — mismo criterio que la planilla de
  // referencia, para poder mostrar el subtotal de cada área por separado.
  const costoUnitarioEquipos = costoDiarioEquipos / rendimiento;
  const costoUnitarioMO = costoDiarioMO / rendimiento;
  const costoUnitario = costoMateriales + costoUnitarioEquipos + costoUnitarioMO;
  return {
    costoMateriales,
    costoDiarioEquipos, costoUnitarioEquipos,
    costoDiarioMO, costoUnitarioMO,
    costoUnitario,
    detallePorLinea,
  };
};
