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

// Costo unitario de un ítem de Biblioteca a partir de su receta (líneas) y
// rendimiento, con precios generales (materiales/equipos/MO). Usado por
// computo.js y carga-fija.js para calcular en vivo — la Biblioteca ya no
// cachea ningún costo (ver item.js, que sólo edita la receta).
// catalogos: { materiales, equipos, roles }
window.calcCostoUnitarioItem = function (item, lineasItem, catalogos, paramsEquipos, paramsMO) {
  function catalogoFor(tipo) {
    if (tipo === 'material') return catalogos.materiales;
    if (tipo === 'equipo') return catalogos.equipos;
    return catalogos.roles;
  }
  function precioUnitarioMaterial(mat) {
    const venta = window.dolarOficialVenta();
    if (!mat || !mat.precioUSD || !venta) return null;
    return mat.precioUSD * venta;
  }
  function costoLinea(linea) {
    const cat = catalogoFor(linea.tipo);
    const entidad = cat.find(c => c.key === linea.refKey);
    if (!entidad || linea.cantidad == null || isNaN(linea.cantidad)) return null;
    if (linea.tipo === 'material') {
      const precio = precioUnitarioMaterial(entidad);
      return precio == null ? null : linea.cantidad * precio;
    }
    if (linea.tipo === 'equipo') {
      const costoDiario = window.calcCostoDiarioEquipo(entidad, paramsEquipos, paramsMO.jornadaHoras);
      return costoDiario == null ? null : linea.cantidad * costoDiario;
    }
    const c = window.calcCostoManoDeObra(entidad, paramsMO);
    return linea.cantidad * c.costoJornal;
  }

  let costoMateriales = 0;
  let costoDiarioEquiposMO = 0;
  Object.values(lineasItem || {}).forEach(l => {
    const c = costoLinea(l);
    if (c == null) return;
    if (l.tipo === 'material') costoMateriales += c;
    else costoDiarioEquiposMO += c;
  });
  const rendimiento = item.rendimiento || 1;
  const costoEquiposMOPorUnidad = costoDiarioEquiposMO / rendimiento;
  const costoUnitario = costoMateriales + costoEquiposMOPorUnidad;
  return { costoMateriales, costoEquiposMOPorUnidad, costoUnitario };
};
