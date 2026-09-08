/* VIMECO S.A. — Sistema de Gestión — Exportar (PDF)

   Arma el documento formal de la obra en HTML y lo manda a imprimir: el
   navegador se encarga del "Guardar como PDF". No hay librería de PDF ni una
   página aparte para imprimir — la vista previa que se ve en pantalla es
   exactamente la hoja que sale, y css/print.css apaga la app alrededor.

   Los números vienen del mismo modelo que usa la pantalla Presupuesto
   (js/presupuestoDatos.js), así que el papel no puede discrepar de la
   pantalla. Acá se decide únicamente cómo se ve.

   Formato del documento tomado de la planilla de referencia (CyP Taller Río
   Cuarto.xlsx, hojas "Resumen" y "CyP").

   Secciones de esta primera entrega: Resumen por rubro y Presupuesto
   detallado por ítem. Análisis de Precios, Plan de trabajos, curvas y Carga
   Fija se suman después, como secciones nuevas de este mismo documento. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

const NOTAS_DEFAULT =
  '* Los precios indicados incluyen IVA, Beneficios, Costos Directos e Indirectos, y todo otro gasto necesario para la correcta ejecución de los trabajos.\n' +
  '** En todos los ítems se cotiza de acuerdo a lo detallado en el Pliego de Especificaciones Técnicas y en la documentación gráfica del proyecto.';

const SECCIONES = [
  { id: 'resumen',     label: 'Resumen por rubro', render: seccionResumen },
  { id: 'presupuesto', label: 'Presupuesto detallado', render: seccionPresupuesto },
  { id: 'analisis',    label: 'Análisis de precios', render: seccionAnalisisPrecios },
  { id: 'auxiliares',  label: 'Análisis auxiliares', render: seccionAuxiliares },
  { id: 'plan',        label: 'Plan de trabajos', render: seccionPlanTrabajos, apaisada: true },
  { id: 'curvas',      label: 'Curva de inversión', render: seccionCurvas },
  { id: 'cargafija',   label: 'Carga Fija', render: seccionCargaFija },
  { id: 'gastosfijos', label: 'Gastos fijos de la obra', render: seccionGastosFijos },
  { id: 'equipos',     label: 'Amortización de equipos', render: seccionEquipos },
  { id: 'insumos',     label: 'Insumos', render: seccionInsumos },
];

// Secciones internas de la empresa: existen para poder imprimirlas cuando uno
// quiere, pero arrancan destildadas para que no se vayan sin querer en un
// presupuesto que se manda al comitente.
const SECCIONES_INTERNAS = ['auxiliares', 'gastosfijos', 'equipos', 'insumos'];

/* Secciones que no siempre hay para emitir: una obra sin rubros (ver
   js/numeracion.js) no tiene Resumen por rubro, una obra sin análisis
   auxiliares no tiene nada que poner en esa sección, y una obra sin equipos
   en ningún A.P no tiene nada que desglosar en "Amortización de equipos". */
function seccionesDisponibles() {
  return SECCIONES.filter(s => {
    if (s.id === 'resumen') return !modelo.numeracion.sinRubros;
    if (s.id === 'auxiliares') return modelo.auxiliares.length > 0;
    if (s.id === 'equipos') return window.equiposUsadosEnObra(modelo).length > 0;
    return true;
  });
}

// Tamaño y orientación de hoja del Plan de trabajos: el cronograma se corta
// en bloques y cada uno repite las columnas fijas (ítem, cantidad, precio),
// igual que las tres áreas de impresión de la planilla de referencia. Los dos
// se eligen con los botones junto al checkbox de la sección (renderSecciones)
// porque no hay una combinación que sirva siempre — un plan chico entra
// cómodo en A4, uno grande necesita más hoja para que el pie (importes
// completos en pesos, no en miles) no se corte, y vertical sólo tiene sentido
// con pocos períodos o junto con "Ajustar a una hoja".
//
// ladoLargoMm/ladoCortoMm son los dos lados de la hoja (A4 = 297×210, etc.);
// cuál es "ancho" y cuál "alto" depende de la orientación. periodosH/V son la
// cantidad de períodos por bloque en cada orientación — apuntan a dejar
// ~30-32 mm por columna, suficiente para que "$ 772.197.031,78" entre en una
// sola línea (con tan poco ancho disponible en vertical, A4-V da apenas 1: es
// una combinación posible pero angosta, para plegar con "Ajustar a una
// hoja"). MARGEN_LR_MM/MARGEN_TB_MM son los márgenes de css/print.css.
const HOJA_TAMANOS = {
  A4: { ladoLargoMm: 297, ladoCortoMm: 210, periodosH: 4,  periodosV: 1 },
  A3: { ladoLargoMm: 420, ladoCortoMm: 297, periodosH: 8,  periodosV: 4 },
  A2: { ladoLargoMm: 594, ladoCortoMm: 420, periodosH: 13, periodosV: 8 },
};
const MARGEN_LR_MM = 12 + 12;
const MARGEN_TB_MM = 10 + 12;

const hojaPlanElegida = () => (HOJA_TAMANOS[config.hojaPlan] ? config.hojaPlan : 'A3');
const hojaPlanOrientacionElegida = () => (config.hojaPlanOrientacion === 'vertical' ? 'vertical' : 'horizontal');

// Medidas de la combinación tamaño+orientación actual: ancho/alto de hoja,
// área útil (para el zoom de "Ajustar a una hoja") y períodos por bloque.
function dimsHojaPlan() {
  const t = HOJA_TAMANOS[hojaPlanElegida()];
  const horizontal = hojaPlanOrientacionElegida() === 'horizontal';
  const anchoMm = horizontal ? t.ladoLargoMm : t.ladoCortoMm;
  const altoMm = horizontal ? t.ladoCortoMm : t.ladoLargoMm;
  return {
    anchoMm, altoMm,
    anchoUtilMm: anchoMm - MARGEN_LR_MM,
    altoUtilMm: altoMm - MARGEN_TB_MM,
    periodos: horizontal ? t.periodosH : t.periodosV,
  };
}
const periodosPorHoja = () => dimsHojaPlan().periodos;

let modelo = null;
let config = { notas: null, hojaPlan: 'A3', hojaPlanOrientacion: 'horizontal', hojaPlanAjustar: false, insumosDesglose: false };
let incluidas = {};   // { seccionId: bool }

/* ===== Formato del documento =====
   Fijo en 2 decimales para la plata: el selector de decimales del header es
   una preferencia de pantalla, un presupuesto que se firma va siempre en
   centavos. */

function fmtDoc(n, dec, extra) {
  if (n == null || n === '' || isNaN(n)) return '—';
  return Number(n).toLocaleString('es-AR',
    Object.assign({ minimumFractionDigits: dec, maximumFractionDigits: dec }, extra));
}
const docARS  = n => fmtDoc(n, 2, { style: 'currency', currency: 'ARS' });
const docCant = n => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 }));
const docPct  = frac => (frac == null || isNaN(frac) ? '—' : fmtDoc(frac * 100, 2) + '%');

/* ===== Importe en letras ===== */

const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function menorAMil(n) {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const centena = CENTENAS[c];
  let resto;
  if (r < 30) resto = UNIDADES[r];
  else {
    const d = Math.floor(r / 10);
    const u = r % 10;
    resto = DECENAS[d] + (u ? ' y ' + UNIDADES[u] : '');
  }
  return [centena, resto].filter(Boolean).join(' ');
}

// "uno" se apocopa cuando multiplica: veintiún mil, un millón.
const apocopar = txt => txt.replace(/uno$/, 'ún');

function enLetras(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'cero';
  if (n >= 1e12) return String(n);   // fuera de rango razonable para un presupuesto
  const partes = [];
  const millones = Math.floor(n / 1e6);
  const resto = n % 1e6;
  if (millones) {
    partes.push(millones === 1 ? 'un millón' : enLetras(millones).replace(/uno$/, 'ún') + ' millones');
  }
  const miles = Math.floor(resto / 1000);
  const unidades = resto % 1000;
  if (miles) partes.push(miles === 1 ? 'mil' : apocopar(menorAMil(miles)) + ' mil');
  if (unidades) partes.push(menorAMil(unidades));
  return partes.join(' ');
}

function importeEnLetras(n) {
  if (n == null || isNaN(n)) return '';
  const entero = Math.floor(n);
  const centavos = Math.round((n - entero) * 100);
  return `${enLetras(entero)} con ${String(centavos).padStart(2, '0')}/100`;
}

/* ===== Bloques del documento ===== */

// Filas del membrete: los "Datos generales" de la obra, tal como se cargan en
// la pantalla Datos (ver js/encabezado.js). Nada es fijo acá — hasta Oferente
// y Domicilio se editan por obra, que es lo que hace falta cuando se presenta
// en consorcio. Lo usa el documento imprimible y también la exportación a
// Excel (js/excelExport.js), para que las dos salidas lleven la misma cabecera.
function filasMembrete() {
  return window.filasEncabezado(modelo.obra, modelo.encabezado);
}

function membrete(titulo) {
  const filas = filasMembrete();
  return `
    <div class="doc-membrete">
      <div class="doc-membrete-logo"><img src="${LOGO_BASE64}" alt="VIMECO S.A."></div>
      <dl class="doc-membrete-datos">
        ${filas.map(f => `<dt>${escHtml(f.etiqueta)}:</dt><dd>${escHtml(f.valor)}</dd>`).join('')}
      </dl>
    </div>
    <h2 class="doc-titulo">${escHtml(titulo)}</h2>`;
}

// Cierre de hoja: sólo las notas. El documento no lleva lugar, fecha ni
// espacio de firma — la fecha que corresponde es la del membrete.
function notasAlPie() {
  const notas = config.notas != null ? config.notas : NOTAS_DEFAULT;
  return notas.trim() ? `<div class="doc-notas">${escHtml(notas)}</div>` : '';
}

/* Cierre de un cuadro de precios: importe en letras y notas al pie. Va en las
   dos secciones que cotizan la obra entera (Resumen por rubro y Presupuesto
   detallado), porque cualquiera de las dos puede ser la que se firma: una obra
   con la lista plana prendida no tiene Resumen y ahí el único cuadro con el
   total de la obra es el detallado. */
function cierreCuadro() {
  return `
    <div class="doc-son-pesos">Son pesos: ${escHtml(importeEnLetras(modelo.total))}</div>
    ${notasAlPie()}`;
}

function seccionResumen() {
  // Un renglón por rubro, como la hoja "Resumen" de la planilla: la unidad es
  // global (gl) y la cantidad 1, porque lo que se cotiza en este cuadro es el
  // rubro completo.
  const filas = modelo.rubros.map(r => `
    <tr>
      <td class="doc-centro">${escHtml(r.numero)}</td>
      <td>${escHtml(r.nombre || '(sin nombre)')}</td>
      <td class="doc-centro">gl</td>
      <td class="doc-num">1,00</td>
      <td class="doc-num">${docARS(r.subtotal)}</td>
      <td class="doc-num">${docARS(r.subtotal)}</td>
    </tr>`).join('');

  return `
    ${membrete('Resumen de cómputo y presupuesto')}
    <table class="doc-tabla">
      <thead>
        <tr>
          <th style="width:11mm;">Ítem</th>
          <th>Designación</th>
          <th style="width:12mm;">Un.</th>
          <th style="width:16mm;">Cant.</th>
          <th style="width:30mm;">Precio unitario</th>
          <th style="width:32mm;">Precio total</th>
        </tr>
      </thead>
      <tbody>
        ${filas || '<tr><td colspan="6" class="doc-centro">Sin rubros cargados en el Cómputo.</td></tr>'}
        <tr class="doc-fila-total">
          <td colspan="5">Precio total de la obra</td>
          <td class="doc-num">${docARS(modelo.total)}</td>
        </tr>
      </tbody>
    </table>
    ${cierreCuadro()}`;
}

function seccionPresupuesto() {
  const filas = modelo.rubros.map(r => {
    // Obra sin rubros: la lista sale corrida, sin la fila de cabecera.
    const cabecera = modelo.numeracion.sinRubros ? '' : `
      <tr class="doc-fila-rubro">
        <td class="doc-centro">${escHtml(r.numero)}</td>
        <td>${escHtml(r.nombre || '(sin nombre)')}</td>
        <td colspan="3"></td>
        <td class="doc-num">${docARS(r.subtotal)}</td>
      </tr>`;
    const lineas = r.lineas.map(l => `
      <tr>
        <td class="doc-centro doc-item">${escHtml(l.numero)}</td>
        <td>${escHtml(l.nombre)}</td>
        <td class="doc-centro">${escHtml(l.unidad)}</td>
        <td class="doc-num">${docCant(l.cantidad)}</td>
        <td class="doc-num">${docARS(l.precioUnitario)}</td>
        <td class="doc-num">${docARS(l.total)}</td>
      </tr>`).join('');
    return cabecera + lineas;
  }).join('');

  return `
    ${membrete('Detalle de la propuesta discriminada por ítem')}
    <table class="doc-tabla">
      <thead>
        <tr>
          <th style="width:13mm;">Ítem Nº</th>
          <th>Denominación</th>
          <th style="width:12mm;">Un.</th>
          <th style="width:18mm;">Cantidad</th>
          <th style="width:28mm;">Precio</th>
          <th style="width:30mm;">Importe ($)</th>
        </tr>
      </thead>
      <tbody>
        ${filas || '<tr><td colspan="6" class="doc-centro">Sin rubros cargados en el Cómputo.</td></tr>'}
        <tr class="doc-fila-total">
          <td colspan="5">Total del presupuesto</td>
          <td class="doc-num">${docARS(modelo.total)}</td>
        </tr>
      </tbody>
    </table>
    ${cierreCuadro()}`;
}

/* ===== Análisis de Precios ===== */

// Una fila de insumo. Equipos y Mano de Obra se cotizan por jornada, así que
// su "unidad" es fija (día / jornal) y no sale del catálogo; los materiales
// llevan la unidad con la que están cargados.
function filaInsumo(f, unidadFija) {
  return `
    <tr>
      <td>${escHtml(f.nombre)}</td>
      <td class="doc-centro">${escHtml(unidadFija || f.unidad || '')}</td>
      <td class="doc-num">${docCant(f.cantidad)}</td>
      <td class="doc-num">${docARS(f.costoUnitario)}</td>
      <td class="doc-num">${docARS(f.costoTotal)}</td>
    </tr>`;
}

const filaSeccionAP = txt => `<tr class="doc-fila-seccion"><td colspan="5">${escHtml(txt)}</td></tr>`;
const filaSubtotalAP = (txt, valor, fuerte) =>
  `<tr class="${fuerte ? 'doc-fila-subtotal' : ''}"><td colspan="4">${escHtml(txt)}</td><td class="doc-num">${docARS(valor)}</td></tr>`;
const filaVaciaAP = txt => `<tr><td colspan="5" class="doc-centro" style="color:#6b7280;">${escHtml(txt)}</td></tr>`;

/* `sinCarga` corta el bloque en el Subtotal (A+B+C): es lo que corresponde a un
   análisis auxiliar, cuyo resultado es un costo que después se copia a mano a
   Carga Fija. Aplicarle el K ahí sería cargarlo dos veces. */
function analisisDeLinea(linea, sinCarga) {
  const ap = window.analisisDePrecioDe(modelo, linea.itemKey);
  const meta = [
    linea.unidad ? `Unidad: ${linea.unidad}` : '',
    ap ? `Rendimiento: ${docCant(ap.rendimiento)} uds./jornada` : '',
    linea.cantidad != null ? `${sinCarga ? 'Cantidad' : 'Cantidad de cómputo'}: ${docCant(linea.cantidad)} ${linea.unidad || ''}`.trim() : '',
  ].filter(Boolean).join('  ·  ');

  const encabezado = `
    <div class="doc-ap-obra">${escHtml(modelo.obra.nombre || '')} — Análisis de precio</div>
    <div class="doc-ap-titulo"><span class="doc-ap-num">${escHtml(linea.numero)}</span>${escHtml(linea.nombre)}</div>
    <div class="doc-ap-meta">${escHtml(meta)}</div>`;

  if (!ap) {
    return `<article class="doc-ap">${encabezado}
      <table class="doc-tabla">${filaVaciaAP('Este ítem todavía no tiene un análisis de precio cargado.')}</table></article>`;
  }

  const segCap = ap.costoDiarioSeguridadCapataz > 0 ? `
    <tr>
      <td>Seguridad y Capataz</td>
      <td class="doc-centro">%</td>
      <td class="doc-num">${docCant(ap.seguridadCapatazPctAplicado)}</td>
      <td class="doc-num">—</td>
      <td class="doc-num">${docARS(ap.costoDiarioSeguridadCapataz)}</td>
    </tr>` : '';

  const importe = linea.total != null
    ? `<tr class="doc-fila-subtotal"><td colspan="4">Importe del ítem (${docCant(linea.cantidad)} ${escHtml(linea.unidad || '')} × precio unitario)</td><td class="doc-num">${docARS(linea.total)}</td></tr>`
    : '';

  // El cierre del bloque: con Carga Fija y precio unitario en un ítem del
  // presupuesto, nada más que el subtotal en un auxiliar.
  const cierre = sinCarga
    ? `<tr class="doc-fila-total"><td colspan="4">Subtotal (A+B+C)</td><td class="doc-num">${docARS(ap.costoUnitario)}</td></tr>`
    : `<tr class="doc-fila-subtotal"><td colspan="4">Subtotal (A+B+C)</td><td class="doc-num">${docARS(ap.costoUnitario)}</td></tr>
       <tr><td colspan="4">Carga Fija</td><td class="doc-num">${fmtDoc(modelo.k, 4)}</td></tr>
       <tr class="doc-fila-total"><td colspan="4">Precio unitario</td><td class="doc-num">${docARS(linea.precioUnitario)}</td></tr>
       ${importe}`;

  return `
    <article class="doc-ap">
      ${encabezado}
      <table class="doc-tabla">
        <thead>
          <tr>
            <th>Denominación</th>
            <th style="width:16mm;">Unidad</th>
            <th style="width:20mm;">Cantidad</th>
            <th style="width:30mm;">Costo unitario</th>
            <th style="width:30mm;">Costo total</th>
          </tr>
        </thead>
        <tbody>
          ${filaSeccionAP('A — Equipos')}
          ${ap.equipos.length ? ap.equipos.map(f => filaInsumo(f, 'día')).join('') : filaVaciaAP('Sin equipos.')}
          ${filaSubtotalAP('Costo diario Equipos', ap.costoDiarioEquipos)}
          ${filaSubtotalAP('Costo unitario de Equipos (A)', ap.costoUnitarioEquipos, true)}

          ${filaSeccionAP('B — Mano de obra')}
          ${ap.manoDeObra.length ? ap.manoDeObra.map(f => filaInsumo(f, 'jornal')).join('') : filaVaciaAP('Sin mano de obra.')}
          ${segCap}
          ${filaSubtotalAP('Costo diario Mano de Obra', ap.costoDiarioMO)}
          ${filaSubtotalAP('Costo unitario Mano de Obra (B)', ap.costoUnitarioMO, true)}

          ${filaSeccionAP('C — Materiales')}
          ${ap.materiales.length ? ap.materiales.map(f => filaInsumo(f)).join('') : filaVaciaAP('Sin materiales.')}
          ${filaSubtotalAP('Costo unitario de Materiales (C)', ap.costoMateriales, true)}

          ${cierre}
        </tbody>
      </table>
    </article>`;
}

function seccionAnalisisPrecios() {
  // Un AP por línea del presupuesto, en el mismo orden y con la misma
  // numeración: si dos líneas comparten el ítem, cada una lleva su análisis,
  // porque cada una es un renglón que hay que justificar.
  const lineas = modelo.rubros.flatMap(r => r.lineas);
  if (!lineas.length) {
    return `${membrete('Análisis de precios')}<p class="doc-centro">Sin ítems en el Cómputo.</p>`;
  }
  // Sin `l => `, el índice del map entraría como `sinCarga` y todos los AP
  // menos el primero saldrían cortados en el subtotal.
  return `${membrete('Análisis de precios')}${lineas.map(l => analisisDeLinea(l)).join('')}`;
}

/* Los análisis auxiliares, con el mismo bloque que un AP del presupuesto pero
   cortado en el Subtotal: no llevan Carga Fija. No son parte de la obra —no
   están en el Presupuesto, ni en el Resumen, ni en el Plan, ni en el total— así
   que la sección arranca destildada (SECCIONES_INTERNAS): se imprime cuando uno
   la pide, no se va sola en un presupuesto que va al comitente. */
function seccionAuxiliares() {
  return `${membrete('Análisis auxiliares')}${modelo.auxiliares.map(a => analisisDeLinea(a, true)).join('')}`;
}

/* ===== Amortización de equipos =====
   Interna de la empresa (SECCIONES_INTERNAS): la fórmula de cada término del
   costo diario de un equipo, término por término — la misma cuenta que
   calcDesgloseCostoEquipo y que el modal de detalle del AP (js/item.js), pero
   para todos los equipos que aparecen en algún análisis de precio de esta
   obra (window.equiposUsadosEnObra), no el catálogo global. */
function filaDesgloseDoc(label, formula, cuenta, valor) {
  return `
    <tr>
      <td>${escHtml(label)}<br><span class="doc-formula">${escHtml(formula)}</span><br><span class="doc-formula">${escHtml(cuenta)}</span></td>
      <td class="doc-num">${docARS(valor)}/día</td>
    </tr>`;
}

function bloqueEquipo(equipo, desglose) {
  const nombre = `${equipo.tipo || ''} ${equipo.codigo || ''}`.trim();
  const meta = [
    equipo.potencia ? `${docCant(equipo.potencia)} HP` : '',
    equipo.consumoCombustibleLtsPorHp != null ? `${docCant(equipo.consumoCombustibleLtsPorHp)} lts/HP·h` : '',
    equipo.usoAnual ? `${docCant(equipo.usoAnual)} hs/año` : '',
    equipo.vidaUtil ? `vida útil ${docCant(equipo.vidaUtil)} hs` : '',
    equipo.costoUSD ? `Costo actual: ${docARS(desglose ? desglose.costoActual : null)}` : '',
  ].filter(Boolean).join('  ·  ');

  if (!desglose) {
    return `
      <article class="doc-equipo">
        <div class="doc-ap-titulo">${escHtml(nombre)}</div>
        <p class="doc-centro">Faltan datos de costo para este equipo (costo, vida útil o uso anual).</p>
      </article>`;
  }

  return `
    <article class="doc-equipo">
      <div class="doc-ap-titulo">${escHtml(nombre)}</div>
      <div class="doc-ap-meta">${escHtml(meta)}</div>
      <table class="doc-tabla">
        <tbody>
          ${filaDesgloseDoc('Amortización', 'Costo actual × jornada ÷ vida útil',
            `${docARS(desglose.costoActual)} × ${docCant(modelo.paramsMO.jornadaHoras)} ÷ ${docCant(equipo.vidaUtil)}`, desglose.amortizacionDia)}
          ${filaDesgloseDoc('Intereses', 'Costo actual × tasa ÷ 2 ÷ uso anual × jornada',
            `${docARS(desglose.costoActual)} × ${docCant(modelo.paramsEquipos.tasaInteresPct)}% ÷ 2 ÷ ${docCant(equipo.usoAnual)} × ${docCant(modelo.paramsMO.jornadaHoras)}`, desglose.interesesDia)}
          ${filaDesgloseDoc('Reparaciones y Repuestos', `${docCant(modelo.paramsEquipos.reparacionesPct)}% de Amortización`,
            `${docCant(modelo.paramsEquipos.reparacionesPct)}% de ${docARS(desglose.amortizacionDia)}`, desglose.reparacionesDia)}
          ${filaDesgloseDoc('Combustibles', 'Consumo × potencia × jornada × precio',
            `${docCant(equipo.consumoCombustibleLtsPorHp)} × ${docCant(equipo.potencia)} × ${docCant(modelo.paramsMO.jornadaHoras)} × ${docARS(modelo.paramsEquipos.precioCombustibleLitro)}`, desglose.combustibleDia)}
          ${filaDesgloseDoc('Lubricantes', `${docCant(modelo.paramsEquipos.lubricantesPct)}% de Combustibles`,
            `${docCant(modelo.paramsEquipos.lubricantesPct)}% de ${docARS(desglose.combustibleDia)}`, desglose.lubricantesDia)}
          <tr class="doc-fila-total"><td>Costo diario del equipo</td><td class="doc-num">${docARS(desglose.costoDiarioTotal)}/día</td></tr>
        </tbody>
      </table>
    </article>`;
}

function seccionEquipos() {
  const usados = window.equiposUsadosEnObra(modelo);
  if (!usados.length) {
    return `${membrete('Amortización de equipos')}<p class="doc-centro">Esta obra no tiene equipos cargados en ningún análisis de precio.</p>`;
  }
  return `${membrete('Amortización de equipos')}${usados.map(u => bloqueEquipo(u.equipo, u.desglose)).join('')}`;
}

/* ===== Insumos =====
   Interna de la empresa (SECCIONES_INTERNAS): consolida para toda la obra
   qué materiales, equipos y mano de obra hacen falta, con su costo estimado
   — la misma cuenta que la pantalla Insumos (insumos-obra.html), a través
   del módulo compartido js/insumosDatos.js, para que pantalla y PDF salgan
   iguales. Sirve como base de pedido de compra/acopio, no para el
   comitente. */
// Sin desglose: una fila por insumo, con el total consolidado de toda la
// obra — para pedir compra/acopio sin entrar en de qué ítem sale cada cantidad.
function filaInsumoDocSimple(f) {
  return `
    <tr>
      <td>${escHtml(f.nombre)}</td>
      <td class="doc-centro">${escHtml(f.unidad)}</td>
      <td class="doc-num">${docCant(f.cantidad)}</td>
      <td class="doc-num">${f.costoTotal != null ? docARS(f.costoTotal) : '—'}</td>
    </tr>`;
}

// Con desglose: la fila del insumo (total) seguida de una fila por cada ítem
// en el que se usa, con la cantidad y el costo que le corresponde a ese ítem
// — mismo costoUnitario del insumo, aplicado a la porción de cada uno. Excepción:
// filas con `usadosMoneda` (la Capatacía dentro de Mano de Obra) no tienen una
// cantidad física que multiplicar por un costoUnitario — cada `usado` ya trae
// directamente el monto en pesos que aporta ese ítem.
function filaInsumoDocDesglose(f) {
  const principal = `
    <tr class="doc-fila-subtotal">
      <td>${escHtml(f.nombre)}</td>
      <td class="doc-centro">${escHtml(f.unidad)}</td>
      <td class="doc-num">${docCant(f.cantidad)}</td>
      <td class="doc-num">${f.costoTotal != null ? docARS(f.costoTotal) : '—'}</td>
    </tr>`;
  const usos = f.usados.map(u => `
    <tr class="doc-fila-sub">
      <td>${escHtml(u.nombre)}</td>
      <td></td>
      <td class="doc-num">${f.usadosMoneda ? '—' : docCant(u.cantidad)}</td>
      <td class="doc-num">${f.usadosMoneda ? docARS(u.cantidad) : (f.costoUnitario != null ? docARS(f.costoUnitario * u.cantidad) : '—')}</td>
    </tr>`).join('');
  return principal + usos;
}

function tablaInsumos(titulo, colCantidad, resultado, vacio, avisoSinPrecio) {
  if (!resultado.filas.length) {
    return `<h3 class="doc-grafico-titulo">${escHtml(titulo)}</h3><p class="doc-centro">${escHtml(vacio)}</p>`;
  }
  const filaFn = config.insumosDesglose ? filaInsumoDocDesglose : filaInsumoDocSimple;
  return `
    <h3 class="doc-grafico-titulo">${escHtml(titulo)}</h3>
    <table class="doc-tabla">
      <thead>
        <tr>
          <th>Denominación</th>
          <th style="width:16mm;">Unidad</th>
          <th style="width:24mm;">${escHtml(colCantidad)}</th>
          <th style="width:30mm;">Costo estimado</th>
        </tr>
      </thead>
      <tbody>
        ${resultado.filas.map(filaFn).join('')}
        <tr class="doc-fila-total"><td colspan="3">Total estimado</td><td class="doc-num">${docARS(resultado.costoTotal)}</td></tr>
      </tbody>
    </table>
    ${resultado.faltaPrecio ? `<p class="doc-notas">${escHtml(avisoSinPrecio)}</p>` : ''}`;
}

function seccionInsumos() {
  const insumos = window.calcularInsumosObra(modelo);
  return `
    ${membrete('Insumos de la obra')}
    ${tablaInsumos('Materiales necesarios', 'Cantidad necesaria', insumos.materiales,
      'Sin materiales para mostrar.',
      'Algunos materiales no tienen precio cargado para esta obra — no se incluyen en el total estimado.')}
    ${tablaInsumos('Equipos necesarios', 'Días de uso', insumos.equipos,
      'Sin equipos para mostrar.',
      'Algunos equipos no tienen costo calculable en esta obra — no se incluyen en el total estimado.')}
    ${tablaInsumos('Mano de obra necesaria', 'Días necesarios', insumos.manoDeObra,
      'Sin mano de obra para mostrar.',
      'Algunas categorías no tienen básico cargado en esta obra — no se incluyen en el total estimado.')}`;
}

/* ===== Plan de trabajos y curva de inversión ===== */

// El plan se calcula con la misma función que la pantalla Plan de Avance
// (js/planAvanceDatos.js), sobre los precios que ya trae el modelo del
// presupuesto. `plan` queda en null si la obra todavía no cargó nada.
let plan = null;
let planConfig = null;

function etiquetaPeriodoDoc(i) {
  const d = window.fechaPeriodoPlan(planConfig, i);
  const fecha = d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : '';
  return { nro: `${i + 1}°`, fecha };
}

// Celda de la grilla del cronograma: el 0 va vacío (una tabla de 13 columnas
// llena de "0,00%" no se lee) y los enteros van sin decimales — lo que se
// carga son valores como 20% o 12,5%.
const pctDoc = frac => (!frac ? '' : Number(frac * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + '%');
const cantDoc = n => (!n ? '' : docCant(n));
const montoDoc = n => (!n ? '' : docARS(n));

const unidadPlural = () => (window.nombreUnidadPlan(planConfig) === 'Mes' ? 'meses' : 'semanas');

// Las filas "% en Obra" / "Cantidad" / "Monto" de cada ítem son opt-in en la
// pantalla Plan de Avance (checkboxes pa-ver-obra/pa-ver-cant/pa-ver-monto en
// js/plan-avance.js) y se guardan como preferencia del navegador, no de la
// obra. Se lee la misma key para que lo que quedó tildado en pantalla salga
// igual en el PDF.
function verFilasPlanExport() {
  try { return JSON.parse(localStorage.getItem('vimeco-plan-avance-ver') || '{}') || {}; } catch (_) { return {}; }
}
const verFilasPlan = verFilasPlanExport();

// Un bloque del cronograma: las columnas fijas + los períodos [desde, hasta).
// `ajustar` es el modo "Ajustar a una hoja": un solo bloque con todos los
// períodos, en su ancho natural (sin repartir el ancho fijo de la hoja entre
// columnas cada vez más angostas) — después ajustarPlanAUnaHoja() lo achica
// entero con zoom para que entre en una sola página.
function bloquePlanTrabajos(desde, hasta, ajustar) {
  const ths = [];
  for (let i = desde; i < hasta; i++) {
    const { nro, fecha } = etiquetaPeriodoDoc(i);
    const w = ajustar ? ' style="width:15mm;"' : '';
    ths.push(`<th class="doc-plan-periodo"${w}>${nro}${fecha ? `<span class="doc-plan-fecha">${fecha}</span>` : ''}</th>`);
  }

  const filas = plan.gruposRubro.map(g => {
    const celdasRubro = [];
    for (let i = desde; i < hasta; i++) celdasRubro.push(`<td class="doc-num">${pctDoc(g.pctObra[i])}</td>`);
    // Obra sin rubros: el cronograma sale sólo con ítems, como el presupuesto.
    const filaRubro = modelo.numeracion.sinRubros ? '' : `
      <tr class="doc-fila-rubro">
        <td class="doc-centro">${escHtml(g.numero)}</td>
        <td>${escHtml(g.rubro.nombre || '(sin nombre)')}</td>
        <td colspan="2"></td>
        <td class="doc-num">${docARS(g.precioTotal)}</td>
        <td class="doc-num">${docPct(g.incidencia)}</td>
        <td></td>
        ${celdasRubro.join('')}
      </tr>`;

    // Cada ítem ocupa un solo bloque de filas, como en la planilla: los datos
    // fijos (nº, designación, unidad, cantidad, precio, incid.) se escriben
    // una sola vez con rowspan y "% en Item" — lo único que se carga a mano —
    // sale resaltado arriba; debajo, sólo las filas opt-in que estén tildadas
    // en pantalla (checkboxes pa-ver-obra/cant/monto), sin repetir los datos.
    const filasItems = g.lineas.map(x => {
      const celdasItem = [];
      for (let i = desde; i < hasta; i++) celdasItem.push(`<td class="doc-num doc-pctitem-num">${pctDoc(x.pctItem[i])}</td>`);

      const subFilas = [];
      if (verFilasPlan.obra) subFilas.push(['% en Obra', i => pctDoc(x.pctObra[i])]);
      if (verFilasPlan.cant) subFilas.push(['Cantidad', i => cantDoc(x.pctCant[i])]);
      if (verFilasPlan.monto) subFilas.push(['Monto', i => montoDoc(x.pctMonto[i])]);
      const rs = subFilas.length ? ` rowspan="${1 + subFilas.length}"` : '';

      const principal = `
        <tr class="doc-fila-pctitem">
          <td class="doc-centro doc-item"${rs}>${escHtml(x.numero)}</td>
          <td${rs}>${escHtml(x.linea.nombre || '')}</td>
          <td class="doc-centro"${rs}>${escHtml(x.linea.unidad || '')}</td>
          <td class="doc-num"${rs}>${docCant(x.cantidad)}</td>
          <td class="doc-num"${rs}>${docARS(x.precioTotal)}</td>
          <td class="doc-num"${rs}>${docPct(x.incidencia)}</td>
          <td class="doc-centro doc-fila-label">% en Item</td>
          ${celdasItem.join('')}
        </tr>`;

      const extra = subFilas.map(([label, valorDe]) => {
        const c = [];
        for (let i = desde; i < hasta; i++) c.push(`<td class="doc-num">${valorDe(i)}</td>`);
        return `<tr class="doc-fila-sub"><td class="doc-centro doc-fila-label">${escHtml(label)}</td>${c.join('')}</tr>`;
      }).join('');

      return principal + extra;
    }).join('');

    return filaRubro + filasItems;
  }).join('');

  const filaPie = (label, valores, formato, clase) => {
    const celdas = [];
    for (let i = desde; i < hasta; i++) celdas.push(`<td class="doc-num">${formato(valores[i])}</td>`);
    return `<tr class="${clase || ''}"><td colspan="7">${escHtml(label)}</td>${celdas.join('')}</tr>`;
  };

  // Total y anticipo, en las mismas columnas Precio/Incid. que cada ítem —
  // así se ve de un vistazo, antes de bajar a las certificaciones, contra qué
  // monto se está certificando (el total de la obra, no el neto a certificar).
  const nPeriodos = hasta - desde;
  const filaTotalPrecio = `
    <tr class="doc-fila-total">
      <td colspan="4">Total del presupuesto</td>
      <td class="doc-num">${docARS(plan.total)}</td>
      <td class="doc-num">${docPct(1)}</td>
      <td colspan="${nPeriodos + 1}"></td>
    </tr>`;
  const filaAnticipo = `
    <tr class="doc-fila-subtotal">
      <td colspan="4">Anticipo financiero (${docPct(plan.anticipoFrac)})</td>
      <td class="doc-num">${docARS(plan.anticipoMonto)}</td>
      <td colspan="${nPeriodos + 2}"></td>
    </tr>`;

  return `
    <table class="doc-tabla doc-tabla-plan${ajustar ? ' doc-tabla-plan-ajustar' : ''}">
      <thead>
        <tr>
          <th style="width:11mm;">Ítem</th>
          <th>Designación</th>
          <th style="width:11mm;">Un.</th>
          <th style="width:16mm;">Cant.</th>
          <th style="width:28mm;">Precio</th>
          <th style="width:14mm;">Incid.</th>
          <th style="width:14mm;"></th>
          ${ths.join('')}
        </tr>
      </thead>
      <tbody>
        ${filas || '<tr><td colspan="7" class="doc-centro">Sin ítems en el Cómputo.</td></tr>'}
        ${filaTotalPrecio}
        ${filaAnticipo}
        ${filaPie('Certificación parcial %', plan.parcialPct, v => docPct(v), 'doc-fila-subtotal')}
        ${filaPie('Certificación acumulada %', plan.acumPct, v => docPct(v), 'doc-fila-subtotal')}
        ${filaPie('Certificación parcial $', plan.parcialMonto, v => docARS(v), 'doc-fila-subtotal doc-fila-monto')}
        ${filaPie('Certificación acumulada $', plan.acumMonto, v => docARS(v), 'doc-fila-total doc-fila-monto')}
        ${filaPie('Remanente $', plan.remanenteMonto, v => docARS(v), 'doc-fila-subtotal doc-fila-monto')}
        ${filaPie('Remanente %', plan.remanentePct, v => docPct(v), 'doc-fila-subtotal')}
      </tbody>
    </table>`;
}

// Una obra sin plan cargado igual arma un `plan` (12 semanas vacías, el
// default): lo que dice que no hay nada que imprimir es que no se planificó
// ni un punto de avance.
const hayPlanCargado = () => !!plan && plan.acumPct.some(v => v > 0);

function seccionPlanTrabajos() {
  if (!hayPlanCargado()) return `${membrete('Plan de trabajos')}<p class="doc-centro">Esta obra todavía no tiene plan de avance cargado.</p>`;
  const unidad = window.nombreUnidadPlan(planConfig).toLowerCase();
  const ajustar = !!config.hojaPlanAjustar;
  const porHoja = ajustar ? plan.n : periodosPorHoja();
  const bloques = [];
  for (let desde = 0; desde < plan.n; desde += porHoja) {
    const hasta = Math.min(desde + porHoja, plan.n);
    const rotulo = plan.n > porHoja
      ? `<p class="doc-plan-rango">${escHtml(unidadPlural().replace(/^./, c => c.toUpperCase()))} ${desde + 1} a ${hasta}</p>`
      : '';
    bloques.push(`<div class="doc-plan-bloque">${rotulo}${bloquePlanTrabajos(desde, hasta, ajustar)}</div>`);
  }
  return `
    ${membrete('Plan de trabajos — cronograma de avance e inversiones')}
    <p class="doc-subtitulo">Avance planificado por ${unidad}, expresado como porcentaje de cada ítem.</p>
    ${bloques.join('')}`;
}

function seccionCurvas() {
  if (!hayPlanCargado()) return `${membrete('Curva de inversión')}<p class="doc-centro">Esta obra todavía no tiene plan de avance cargado.</p>`;
  const unidad = window.nombreUnidadPlan(planConfig);
  const ultimoAcum = plan.acumPct.length ? plan.acumPct[plan.acumPct.length - 1] : 0;

  const filas = [];
  for (let i = 0; i < plan.n; i++) {
    const { nro, fecha } = etiquetaPeriodoDoc(i);
    filas.push(`
      <tr>
        <td class="doc-centro">${nro}${fecha ? ` (${fecha})` : ''}</td>
        <td class="doc-num">${docPct(plan.parcialPct[i])}</td>
        <td class="doc-num">${docPct(plan.acumPct[i])}</td>
        <td class="doc-num">${docARS(plan.parcialMonto[i])}</td>
        <td class="doc-num">${docARS(plan.acumMonto[i])}</td>
        <td class="doc-num">${docARS(plan.remanenteMonto[i])}</td>
      </tr>`);
  }

  return `
    ${membrete('Curva de inversión')}
    <table class="doc-tabla doc-tabla-datos">
      <tbody>
        <tr><td>Total del presupuesto</td><td class="doc-num">${docARS(plan.total)}</td>
            <td>Anticipo financiero (${docPct(plan.anticipoFrac)})</td><td class="doc-num">${docARS(plan.anticipoMonto)}</td></tr>
        <tr><td>A certificar</td><td class="doc-num">${docARS(plan.total - plan.anticipoMonto)}</td>
            <td>Plazo de obra</td><td class="doc-num">${plan.n} ${escHtml(plan.n === 1 ? unidad.toLowerCase() : unidadPlural())}</td></tr>
        <tr><td>Avance planificado</td><td class="doc-num">${docPct(ultimoAcum)}</td>
            <td colspan="2"></td></tr>
      </tbody>
    </table>

    <h3 class="doc-grafico-titulo">Plan de avance — acumulado y remanente</h3>
    <div class="doc-grafico">${window.svgPlanAvance(plan, { unidad })}</div>

    <h3 class="doc-grafico-titulo">Curva de inversión — acumulado y remanente</h3>
    <div class="doc-grafico">${window.svgCurvaInversion(plan, { unidad, fmtMonto: docARS })}</div>

    <h3 class="doc-grafico-titulo">Certificación por ${escHtml(unidad.toLowerCase())}</h3>
    <div class="doc-grafico">${window.svgCertificacionPorPeriodo(plan, { unidad, fmtMonto: docARS })}</div>

    <h3 class="doc-grafico-titulo">Certificaciones por período</h3>
    <table class="doc-tabla">
      <thead>
        <tr>
          <th>${escHtml(unidad)}</th>
          <th style="width:22mm;">Parcial %</th>
          <th style="width:22mm;">Acum. %</th>
          <th style="width:32mm;">Parcial $</th>
          <th style="width:32mm;">Acumulado $</th>
          <th style="width:32mm;">Remanente $</th>
        </tr>
      </thead>
      <tbody>${filas.join('')}</tbody>
    </table>`;
}

/* ===== Carga Fija ===== */

// En papel el coeficiente se llama "Carga Fija" (nunca "K") y sale solo: ni
// los conceptos que lo componen (alquileres, sueldos, seguros…), ni el total
// de gastos fijos, ni el costo del Cómputo sobre el que se prorratean. Todo
// eso es interno de la empresa. Por eso el cuadro arranca de un costo
// unitario 1: muestra cómo se compone el coeficiente, no sobre qué monto se
// aplica.
function seccionCargaFija() {
  const r = modelo.kDesglose;

  const filaK = (label, pct, aporte, clase) => `
    <tr class="${clase || ''}">
      <td>${escHtml(label)}</td>
      <td class="doc-num">${pct == null ? '' : docCant(pct) + '%'}</td>
      <td class="doc-num">${aporte == null ? '' : fmtDoc(aporte, 4)}</td>
    </tr>`;

  const bloqueK = r.ggFrac == null
    ? '<p class="doc-centro">Sin ítems en el Cómputo: no hay costo sobre el cual prorratear los gastos fijos.</p>'
    : `
      <table class="doc-tabla">
        <thead>
          <tr><th>Concepto</th><th style="width:26mm;">%</th><th style="width:30mm;">Aporte</th></tr>
        </thead>
        <tbody>
          ${filaK('Costo', null, 1)}
          ${filaK('Gastos Generales', r.ggFrac * 100, r.ggFrac)}
          ${filaK('Beneficio', r.beneficioFrac * 100, r.beneficioFrac)}
          ${filaK('Subtotal costo', null, r.subtotalCosto, 'doc-fila-subtotal')}
          ${filaK('Costo financiero', r.costoFinancieroFrac * 100, r.aporteFinanciero)}
          ${filaK('Subtotal con gasto financiero', null, r.subtotalConFinanciero, 'doc-fila-subtotal')}
          ${r.impuestos.map(i => filaK(i.nombre || 'Impuesto', i.porcentaje, r.aportePorImpuesto[i.key])).join('')}
          ${filaK('Impuestos', null, r.impuestoFrac, 'doc-fila-subtotal')}
          <tr class="doc-fila-total">
            <td colspan="2">Carga Fija</td>
            <td class="doc-num">${fmtDoc(r.k, 4)}</td>
          </tr>
        </tbody>
      </table>`;

  return `
    ${membrete('Carga Fija')}
    ${bloqueK}
    <p class="doc-notas">La Carga Fija se aplica al costo unitario de cada ítem para obtener su precio unitario. Cada impuesto se calcula sobre el subtotal con gasto financiero.</p>`;
}

/* Gastos fijos de la obra: el desglose concepto por concepto, con montos.

   Es la contracara de la sección "Carga Fija", que a propósito sale sin un peso
   (ver arriba): esto es interno de la empresa y por eso la sección arranca
   destildada. Se imprime cuando hace falta tener el detalle en papel.

   Los mismos números y el mismo orden que la pantalla de Carga Fija: el total
   de cada concepto viene resuelto en el modelo (cargaFija.totalPorLinea, que
   arma calcCargaFija) y el orden de lineasCargaFijaOrdenadas(). Acá no se
   recalcula nada — y no se podría: los conceptos calculados sobre el
   presupuesto propio necesitan el K, que sale del mismo despeje. */

const BASE_PCT_DOC = {
  pctComputo: 'del Costo del Cómputo',
  pctPrecioSinIva: 'del Presupuesto s/IVA',
  pctPrecioConIva: 'del Presupuesto c/IVA',
  pctOficial: 'del Presupuesto oficial',
};

function seccionGastosFijos() {
  const cf = modelo.cargaFija;
  const total = cf.gastosFijos;
  const conceptos = window.lineasCargaFijaOrdenadas(cf.lineas);

  const filas = conceptos.map(([key, l]) => {
    const tipo = l.tipo || 'monto';
    const esPct = window.tipoCargaFijaEsPorcentaje(tipo);
    const t = cf.totalPorLinea[key];
    return `
      <tr>
        <td>${escHtml(l.concepto || '(sin nombre)')}</td>
        <td class="doc-num">${esPct ? '' : docCant(l.cantidad)}</td>
        <td class="doc-num">${esPct ? '' : docARS(l.precioUnitario)}</td>
        <td class="doc-num">${esPct ? '' : docCant(l.meses)}</td>
        <td class="doc-num">${esPct ? docCant(l.porcentaje) + '%' : ''}</td>
        <td>${esPct ? escHtml(BASE_PCT_DOC[tipo]) : ''}</td>
        <td class="doc-num">${t == null ? '—' : docARS(t)}</td>
        <td class="doc-num">${total > 0 && t != null ? docPct(t / total) : '—'}</td>
      </tr>`;
  }).join('');

  // Datos de arriba: los mismos que encabezan la hoja "Carga fija" del Excel.
  // El presupuesto oficial sólo aparece si la obra lo tiene cargado.
  const datos = [
    ['Duración de la obra', cf.config.duracionMeses != null
      ? `${docCant(cf.config.duracionMeses)} ${cf.config.duracionMeses === 1 ? 'mes' : 'meses'}` : '—'],
    ['Costo del Cómputo', docARS(modelo.costoComputo)],
  ];
  if (modelo.obra.presupuestoOficial != null) {
    datos.push(['Presupuesto oficial', docARS(modelo.obra.presupuestoOficial)]);
  }
  // Las dos bases de presupuesto propio sólo se imprimen si algún concepto se
  // calcula sobre ellas: son la referencia para poder controlar ese monto.
  if (conceptos.some(([, l]) => window.tipoCargaFijaEsSobrePrecio(l.tipo)) && cf.precioConIva != null) {
    datos.push(['Presupuesto s/IVA', docARS(cf.precioSinIva)]);
    datos.push(['Presupuesto c/IVA', docARS(cf.precioConIva)]);
  }

  const gg = modelo.kDesglose;
  const notaGG = gg.ggFracCalculado == null
    ? 'Sin ítems en el Cómputo: no hay costo sobre el cual prorratear los gastos fijos.'
    : `% de Gastos Generales = total de gastos fijos / costo del Cómputo = ${docPct(gg.ggFracCalculado)}`
      + (gg.ggEsManual ? ` — se está usando ${docPct(gg.ggFrac)}, cargado a mano.` : '.');

  return `
    ${membrete('Gastos fijos de la obra')}
    <dl class="doc-membrete-datos doc-datos-sueltos">
      ${datos.map(([k, v]) => `<dt>${escHtml(k)}:</dt><dd>${v}</dd>`).join('')}
    </dl>
    <table class="doc-tabla">
      <thead>
        <tr>
          <th>Concepto</th>
          <th style="width:16mm;">Cant.</th>
          <th style="width:26mm;">Precio unit.</th>
          <th style="width:14mm;">Meses</th>
          <th style="width:16mm;">%</th>
          <th style="width:34mm;">Base</th>
          <th style="width:30mm;">Total</th>
          <th style="width:17mm;">Incid.</th>
        </tr>
      </thead>
      <tbody>
        ${filas || '<tr><td colspan="8" class="doc-centro">Esta obra todavía no tiene conceptos de gastos fijos cargados.</td></tr>'}
        <tr class="doc-fila-total">
          <td colspan="6">Total gastos fijos</td>
          <td class="doc-num">${docARS(total)}</td>
          <td class="doc-num">${total > 0 ? '100,00%' : '—'}</td>
        </tr>
      </tbody>
    </table>
    <p class="doc-notas">${escHtml(notaGG)}</p>`;
}

/* ===== Render ===== */

function renderDocumento() {
  const doc = $('doc');
  if (modelo.k == null) {
    doc.innerHTML = '<p style="padding:2rem;text-align:center;color:#6b7280;">Esta obra todavía no tiene ítems cargados en el Cómputo: no hay presupuesto que exportar.</p>';
    $('btn-imprimir').disabled = true;
    $('btn-excel').disabled = true;
    $('export-aviso').textContent = 'Cargá el Cómputo de la obra para poder exportar.';
    return;
  }
  $('btn-imprimir').disabled = false;
  $('btn-excel').disabled = false;
  $('export-aviso').textContent = 'En el diálogo de impresión: A4, márgenes por defecto y "Gráficos de fondo" activado.';
  doc.innerHTML = seccionesDisponibles()
    .map(s => {
      const clases = ['doc-seccion'];
      if (s.apaisada) {
        const orientCorta = hojaPlanOrientacionElegida() === 'vertical' ? 'v' : 'h';
        clases.push('doc-seccion-apaisada', `doc-seccion-hoja-${hojaPlanElegida().toLowerCase()}-${orientCorta}`);
        if (s.id === 'plan' && config.hojaPlanAjustar) clases.push('doc-plan-ajustar');
      }
      if (!incluidas[s.id]) clases.push('oculta');
      return `<section class="${clases.join(' ')}" data-seccion="${s.id}">${incluidas[s.id] ? s.render() : ''}</section>`;
    })
    .join('');
  ajustarPlanAUnaHoja();
}

// "Ajustar a una hoja": el cronograma se armó (seccionPlanTrabajos) como un
// único bloque con todos los períodos, en su ancho natural — más ancho y más
// alto que la hoja elegida si hay muchos ítems o períodos. Acá se mide ese
// bloque ya renderizado y se lo achica entero con `zoom` (a diferencia de
// `transform: scale`, sí reduce el lugar que ocupa en el flujo/paginado) hasta
// que entra en el área útil de la hoja, sin agrandar si ya entraba justo.
//
// Lo que más suele mandar el achique es el alto (se acumulan filas por cada
// ítem, no por cada período): un `zoom` es un único factor para las dos
// direcciones, así que si se aplica el que pide el alto, el ancho queda
// escalado de más y sobra hoja en blanco a la derecha. Por eso, cuando el
// alto es lo que manda, antes de aplicar el zoom se les da a las columnas de
// período el ancho extra necesario para que, ya achicadas, terminen ocupando
// todo el ancho de la hoja en vez de quedar angostas en el medio.
function ajustarPlanAUnaHoja() {
  const PX_POR_MM = 96 / 25.4;   // conversión física fija de CSS, no depende del DPI de pantalla
  const ANCHO_PERIODO_MIN_MM = 15;
  // Colchón contra redondeos entre esta medición en pantalla y la paginación
  // real de Chrome al imprimir — sin esto, un plan que mide justo-justo puede
  // igual desbordar dos o tres filas del pie a una segunda hoja.
  const MARGEN_SEGURIDAD_MM = 6;
  const seccion = document.querySelector('.doc-seccion[data-seccion="plan"]');
  if (!seccion || !incluidas.plan || !config.hojaPlanAjustar) return;
  const bloque = seccion.querySelector('.doc-plan-bloque');
  if (!bloque) return;

  bloque.style.zoom = 1;
  const periodoThs = Array.from(bloque.querySelectorAll('.doc-plan-periodo'));
  periodoThs.forEach(th => { th.style.width = ANCHO_PERIODO_MIN_MM + 'mm'; });

  const dims = dimsHojaPlan();
  const anchoDisponiblePx = (dims.anchoUtilMm - MARGEN_SEGURIDAD_MM) * PX_POR_MM;
  // La altura ya ocupada por el membrete/título/subtítulo antes de la tabla:
  // se mide la posición real del bloque (getBoundingClientRect), no la suma
  // de offsetHeight de sus hermanos — offsetHeight no incluye los márgenes
  // entre ellos, y esa diferencia es justamente lo que sobraba en el pie.
  const altoPreviosPx = bloque.getBoundingClientRect().top - seccion.getBoundingClientRect().top;
  const altoDisponiblePx = (dims.altoUtilMm - MARGEN_SEGURIDAD_MM) * PX_POR_MM - altoPreviosPx;

  const escalaXBase = anchoDisponiblePx / bloque.scrollWidth;
  const escalaYBase = altoDisponiblePx / bloque.scrollHeight;

  if (periodoThs.length && escalaYBase > 0 && escalaYBase < escalaXBase) {
    // El alto manda: el ancho natural (con columnas al mínimo) alcanzaría
    // para un zoom mayor a escalaYBase, así que sobra ancho. Se reparte esa
    // diferencia entre las columnas de período para que, con el zoom final
    // (que va a ser escalaYBase), el ancho termine llenando la hoja.
    const anchoObjetivoPx = anchoDisponiblePx / escalaYBase;
    const incrementoPx = Math.max(0, anchoObjetivoPx - bloque.scrollWidth);
    const incrementoPorColumnaMm = (incrementoPx / periodoThs.length) / PX_POR_MM;
    periodoThs.forEach(th => { th.style.width = (ANCHO_PERIODO_MIN_MM + incrementoPorColumnaMm) + 'mm'; });
  }

  const escalaX = anchoDisponiblePx / bloque.scrollWidth;
  const escalaY = altoDisponiblePx / bloque.scrollHeight;
  let escala = Math.min(1, escalaX, escalaY);
  if (escala < 1) escala *= 0.97;   // colchón extra: en tablas largas el redondeo fila a fila se acumula
  bloque.style.zoom = escala > 0 && isFinite(escala) ? escala : 1;
}

// El Plan de trabajos es la única sección con hoja elegible: al lado de su
// checkbox (y sólo si está tildado) van, discretos, el tamaño de hoja
// (A4/A3/A2), la orientación y el ajuste a una sola hoja — no tiene sentido
// mostrarlos si la sección no va en el documento.
function controlesHojaPlan() {
  const tam = hojaPlanElegida();
  const orient = hojaPlanOrientacionElegida();
  const botonesTam = Object.keys(HOJA_TAMANOS).map(t =>
    `<button type="button" class="hoja-btn hoja-tam-btn${t === tam ? ' active' : ''}" data-tam="${t}">${t}</button>`
  ).join('');
  const botonesOrient = [['horizontal', '↔', 'Horizontal (apaisada)'], ['vertical', '↕', 'Vertical']].map(([v, icono, titulo]) =>
    `<button type="button" class="hoja-btn hoja-orient-btn${v === orient ? ' active' : ''}" data-orientacion="${v}" title="${titulo}">${icono}</button>`
  ).join('');
  return `
    <span class="exportar-hoja" title="Tamaño y orientación de hoja del cronograma">
      <span class="hoja-segmented">${botonesTam}</span>
      <span class="hoja-segmented">${botonesOrient}</span>
      <button type="button" class="hoja-ajustar-btn${config.hojaPlanAjustar ? ' active' : ''}" title="Ajustar todo a una sola hoja, achicando proporcionalmente">⤢ 1 hoja</button>
    </span>`;
}

// Al lado del checkbox de Insumos (y sólo si está tildado) va el nivel de
// detalle: sin desglose (una fila por insumo, total de la obra) o con
// desglose (esa fila más una por cada ítem en el que se usa).
function controlesInsumos() {
  const desglose = !!config.insumosDesglose;
  const botones = [[false, 'Sin desglose'], [true, 'Con desglose']].map(([v, label]) =>
    `<button type="button" class="hoja-btn insumos-desglose-btn${desglose === v ? ' active' : ''}" data-desglose="${v}">${label}</button>`
  ).join('');
  return `
    <span class="exportar-hoja" title="Nivel de detalle de la tabla de insumos">
      <span class="hoja-segmented">${botones}</span>
    </span>`;
}

function renderSecciones() {
  $('exportar-secciones').innerHTML = seccionesDisponibles().map(s => `
    <span class="exportar-item">
      <label class="exportar-check">
        <input type="checkbox" data-seccion="${s.id}" ${incluidas[s.id] ? 'checked' : ''}>
        <span>${escHtml(s.label)}</span>
      </label>
      ${s.id === 'plan' && incluidas[s.id] ? controlesHojaPlan() : ''}
      ${s.id === 'insumos' && incluidas[s.id] ? controlesInsumos() : ''}
    </span>`).join('');

  $('exportar-secciones').querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      incluidas[chk.dataset.seccion] = chk.checked;
      renderSecciones();
      renderDocumento();
    });
  });

  $('exportar-secciones').querySelectorAll('.hoja-tam-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tam === config.hojaPlan) return;
      config.hojaPlan = btn.dataset.tam;
      renderSecciones();
      renderDocumento();
      persistConfig({ hojaPlan: config.hojaPlan });
    });
  });

  $('exportar-secciones').querySelectorAll('.hoja-orient-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.orientacion === hojaPlanOrientacionElegida()) return;
      config.hojaPlanOrientacion = btn.dataset.orientacion;
      renderSecciones();
      renderDocumento();
      persistConfig({ hojaPlanOrientacion: config.hojaPlanOrientacion });
    });
  });

  const btnAjustar = $('exportar-secciones').querySelector('.hoja-ajustar-btn');
  if (btnAjustar) {
    btnAjustar.addEventListener('click', () => {
      config.hojaPlanAjustar = !config.hojaPlanAjustar;
      renderSecciones();
      renderDocumento();
      persistConfig({ hojaPlanAjustar: config.hojaPlanAjustar });
    });
  }

  $('exportar-secciones').querySelectorAll('.insumos-desglose-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.desglose === 'true';
      if (val === !!config.insumosDesglose) return;
      config.insumosDesglose = val;
      renderSecciones();
      renderDocumento();
      persistConfig({ insumosDesglose: val });
    });
  });
}

/* ===== Configuración del documento (se guarda en la obra) ===== */

async function persistConfig(cambios) {
  try {
    await _fbPatch(`/obras/${obraKey}/export.json`, cambios);
  } catch (_) {
    showToast('Error al guardar el dato del documento.', 'error');
  }
}

function engancharConfig() {
  const notas = $('export-notas');
  notas.value = config.notas != null ? config.notas : NOTAS_DEFAULT;

  function guardar(el, campo, transformar) {
    el.addEventListener('blur', () => {
      const valor = transformar ? transformar(el.value) : el.value;
      if (valor === config[campo]) return;
      config[campo] = valor;
      renderDocumento();
      persistConfig({ [campo]: valor });
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && el.tagName !== 'TEXTAREA') el.blur(); });
  }

  guardar(notas, 'notas');
}

/* ===== Carga ===== */

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [m, exportData, planData] = await Promise.all([
    window.cargarPresupuestoObra(obraKey),
    _fbGet(`/obras/${obraKey}/export.json`),
    window.cargarPlanAvanceObra(obraKey),
  ]);
  if (!m) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  modelo = m;
  planConfig = planData.config;
  if (modelo.k != null) {
    plan = window.calcPlanAvance(
      window.gruposRubroDesdePresupuesto(modelo), planConfig, planData.distItems, planData.distRubros);
  }
  config = { notas: null, hojaPlan: 'A3', hojaPlanOrientacion: 'horizontal', hojaPlanAjustar: false, insumosDesglose: false, ...(exportData || {}) };
  SECCIONES.forEach(s => { incluidas[s.id] = !SECCIONES_INTERNAS.includes(s.id); });

  $('header-obra-nombre').textContent = 'Exportar — ' + modelo.obra.nombre;
  renderHeaderTabs(obraKey, 'exportar');
  renderSecciones();
  engancharConfig();
  renderDocumento();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

/* ===== Excel =====
   El libro lo arma js/excelExport.js, que carga ExcelJS (~950 kb) recién al
   apretar el botón: es la única pantalla que lo necesita y no tiene por qué
   pesar en la carga de la app. Acá sólo se junta el contexto — los mismos
   datos que alimentan el documento imprimible. */

function contextoExcel() {
  return {
    modelo, plan, planConfig,
    membrete: filasMembrete(),
    titulo: 'Cómputo y presupuesto',
    notas: config.notas != null ? config.notas : NOTAS_DEFAULT,
    totalEnLetras: importeEnLetras(modelo.total),
  };
}

async function descargarExcel() {
  const btn = $('btn-excel');
  const texto = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generando…';
  try {
    await window.descargarExcelObra(contextoExcel());
    showToast('Excel generado.');
  } catch (e) {
    console.error(e);
    showToast('No se pudo generar el Excel.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = texto;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-imprimir').addEventListener('click', () => window.print());
  $('btn-excel').addEventListener('click', descargarExcel);
  await loadAll();
  await getDolarSnapshot().catch(() => {});
});
