/* VIMECO S.A. — Sistema de Gestión — Exportación a Excel (.xlsx)

   Arma el libro completo de la obra con ExcelJS y lo baja al disco. No es un
   volcado de valores: cada hoja lleva las fórmulas que la planilla de la
   empresa siempre tuvo, encadenadas entre hojas (Datos → Materiales/Equipos →
   A.P → CyP → Resumen → Plan de trabajos), así el archivo sigue siendo una
   planilla viva: se cambia un precio de material y se recalcula todo el
   presupuesto adentro de Excel.

   Los números de partida salen del mismo modelo que la pantalla Presupuesto y
   el PDF (js/presupuestoDatos.js): acá no se recalcula nada por fuera de
   js/calcCostos.js. Las fórmulas que se escriben son la traducción a Excel de
   esas mismas cuentas, término por término y en el mismo orden, para que el
   resultado no se corra ni en el último decimal.

   ExcelJS pesa ~950 kb y sólo hace falta cuando alguien aprieta el botón, así
   que se carga bajo demanda desde js/vendor/ (nada de CDN: la app es una PWA
   estática y todo se sirve del propio repo).

   Formato tomado de la planilla de referencia (CyP Taller Río Cuarto.xlsx). */

(function () {

  /* ===== Carga bajo demanda de ExcelJS ===== */

  const VENDOR_SRC = 'js/vendor/exceljs.min.js';
  let cargaEnCurso = null;

  function cargarExcelJS() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (cargaEnCurso) return cargaEnCurso;
    cargaEnCurso = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = VENDOR_SRC;
      s.onload = () => (window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('ExcelJS no quedó disponible')));
      s.onerror = () => { cargaEnCurso = null; reject(new Error('No se pudo cargar ExcelJS')); };
      document.head.appendChild(s);
    });
    return cargaEnCurso;
  }

  /* ===== Curvas (Plan de avance / Curva de inversión) =====
     ExcelJS no arma gráficos nativos de Excel, sólo puede pegar una imagen
     (como ya hace con el logo, ver más abajo) — así que se pega el mismo SVG
     que ya dibuja el PDF (window.svgPlanAvance/svgCurvaInversion, en
     js/planAvanceDatos.js), rasterizado a PNG. No queda "viva" como el resto
     del libro.

     El SVG no lleva estilos inline: los rótulos (.pa-svg-tick/label/valor)
     los pinta css/print.css, que no llega hasta acá porque el SVG se carga
     solo, como imagen de <canvas>, sin el resto de la página. Se le inyecta
     una copia mínima de esas mismas reglas antes de rasterizar — si se
     retocan los estilos de la curva en print.css, hay que repetir el cambio
     acá. */
  const ESTILO_SVG_CURVAS =
    ".pa-svg-tick{font-size:11px;fill:#6b7280;font-family:'Segoe UI',system-ui,sans-serif}" +
    ".pa-svg-label{font-size:11px;font-weight:600;font-family:'Segoe UI',system-ui,sans-serif}" +
    ".pa-svg-valor{font-size:8px;font-family:'Segoe UI',system-ui,sans-serif;opacity:.7}";

  // Rasteriza el SVG (viewBox propio, ver dibujarCurvaLineas en
  // planAvanceDatos.js) a PNG de ancho `anchoDestino` px, x2 de resolución
  // real para que no se vea pixelado al abrir el Excel. Devuelve el base64
  // (sin el prefijo data:) y el alto que le corresponde a ese ancho.
  function svgComoPng(svgMarkup, anchoDestino) {
    return new Promise((resolve, reject) => {
      const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svgMarkup);
      const vbW = m ? Number(m[1]) : 960;
      const vbH = m ? Number(m[2]) : 340;
      const escala = 2;
      const canvas = document.createElement('canvas');
      canvas.width = vbW * escala;
      canvas.height = vbH * escala;
      // El SVG está pensado para insertarse con innerHTML (hereda el
      // namespace del documento), no para cargarse solo como imagen: sin
      // xmlns explícito, Chrome lo rechaza como image/svg+xml.
      const svgConNamespace = /xmlns=/.test(svgMarkup)
        ? svgMarkup
        : svgMarkup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
      const svgConEstilo = svgConNamespace.replace(/(<svg[^>]*>)/, `$1<style>${ESTILO_SVG_CURVAS}</style>`);
      const blob = new Blob([svgConEstilo], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const c2d = canvas.getContext('2d');
        c2d.fillStyle = '#ffffff';
        c2d.fillRect(0, 0, canvas.width, canvas.height);
        c2d.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve({ base64: canvas.toDataURL('image/png').split(',')[1], width: anchoDestino, height: anchoDestino * vbH / vbW });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo rasterizar la curva a PNG')); };
      img.src = url;
    });
  }

  /* ===== Paleta y formatos =====
     Los mismos colores del documento imprimible (css/print.css), para que el
     Excel y el PDF se lean como dos salidas de la misma cosa. */

  const AZUL          = 'FF1A3A5C';   // --primary-dark
  const GRIS_CABECERA = 'FFE8EAED';
  const GRIS_SUAVE    = 'FFF5F6F8';
  const LINEA         = 'FFB8BFC9';
  const LINEA_FUERTE  = 'FF6B7280';
  const GRIS_TEXTO    = 'FF6B7280';

  const FMT_ARS  = '"$" #,##0.00';
  const FMT_CANT = '#,##0.00';
  const FMT_PCT  = '0.00%';
  const FMT_COEF = '0.0000';

  const finoBorde   = { style: 'thin', color: { argb: LINEA } };
  const fuerteBorde = { style: 'thin', color: { argb: LINEA_FUERTE } };

  // ExcelJS espera la fórmula sin el "=" adelante; se escribe con "=" en el
  // código para que se lea igual que en la planilla.
  const f = txt => ({ formula: String(txt).replace(/^=/, '') });

  const num = n => (n == null || isNaN(n) ? null : Number(n));

  function bordear(ws, r0, c0, r1, c1, borde) {
    borde = borde || finoBorde;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        ws.getCell(r, c).border = { top: borde, left: borde, bottom: borde, right: borde };
      }
    }
  }

  function pintar(ws, r, c0, c1, argb) {
    for (let c = c0; c <= c1; c++) {
      ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    }
  }

  function negrita(ws, r, c0, c1, color) {
    for (let c = c0; c <= c1; c++) {
      const cell = ws.getCell(r, c);
      cell.font = Object.assign({}, cell.font, { bold: true }, color ? { color: { argb: color } } : {});
    }
  }

  // Fila de encabezado de tabla: gris, negrita, centrada y con quiebre de línea.
  function cabecera(ws, r, c0, titulos) {
    titulos.forEach((t, i) => {
      const cell = ws.getCell(r, c0 + i);
      cell.value = t;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    pintar(ws, r, c0, c0 + titulos.length - 1, GRIS_CABECERA);
    negrita(ws, r, c0, c0 + titulos.length - 1);
    bordear(ws, r, c0, r, c0 + titulos.length - 1, fuerteBorde);
  }

  /* Los VLOOKUP de la hoja A.P buscan materiales y equipos por su nombre, así
     que dos insumos no pueden llamarse igual: al repetido se le agrega " (2)".
     Excel compara sin distinguir mayúsculas, así que la comparación va en
     minúsculas. Devuelve { entidadKey: nombreEnLaPlanilla }. */
  function nombresUnicos(entidades, nombreDe) {
    const usados = {};
    const mapa = {};
    entidades.forEach(e => {
      const base = (nombreDe(e) || '').trim() || '(sin nombre)';
      let nombre = base;
      let n = 2;
      while (usados[nombre.toLowerCase()]) nombre = `${base} (${n++})`;
      usados[nombre.toLowerCase()] = true;
      mapa[e.key] = nombre;
    });
    return mapa;
  }

  // Fecha ISO ("2026-04-29") → Date al mediodía, para que ningún huso la corra
  // un día al pasarla a serial de Excel.
  function fechaExcel(iso) {
    if (!iso) return null;
    const [a, m, d] = String(iso).split('-').map(Number);
    return a && m && d ? new Date(a, m - 1, d, 12) : null;
  }

  function titulo(ws, r, c0, c1, texto, tam) {
    const cell = ws.getCell(r, c0);
    cell.value = texto;
    cell.font = { bold: true, size: tam || 12, color: { argb: AZUL } };
    if (c1 > c0) ws.mergeCells(r, c0, r, c1);
    return r + 1;
  }

  /* ===== Membrete =====
     Logo arriba a la izquierda y las filas "ETIQUETA: valor" debajo, como el
     encabezado de la hoja CyP de la planilla. Devuelve la primera fila libre. */

  function membrete(ws, ctx, logoId, colFin) {
    ws.addImage(logoId, { tl: { col: 1, row: 0.3 }, ext: { width: 175, height: 36 } });
    ws.getRow(1).height = 34;
    let r = 3;
    ctx.membrete.forEach(fila => {
      const cell = ws.getCell(r, 2);
      cell.value = `${fila.etiqueta}: ${fila.valor}`;
      cell.font = { size: 9 };
      if (colFin > 2) ws.mergeCells(r, 2, r, colFin);
      r++;
    });
    return r + 1;
  }

  // Cierre de hoja: sólo las notas al pie. Igual que el documento imprimible,
  // el libro no lleva lugar, fecha ni espacio de firma.
  function pie(ws, r, ctx, colFin) {
    r++;
    if (ctx.notas && ctx.notas.trim()) {
      ctx.notas.split('\n').forEach(linea => {
        const cell = ws.getCell(r, 2);
        cell.value = linea;
        cell.font = { size: 8, color: { argb: GRIS_TEXTO } };
        if (colFin > 2) ws.mergeCells(r, 2, r, colFin);
        r++;
      });
    }
    return r + 1;
  }

  /* ===== Hoja Datos =====
     Los parámetros de cálculo de la obra (dólar, equipos, mano de obra) y el
     bloque del Coeficiente K. Todas las demás hojas apuntan acá, así que
     cambiar el dólar o las cargas sociales en esta hoja recalcula el libro
     entero — igual que la hoja "Datos" de la planilla. */

  function hojaDatos(ws, ctx, ref) {
    const m = ctx.modelo;
    const pe = m.paramsEquipos;
    const pm = m.paramsMO;

    ws.getColumn(1).width = 4;
    ws.getColumn(2).width = 34;
    ws.getColumn(3).width = 16;
    ws.getColumn(4).width = 14;
    ws.getColumn(5).width = 26;
    ws.getColumn(6).width = 16;
    ws.getColumn(7).width = 16;

    let r = 2;
    r = titulo(ws, r, 2, 5, 'PARÁMETROS DE CÁLCULO', 13);
    ws.getCell(r, 2).value = m.obra.nombre || '';
    ws.getCell(r, 2).font = { size: 9, color: { argb: GRIS_TEXTO } };
    r += 2;

    // Un parámetro por fila: etiqueta, valor y unidad.
    const dato = (etiqueta, valor, unidad, fmt) => {
      ws.getCell(r, 2).value = etiqueta;
      const cell = ws.getCell(r, 3);
      cell.value = valor;
      if (fmt) cell.numFmt = fmt;
      cell.alignment = { horizontal: 'right' };
      if (unidad) {
        ws.getCell(r, 4).value = unidad;
        ws.getCell(r, 4).font = { size: 9, color: { argb: GRIS_TEXTO } };
      }
      return r++;
    };

    const grupo = texto => {
      ws.getCell(r, 2).value = texto;
      negrita(ws, r, 2, 2, AZUL);
      r++;
    };

    grupo('Variables generales');
    ref.dolar = `Datos!$C$${dato('Valor del dólar', num(m.dolarObra), '$/USD', FMT_CANT)}`;
    ref.combustible = `Datos!$C$${dato('Precio del combustible', num(pe.precioCombustibleLitro), '$/litro', FMT_ARS)}`;
    r++;

    grupo('Equipos');
    ref.tasaInteres = `Datos!$C$${dato('Interés anual', num(pe.tasaInteresPct) / 100, '', FMT_PCT)}`;
    ref.reparaciones = `Datos!$C$${dato('Reparaciones y repuestos', num(pe.reparacionesPct) / 100, 'de la amortización', FMT_PCT)}`;
    ref.lubricantes  = `Datos!$C$${dato('Lubricantes', num(pe.lubricantesPct) / 100, 'del combustible', FMT_PCT)}`;
    r++;

    grupo('Mano de obra');
    ref.jornada    = `Datos!$C$${dato('Jornada laboral', num(pm.jornadaHoras), 'horas', '#,##0.##')}`;
    ref.diasMes    = `Datos!$C$${dato('Días por mes', num(pm.diasMes), 'días', '#,##0.##')}`;
    ref.asistencia = `Datos!$C$${dato('Asistencia perfecta', num(pm.asistenciaPct) / 100, '', FMT_PCT)}`;
    ref.cargas     = `Datos!$C$${dato('Cargas sociales + ART', num(pm.cargasPct) / 100, '', FMT_PCT)}`;
    ref.comida     = `Datos!$C$${dato('Comida', pm.comidaActivo ? num(pm.comidaMonto) || 0 : 0, '$/día', FMT_ARS)}`;
    ref.segCapataz = `Datos!$C$${dato('Seguridad y capataz',
      pm.seguridadCapatazActivo ? num(pm.seguridadCapatazPct) / 100 || 0 : 0, 'de la M.O. del análisis', FMT_PCT)}`;
    r++;

    /* Categorías de mano de obra: el costo horario y el jornal salen por
       fórmula de los parámetros de arriba, con la misma cuenta que
       calcCostoManoDeObra() — básico con extra, asistencia, cargas y el no
       remunerativo prorrateado por hora; la comida va al jornal sin prorratear. */
    grupo('Categorías de mano de obra');
    const filaCabRoles = r;
    cabecera(ws, r, 2, ['Categoría', 'Básico $/h', 'Extra', 'No remunerativo $/mes', 'Costo horario $/h', 'Jornal $/día']);
    r++;
    ref.roles = {};   // { nombre: 'Datos!$G$n' }  ← jornal de cada categoría
    const filaRol0 = r;
    m.catalogos.roles.forEach(rol => {
      ws.getCell(r, 2).value = rol.nombre || '';
      ws.getCell(r, 3).value = num(rol.basico);
      ws.getCell(r, 3).numFmt = FMT_ARS;
      ws.getCell(r, 4).value = num(rol.extraPct) / 100 || 0;
      ws.getCell(r, 4).numFmt = FMT_PCT;
      ws.getCell(r, 5).value = num(rol.noRemunerativoMensual) || 0;
      ws.getCell(r, 5).numFmt = FMT_ARS;
      ws.getCell(r, 6).value = f(`=C${r}*(1+D${r})*(1+${ref.asistencia})*(1+${ref.cargas})+E${r}/(${ref.diasMes}*${ref.jornada})`);
      ws.getCell(r, 6).numFmt = FMT_ARS;
      ws.getCell(r, 7).value = f(`=F${r}*${ref.jornada}+${ref.comida}`);
      ws.getCell(r, 7).numFmt = FMT_ARS;
      ref.roles[rol.nombre || ''] = `Datos!$G$${r}`;
      r++;
    });
    if (r > filaRol0) bordear(ws, filaRol0, 2, r - 1, 7);
    else { ws.getCell(r, 2).value = 'Esta obra no tiene categorías cargadas.'; r++; }
    ref.rangoRoles = { hoja: 'Datos', desde: filaRol0, hasta: Math.max(r - 1, filaRol0) };
    ws.getRow(filaCabRoles).height = 28;
    r += 2;

    /* Coeficiente K — la misma cadena que calcCoeficienteK():
         K = (1 + %GG + %Beneficio) × (1 + %Financiero) × (1 + Σ%Impuestos)
       Cada fila muestra su % y cuánto aporta, como la hoja "Carga fija" de la
       planilla. El %GG queda como valor: pasa a ser fórmula contra el total de
       gastos fijos cuando se agrega la hoja Carga fija. */
    const d = m.kDesglose;
    r = titulo(ws, r, 2, 4, 'CARGA FIJA', 12);
    cabecera(ws, r, 2, ['Concepto', '%', 'Aporte']);
    r++;
    const filaK0 = r;

    const filaCoef = (etiqueta, pct, formulaAporte) => {
      ws.getCell(r, 2).value = etiqueta;
      if (pct != null) {
        ws.getCell(r, 3).value = pct;
        ws.getCell(r, 3).numFmt = FMT_PCT;
      }
      ws.getCell(r, 4).value = f(formulaAporte);
      ws.getCell(r, 4).numFmt = FMT_COEF;
      return r++;
    };

    const rGG   = filaCoef('Gastos generales' + (d.ggEsManual ? ' (cargado a mano)' : ''), d.ggFrac || 0, `=+C${r}`);
    const rBen  = filaCoef('Beneficio', d.beneficioFrac || 0, `=+C${r}`);
    const rSub  = filaCoef('Subtotal costo', null, `=1+C${rGG}+C${rBen}`);
    negrita(ws, rSub, 2, 4);
    const rFin  = filaCoef('Costo financiero', d.costoFinancieroFrac || 0, `=D${rSub}*(1+C${r})-D${rSub}`);
    const rSubF = filaCoef('Subtotal con gasto financiero', null, `=D${rSub}*(1+C${rFin})`);
    negrita(ws, rSubF, 2, 4);
    const filasImp = d.impuestos.map(i =>
      filaCoef(i.nombre || 'Impuesto', num(i.porcentaje) / 100 || 0, `=$D$${rSubF}*C${r}`));
    const rangoImp = filasImp.length ? `C${filasImp[0]}:C${filasImp[filasImp.length - 1]}` : null;
    const rImp = filaCoef('Impuestos', null, `=D${r + 1}-D${rSubF}`);
    negrita(ws, rImp, 2, 4);

    // K se calcula como en el motor: subtotal con financiero × (1 + Σ%), no
    // sumando aporte por aporte — dos caminos que dan lo mismo en papel pero
    // no bit a bit en punto flotante.
    ws.getCell(r, 2).value = 'CARGA FIJA';
    ws.getCell(r, 4).value = f(rangoImp ? `=D${rSubF}*(1+SUM(${rangoImp}))` : `=D${rSubF}`);
    ws.getCell(r, 4).numFmt = FMT_COEF;
    pintar(ws, r, 2, 4, AZUL);
    negrita(ws, r, 2, 4, 'FFFFFFFF');
    ws.mergeCells(r, 2, r, 3);
    ref.k = `Datos!$D$${r}`;
    // La hoja Carga fija todavía no existe: si el % de Gastos Generales es el
    // calculado (y no uno cargado a mano), esta celda pasa a ser la división
    // gastos fijos / costo del Cómputo una vez que estén las dos hojas.
    ref.filaGG = rGG;
    ref.ggEsManual = d.ggEsManual;
    // Piezas sueltas del coeficiente: la hoja Carga fija las necesita para
    // armar el Presupuesto s/IVA (que no es "antes de los impuestos": IIBB y
    // percepciones sí integran el neto que se factura) y, si hay conceptos
    // calculados sobre el presupuesto propio, para despejar el % de Gastos
    // Generales sin cerrar un círculo de referencias.
    const sumaPct = filas => filas.length ? filas.map(n => `Datos!$C$${n}`).join('+') : '0';
    ref.coef = {
      beneficio: `Datos!$C$${rBen}`,
      financiero: `Datos!$C$${rFin}`,
      subtotalConFinanciero: `Datos!$D$${rSubF}`,
      pctIva: sumaPct(filasImp.filter((_, idx) => d.impuestos[idx].esIva)),
      pctOtrosImpuestos: sumaPct(filasImp.filter((_, idx) => !d.impuestos[idx].esIva)),
    };
    bordear(ws, filaK0, 2, r, 4);
    r++;
  }

  /* ===== Hoja Materiales =====
     Sólo los materiales que algún A.P de esta obra —presupuesto o
     auxiliar— referencia (window.materialesUsadosEnObra, mismo criterio que
     la hoja Equipos), con el precio que rige para esta obra: el propio si lo
     tiene cargado, si no el más reciente de todas (lo mismo que resuelve
     resolverPreciosObra para la pantalla). El precio en pesos es la fuente
     de verdad; sólo cuando el material no lo tiene guardado se reconstruye
     desde el dólar.

     Un material puede tener el precio cargado como fórmula "=.../k" (Carga
     Fija de la obra, referencia viva — ver calc.js y el comentario largo de
     precioVigenteMaterial en calcCostos.js): ahí el precioARS/precioUSD
     guardados son sólo la foto del día que se guardó, y quedan viejos en
     cuanto cambia el K de la obra. Por eso acá se reevalúa con
     window.precioVigenteMaterial en vez de leer directo el número guardado
     — mismo valor que ve la pantalla del A.P, y el que corresponde escribir
     en la hoja (no hay forma de que sea una fórmula viva de Excel sin
     volverse circular con el propio K, que sale del costo del Cómputo con
     precios SIEMPRE congelados — ver presupuestoDatos.js). */

  function hojaMateriales(ws, ctx, ref) {
    const m = ctx.modelo;

    ws.getColumn(1).width = 4;
    ws.getColumn(2).width = 52;
    ws.getColumn(3).width = 11;
    ws.getColumn(4).width = 16;
    ws.getColumn(5).width = 18;
    ws.getColumn(6).width = 24;
    ws.getColumn(7).width = 13;

    let r = 2;
    r = titulo(ws, r, 2, 7, 'MATERIALES', 13) + 1;

    const filaCab = r;
    cabecera(ws, r, 2, ['Denominación', 'Unidad', 'Precio U$D\n(sin IVA)', 'Precio $\n(sin IVA)', 'Proveedor', 'Fecha']);
    ws.getRow(r).height = 28;
    r++;

    const materiales = window.materialesUsadosEnObra(m).slice()
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    const nombres = nombresUnicos(materiales, e => e.nombre);

    const primera = r;
    materiales.forEach(mat => {
      const precio = m.preciosObra[mat.key] || null;
      // Precio cargado con fórmula "=.../k" (referencia viva a la Carga
      // Fija de la obra): el ARS guardado es sólo la foto del día que se
      // guardó, se reevalúa con el K vigente — ver el comentario de arriba.
      const formulaViva = !!(precio && precio.precioFormula && precio.precioFormulaMoneda &&
        window.formulaTieneRefs && window.formulaTieneRefs(precio.precioFormula));
      const precioVivoARS = precio ? window.precioVigenteMaterial(precio, m.dolarObra) : null;
      ws.getCell(r, 2).value = nombres[mat.key];
      ws.getCell(r, 3).value = mat.unidad || '';
      ws.getCell(r, 3).alignment = { horizontal: 'center' };
      // El $ (columna E) es la fuente de verdad; el U$D es sólo ayuda de
      // lectura. Con fórmula viva se deriva del $ ya reevaluado en vez de
      // mostrar el U$D congelado, para no mezclar una foto vieja con un
      // número al día en la misma fila.
      ws.getCell(r, 4).value = formulaViva
        ? f(`=E${r}/${ref.dolar}`)
        : (precio ? num(precio.precioUSD) : null);
      ws.getCell(r, 4).numFmt = FMT_CANT;
      // Sin precioARS guardado (datos anteriores al campo dual) el precio en
      // pesos sale del dólar de la obra, igual que en calcCostoUnitarioItem.
      ws.getCell(r, 5).value = precioVivoARS != null
        ? num(precioVivoARS)
        : (precio && precio.precioUSD ? f(`=D${r}*${ref.dolar}`) : null);
      ws.getCell(r, 5).numFmt = FMT_ARS;
      ws.getCell(r, 6).value = precio ? (precio.proveedor || '') : '';
      const fecha = precio ? fechaExcel(precio.fecha) : null;
      if (fecha) {
        ws.getCell(r, 7).value = fecha;
        ws.getCell(r, 7).numFmt = 'dd/mm/yyyy';
      }
      r++;
    });

    if (r === primera) { ws.getCell(r, 2).value = 'Esta obra no usa materiales en ningún análisis de precio.'; r++; }
    const ultima = r - 1;
    bordear(ws, primera, 2, ultima, 7);

    ws.views = [{ state: 'frozen', ySplit: filaCab }];
    ws.autoFilter = { from: { row: filaCab, column: 2 }, to: { row: ultima, column: 7 } };

    // Rango y columnas con las que el A.P busca cada material por nombre.
    ref.materiales = {
      nombres,
      rango: `Materiales!$B$${primera}:$E$${ultima}`,
      colUnidad: 2,   // C, contando desde B
      colPrecio: 4,   // E
    };
  }

  /* ===== Hoja Equipos =====
     Un renglón por equipo con su costo diario desglosado término por término
     (amortización, intereses, reparaciones, combustible y lubricantes), que es
     la cuenta de calcDesgloseCostoEquipo escrita en fórmulas contra los
     parámetros de la hoja Datos y el consumo propio de cada equipo (columna
     Consumo, catálogo). El A.P después sólo busca el costo diario.

     A diferencia de Materiales (catálogo entero, es de consulta general), acá
     sólo van los equipos que window.equiposUsadosEnObra encuentra en algún A.P
     de esta obra —presupuesto o auxiliar—: el mismo criterio con el que se
     arma la sección "Amortización de equipos" del PDF. El dominio de VLOOKUP
     de la hoja A.P nunca busca otra cosa, así que no faltan filas.

     Un equipo al que le falte costo, vida útil o uso anual no cuesta nada en
     el sistema (la línea del análisis se descarta), así que acá va en cero y
     sin desglose: poner las fórmulas daría #¡DIV/0! y ensuciaría todo el libro. */

  function hojaEquipos(ws, ctx, ref) {
    const m = ctx.modelo;
    const hayDolar = m.dolarObra != null;

    ws.getColumn(1).width = 4;
    ws.getColumn(2).width = 42;
    [11, 12, 12, 12, 14, 16, 15, 14, 15, 15, 14, 17].forEach((w, i) => { ws.getColumn(3 + i).width = w; });

    let r = 2;
    r = titulo(ws, r, 2, 14, 'EQUIPOS', 13) + 1;

    const filaCab = r;
    cabecera(ws, r, 2, ['Designación', 'Potencia\nHP', 'Consumo\nlts/HP·h', 'Uso anual\nHs', 'Vida útil\nHs',
      'Costo actual\nU$D', 'Costo actual\n$', 'Amortización\n$/día', 'Intereses\n$/día',
      'Reparaciones\n$/día', 'Combustible\n$/día', 'Lubricantes\n$/día', 'Costo diario\n$']);
    ws.getRow(r).height = 32;
    r++;

    const equipos = window.equiposUsadosEnObra(m).map(u => u.equipo);
    const nombres = nombresUnicos(equipos, e => `${e.tipo || ''} ${e.codigo || ''}`.trim());

    const primera = r;
    equipos.forEach(eq => {
      const completo = hayDolar && !!eq.costoUSD && !!eq.vidaUtil && !!eq.usoAnual;
      ws.getCell(r, 2).value = nombres[eq.key];
      ws.getCell(r, 3).value = num(eq.potencia) || 0;
      ws.getCell(r, 3).numFmt = '#,##0.##';
      ws.getCell(r, 4).value = num(eq.consumoCombustibleLtsPorHp) || 0;
      ws.getCell(r, 4).numFmt = '#,##0.000';
      ws.getCell(r, 5).value = num(eq.usoAnual);
      ws.getCell(r, 6).value = num(eq.vidaUtil);
      ws.getCell(r, 7).value = num(eq.costoUSD);
      ws.getCell(r, 7).numFmt = FMT_CANT;
      if (completo) {
        ws.getCell(r, 8).value  = f(`=G${r}*${ref.dolar}`);                                  // costo actual $
        ws.getCell(r, 9).value  = f(`=H${r}*${ref.jornada}/F${r}`);                           // amortización
        ws.getCell(r, 10).value = f(`=H${r}*${ref.tasaInteres}/2/E${r}*${ref.jornada}`);      // intereses
        ws.getCell(r, 11).value = f(`=I${r}*${ref.reparaciones}`);                            // reparaciones
        ws.getCell(r, 12).value = f(`=(D${r}*C${r}*${ref.jornada})*${ref.combustible}`);      // combustible (consumo propio de la fila)
        ws.getCell(r, 13).value = f(`=L${r}*${ref.lubricantes}`);                             // lubricantes
        ws.getCell(r, 14).value = f(`=I${r}+J${r}+K${r}+L${r}+M${r}`);
      } else {
        ws.getCell(r, 14).value = 0;
      }
      for (let c = 8; c <= 14; c++) ws.getCell(r, c).numFmt = FMT_ARS;
      negrita(ws, r, 14, 14);
      r++;
    });

    if (r === primera) { ws.getCell(r, 2).value = 'Esta obra no usa equipos en ningún análisis de precio.'; r++; }
    const ultima = r - 1;
    bordear(ws, primera, 2, ultima, 14);

    ws.views = [{ state: 'frozen', ySplit: filaCab, xSplit: 2 }];
    ws.autoFilter = { from: { row: filaCab, column: 2 }, to: { row: ultima, column: 14 } };

    ref.equipos = {
      nombres,
      rango: `Equipos!$B$${primera}:$N$${ultima}`,
      colPotencia: 2,   // C, contando desde B
      colCosto: 13,     // N
    };
  }

  /* ===== Hoja A.P =====
     Un bloque por renglón del presupuesto, con la misma lectura que la
     pantalla del análisis de precio: A-Equipos, B-Mano de Obra, C-Materiales,
     subtotal, Coeficiente K y precio unitario.

     Los precios de los insumos no se copian: cada fila los busca con VLOOKUP
     en las hojas Materiales y Equipos, y los jornales salen de la hoja Datos.
     En la fila del código de cada bloque quedan además el total (columna K) y
     el costo unitario sin K (columna L), que son las dos celdas que CyP lee
     con INDEX/MATCH — por eso esas dos columnas no se usan para nada más. */

  const HOJA_AP = "'A.P'";
  const HOJA_APAUX = "'A.P auxiliares'";

  function columnasAP(ws) {
    ws.getColumn(1).width = 3;
    ws.getColumn(2).width = 26;
    ws.getColumn(3).width = 46;
    ws.getColumn(4).width = 12;
    ws.getColumn(5).width = 11;
    ws.getColumn(6).width = 12;
    ws.getColumn(7).width = 12;
    ws.getColumn(8).width = 18;
    ws.getColumn(9).width = 20;
    ws.getColumn(10).width = 10;
    ws.getColumn(11).width = 20;
    ws.getColumn(12).width = 20;
  }

  /* Un bloque de análisis de precio, escrito desde la fila `r`. Devuelve la
     fila donde arranca el siguiente.

     `literal` es lo único que separa a las dos hojas que lo usan. En la hoja
     A.P la descripción y la unidad se traen de CyP con un VLOOKUP contra el
     código, así el libro queda vivo; pero un análisis auxiliar no está en CyP
     —no es parte de la obra— y ese VLOOKUP daría #N/A en cadena, así que van
     escritas como texto. Por lo mismo tampoco se escriben las dos celdas (K y
     L) de la fila del código, que son las que CyP lee de vuelta. */
  function bloqueAP(ws, r, m, ref, linea, literal) {
      const ap = window.analisisDePrecioDe(m, linea.itemKey);
      const filaCodigo = r;

      ws.getCell(r, 2).value = 'Ítem:';
      negrita(ws, r, 2, 2);
      ws.getCell(r, 3).value = linea.numero;
      ws.getCell(r, 3).font = { bold: true, size: 12, color: { argb: AZUL } };
      if (!literal) {
        ws.getCell(r, 10).value = 'Precio unitario';
        ws.getCell(r, 10).alignment = { horizontal: 'right' };
        // La columna L, en la misma fila, lleva el costo unitario sin rótulo
        // visible: no se muestra (no va costo en el A.P que sale de la app),
        // pero sigue ahí porque CyP la lee con INDEX/MATCH (ver más abajo).
      }
      r++;

      ws.getCell(r, 2).value = 'Descripción:';
      ws.getCell(r, 3).value = literal
        ? (linea.nombre || '')
        : f(`=VLOOKUP(C${filaCodigo},CyP!$B:$C,2,FALSE)`);
      ws.getCell(r, 3).alignment = { wrapText: true, vertical: 'top' };
      ws.getCell(r, 10).value = 'Unidad:';
      ws.getCell(r, 10).alignment = { horizontal: 'right' };
      ws.getCell(r, 11).value = literal
        ? (linea.unidad || '')
        : f(`=VLOOKUP(C${filaCodigo},CyP!$B:$D,3,FALSE)`);
      ws.getCell(r, 11).alignment = { horizontal: 'center' };
      r++;

      if (!ap) {
        ws.getCell(r, 3).value = 'Este ítem todavía no tiene un análisis de precio cargado.';
        ws.getCell(r, 3).font = { italic: true, color: { argb: GRIS_TEXTO } };
        if (!literal) {
          ws.getCell(filaCodigo, 11).value = 0;
          ws.getCell(filaCodigo, 11).numFmt = FMT_ARS;
          ws.getCell(filaCodigo, 12).value = 0;
          ws.getCell(filaCodigo, 12).numFmt = FMT_ARS;
        }
        return r + 3;
      }

      ws.getCell(r, 2).value = 'Rendimiento:';
      const filaRend = r;
      ws.getCell(r, 3).value = ap.rendimiento || 1;
      ws.getCell(r, 3).numFmt = '#,##0.####';
      ws.getCell(r, 4).value = 'uds./jornada';
      ws.getCell(r, 4).font = { size: 9, color: { argb: GRIS_TEXTO } };
      r += 2;

      /* A — Equipos. El costo diario de cada equipo sale de la hoja Equipos;
         la potencia se trae sólo para mostrar los HP puestos en juego. */
      ws.getCell(r, 2).value = 'A — Equipos';
      pintar(ws, r, 2, 9, GRIS_CABECERA);
      negrita(ws, r, 2, 9);
      r++;
      cabecera(ws, r, 3, ['Denominación', 'HP unitario', 'Cantidad', 'HP total', '', 'Costo diario $', 'Costo total $']);
      r++;
      const eq0 = r;
      ap.equipos.forEach(fila => {
        const nombre = fila.refKey ? ref.equipos.nombres[fila.refKey] : null;
        ws.getCell(r, 3).value = nombre || fila.nombre;
        ws.getCell(r, 4).value = nombre ? f(`=VLOOKUP(C${r},${ref.equipos.rango},${ref.equipos.colPotencia},FALSE)`) : 0;
        ws.getCell(r, 4).numFmt = '#,##0.##';
        ws.getCell(r, 5).value = num(fila.cantidad);
        ws.getCell(r, 5).numFmt = FMT_CANT;
        ws.getCell(r, 6).value = f(`=+E${r}*D${r}`);
        ws.getCell(r, 6).numFmt = '#,##0.##';
        // Sin equipo elegido no hay costo: la línea no suma nada, igual que en
        // el motor de cálculo (un VLOOKUP daría #N/A y rompería el bloque).
        ws.getCell(r, 8).value = nombre ? f(`=VLOOKUP(C${r},${ref.equipos.rango},${ref.equipos.colCosto},FALSE)`) : 0;
        ws.getCell(r, 8).numFmt = FMT_ARS;
        ws.getCell(r, 9).value = f(`=+E${r}*H${r}`);
        ws.getCell(r, 9).numFmt = FMT_ARS;
        r++;
      });
      const eqN = r - 1;
      if (eqN < eq0) { ws.getCell(r, 3).value = 'Sin equipos.'; ws.getCell(r, 3).font = { italic: true, color: { argb: GRIS_TEXTO } }; r++; }
      bordear(ws, eq0 - 1, 3, r - 1, 9);

      const filaEqDiario = r;
      ws.getCell(r, 3).value = 'Costo diario Equipos';
      ws.getCell(r, 9).value = eqN >= eq0 ? f(`=SUM(I${eq0}:I${eqN})`) : 0;
      ws.getCell(r, 9).numFmt = FMT_ARS;
      r++;
      const filaEqUnit = r;
      ws.getCell(r, 3).value = 'Costo unitario de Equipos (A)';
      ws.getCell(r, 9).value = f(`=I${filaEqDiario}/C${filaRend}`);
      ws.getCell(r, 9).numFmt = FMT_ARS;
      negrita(ws, r, 3, 9);
      r += 2;

      /* B — Mano de obra. El jornal de cada categoría vive en la hoja Datos. */
      ws.getCell(r, 2).value = 'B — Mano de obra';
      pintar(ws, r, 2, 9, GRIS_CABECERA);
      negrita(ws, r, 2, 9);
      r++;
      cabecera(ws, r, 3, ['Denominación', '', '', '', 'Cantidad', 'Jornal $', 'Costo total $']);
      r++;
      const mo0 = r;
      ap.manoDeObra.forEach(fila => {
        const celdaJornal = ref.roles[fila.nombre];
        ws.getCell(r, 3).value = fila.nombre;
        ws.getCell(r, 7).value = num(fila.cantidad);
        ws.getCell(r, 7).numFmt = FMT_CANT;
        ws.getCell(r, 8).value = celdaJornal ? f(`=${celdaJornal}`) : 0;
        ws.getCell(r, 8).numFmt = FMT_ARS;
        ws.getCell(r, 9).value = f(`=+G${r}*H${r}`);
        ws.getCell(r, 9).numFmt = FMT_ARS;
        r++;
      });
      const moN = r - 1;
      if (moN < mo0) { ws.getCell(r, 3).value = 'Sin mano de obra.'; ws.getCell(r, 3).font = { italic: true, color: { argb: GRIS_TEXTO } }; r++; }
      bordear(ws, mo0 - 1, 3, r - 1, 9);

      const sumaJornales = moN >= mo0 ? `SUM(I${mo0}:I${moN})` : '0';
      let formulaMODiario = `=${sumaJornales}`;
      if (ap.costoDiarioSeguridadCapataz > 0) {
        // Adicional de la obra sobre la mano de obra de este análisis. Sólo
        // aparece en los ítems donde efectivamente se aplica: los excluidos
        // (item.sinSeguridadCapataz) directamente no llevan la fila.
        const filaSuma = r;
        ws.getCell(r, 3).value = 'Subtotal jornales';
        ws.getCell(r, 9).value = f(`=${sumaJornales}`);
        ws.getCell(r, 9).numFmt = FMT_ARS;
        r++;
        ws.getCell(r, 3).value = 'Seguridad y Capataz';
        ws.getCell(r, 7).value = f(`=${ref.segCapataz}`);
        ws.getCell(r, 7).numFmt = FMT_PCT;
        ws.getCell(r, 9).value = f(`=I${filaSuma}*G${r}`);
        ws.getCell(r, 9).numFmt = FMT_ARS;
        formulaMODiario = `=I${filaSuma}+I${r}`;
        r++;
      }

      const filaMODiario = r;
      ws.getCell(r, 3).value = 'Costo diario Mano de Obra';
      ws.getCell(r, 9).value = f(formulaMODiario);
      ws.getCell(r, 9).numFmt = FMT_ARS;
      r++;
      const filaMOUnit = r;
      ws.getCell(r, 3).value = 'Costo unitario Mano de Obra (B)';
      ws.getCell(r, 9).value = f(`=I${filaMODiario}/C${filaRend}`);
      ws.getCell(r, 9).numFmt = FMT_ARS;
      negrita(ws, r, 3, 9);
      r += 2;

      /* C — Materiales. Precio y unidad salen de la hoja Materiales. */
      ws.getCell(r, 2).value = 'C — Materiales';
      pintar(ws, r, 2, 9, GRIS_CABECERA);
      negrita(ws, r, 2, 9);
      r++;
      cabecera(ws, r, 3, ['Denominación', '', '', 'Unidad', 'Cantidad', 'Precio unitario $', 'Total $']);
      r++;
      const mat0 = r;
      ap.materiales.forEach(fila => {
        if (fila.esAuxiliar) {
          // Un auxiliar usado como insumo no está en la hoja Materiales — su
          // costo (el Subtotal A+B+C de su propio bloque, sin Carga Fija) sale
          // de la hoja "A.P auxiliares" por su código (A1, A2…), único dentro
          // de esta obra. La columna A (angosta, sin uso en esta hoja) guarda
          // ese código como llave oculta del INDEX/MATCH — la Denominación
          // visible sigue siendo el nombre, como texto.
          ws.getCell(r, 1).value = fila.codigo || '';
          ws.getCell(r, 3).value = fila.nombre;
          ws.getCell(r, 6).value = fila.unidad || '';
          ws.getCell(r, 6).alignment = { horizontal: 'center' };
          ws.getCell(r, 7).value = num(fila.cantidad);
          ws.getCell(r, 7).numFmt = FMT_CANT;
          ws.getCell(r, 8).value = fila.codigo && ref.auxiliares
            ? f(`=INDEX(${ref.auxiliares.rangoSubtotales},MATCH($A${r},${ref.auxiliares.rangoCodigos},0))`)
            : 0;
          ws.getCell(r, 8).numFmt = FMT_ARS;
          ws.getCell(r, 9).value = f(`=+G${r}*H${r}`);
          ws.getCell(r, 9).numFmt = FMT_ARS;
          r++;
          return;
        }
        if (fila.esPrecioDirecto) {
          // El ítem costeado a mano (js/apDirecto.js) no está en la hoja
          // Materiales ni en ninguna otra: su precio es un número cargado, no
          // un dato que se busque en otro lado. Va literal, y el total sigue
          // siendo una fórmula como el resto de la hoja.
          ws.getCell(r, 3).value = fila.nombre;
          ws.getCell(r, 6).value = fila.unidad || '';
          ws.getCell(r, 6).alignment = { horizontal: 'center' };
          ws.getCell(r, 7).value = num(fila.cantidad);
          ws.getCell(r, 7).numFmt = FMT_CANT;
          ws.getCell(r, 8).value = num(fila.costoUnitario) ?? 0;
          ws.getCell(r, 8).numFmt = FMT_ARS;
          ws.getCell(r, 9).value = f(`=+G${r}*H${r}`);
          ws.getCell(r, 9).numFmt = FMT_ARS;
          r++;
          return;
        }
        const nombre = fila.refKey ? ref.materiales.nombres[fila.refKey] : null;
        ws.getCell(r, 3).value = nombre || fila.nombre;
        ws.getCell(r, 6).value = nombre ? f(`=VLOOKUP(C${r},${ref.materiales.rango},${ref.materiales.colUnidad},FALSE)`) : '';
        ws.getCell(r, 6).alignment = { horizontal: 'center' };
        ws.getCell(r, 7).value = num(fila.cantidad);
        ws.getCell(r, 7).numFmt = FMT_CANT;
        ws.getCell(r, 8).value = nombre ? f(`=VLOOKUP(C${r},${ref.materiales.rango},${ref.materiales.colPrecio},FALSE)`) : 0;
        ws.getCell(r, 8).numFmt = FMT_ARS;
        ws.getCell(r, 9).value = f(`=+G${r}*H${r}`);
        ws.getCell(r, 9).numFmt = FMT_ARS;
        r++;
      });
      const matN = r - 1;
      if (matN < mat0) { ws.getCell(r, 3).value = 'Sin materiales.'; ws.getCell(r, 3).font = { italic: true, color: { argb: GRIS_TEXTO } }; r++; }
      bordear(ws, mat0 - 1, 3, r - 1, 9);

      const filaMat = r;
      ws.getCell(r, 3).value = 'Costo unitario de Materiales (C)';
      ws.getCell(r, 9).value = matN >= mat0 ? f(`=SUM(I${mat0}:I${matN})`) : 0;
      ws.getCell(r, 9).numFmt = FMT_ARS;
      negrita(ws, r, 3, 9);
      r += 2;

      // El subtotal se suma en el mismo orden que calcCostoUnitarioItem:
      // materiales + equipos + mano de obra.
      const filaSub = r;
      ws.getCell(r, 2).value = 'SUBTOTAL (A+B+C)';
      ws.getCell(r, 9).value = f(`=I${filaMat}+I${filaEqUnit}+I${filaMOUnit}`);
      ws.getCell(r, 9).numFmt = FMT_ARS;
      negrita(ws, r, 2, 9);
      bordear(ws, r, 2, r, 9, fuerteBorde);

      /* Un análisis auxiliar termina acá: su resultado es un costo, que se
         puede copiar a mano a Carga Fija, o quedar referenciado en vivo desde
         la sección "C — Materiales" de OTRO A.P. (de un ítem del Cómputo o de
         otro auxiliar) que lo use como insumo — ver ref.auxiliares, armado
         antes de escribir esta hoja. Multiplicarlo por el K sería cargarlo dos
         veces, así que nunca lleva Carga Fija ni Precio Unitario. La celda K
         de la fila del código, sin rótulo visible (igual que L en la hoja A.P
         normal), es la que ese otro A.P. lee con INDEX/MATCH. */
      if (literal) {
        ws.getCell(filaCodigo, 11).value = f(`=I${r}`);
        ws.getCell(filaCodigo, 11).numFmt = FMT_ARS;
        pintar(ws, r, 2, 9, AZUL);
        negrita(ws, r, 2, 9, 'FFFFFFFF');
        return r + 3;
      }

      r++;
      ws.getCell(r, 2).value = 'Carga Fija';
      ws.getCell(r, 9).value = f(`=${ref.k}`);
      ws.getCell(r, 9).numFmt = FMT_COEF;
      r++;
      ws.getCell(r, 2).value = 'PRECIO UNITARIO';
      // Redondeado a 2 decimales de verdad (no sólo formato de celda): el
      // total de CyP multiplica por este valor, así que tiene que ser el
      // mismo que ve/usa la pantalla Presupuesto (ver round2 en calc.js).
      ws.getCell(r, 9).value = f(`=ROUND(I${filaSub}*I${r - 1},2)`);
      ws.getCell(r, 9).numFmt = FMT_ARS;
      pintar(ws, r, 2, 9, AZUL);
      negrita(ws, r, 2, 9, 'FFFFFFFF');

      // Las dos celdas que lee CyP, en la fila del código.
      ws.getCell(filaCodigo, 11).value = f(`=I${r}`);
      ws.getCell(filaCodigo, 11).numFmt = FMT_ARS;
      ws.getCell(filaCodigo, 12).value = f(`=I${filaSub}`);
      ws.getCell(filaCodigo, 12).numFmt = FMT_ARS;
      return r + 3;
  }

  function hojaAP(ws, ctx, ref) {
    const m = ctx.modelo;
    columnasAP(ws);

    let r = 2;
    ref.ap = {};

    const lineas = m.rubros.flatMap(ru => ru.lineas);
    lineas.forEach(linea => { r = bloqueAP(ws, r, m, ref, linea, false); });

    if (!lineas.length) ws.getCell(2, 2).value = 'Sin ítems en el Cómputo.';

    /* Rangos acotados al alto real de la hoja para el INDEX/MATCH de CyP: con
       columnas enteras Excel barre un millón de filas por cada renglón del
       presupuesto, y hay programas de planilla que directamente no lo
       resuelven. Se deja un margen de filas por si alguien agrega un bloque. */
    const hasta = Math.max(r + 200, 300);
    ref.ap.rangoCodigos = `${HOJA_AP}!$C$2:$C$${hasta}`;
    ref.ap.rangoPrecios = `${HOJA_AP}!$K$2:$K$${hasta}`;
    ref.ap.rangoCostos  = `${HOJA_AP}!$L$2:$L$${hasta}`;

    ws.pageSetup = {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    };
  }

  /* ===== Hoja A.P auxiliares =====
     Los análisis que no son parte de la obra. Misma pinta que la hoja A.P, pero
     no referencia a CyP (ver `literal` en bloqueAP) ni lleva Carga Fija. Sí
     sigue leyendo los precios de las hojas Materiales, Equipos y Datos, que
     listan el catálogo completo — o sea que el auxiliar también se recalcula
     solo si se toca un precio en el Excel. Un auxiliar puede además ser
     referenciado desde la sección "C — Materiales" de OTRO A.P. (un ítem del
     Cómputo, o incluso otro auxiliar) que lo use como insumo, vía
     ref.auxiliares — armado ANTES de escribir esta hoja y la de A.P, ver la
     función principal de exportación. */

  function hojaAPAuxiliares(ws, ctx, ref) {
    const m = ctx.modelo;
    columnasAP(ws);

    let r = 2;
    m.auxiliares.forEach(aux => { r = bloqueAP(ws, r, m, ref, aux, true); });

    ws.pageSetup = {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    };
  }

  /* ===== Hoja CyP =====
     El cómputo y presupuesto renglón por renglón. La cabecera de cada rubro
     suma sus ítems con SUMIF sobre el código ("3.*" junta 3.1, 3.2, …) y la
     incidencia de cada fila se mide contra el total — igual que la planilla. */

  function hojaCyP(ws, ctx, ref, logoId) {
    const m = ctx.modelo;

    ws.getColumn(1).width = 4;
    ws.getColumn(2).width = 9;
    ws.getColumn(3).width = 72;
    ws.getColumn(4).width = 8;
    ws.getColumn(5).width = 12;
    ws.getColumn(6).width = 20;
    ws.getColumn(7).width = 22;
    ws.getColumn(8).width = 11;
    ws.getColumn(9).width = 20;
    ws.getColumn(10).width = 22;
    // Ocultas, no borradas: Carga fija sigue leyendo la columna J (ver abajo).
    ws.getColumn(9).hidden = true;
    ws.getColumn(10).hidden = true;

    let r = membrete(ws, ctx, logoId, 8);
    r = titulo(ws, r, 2, 8, 'DETALLE DE LA PROPUESTA DISCRIMINADA POR ÍTEM', 12);
    r++;

    const filaCab = r;
    // Las dos últimas columnas son el costo (el precio sin Coeficiente K): no
    // van en el presupuesto que se entrega, pero de ahí sale el costo del
    // Cómputo con el que la hoja Carga fija prorratea los gastos generales.
    cabecera(ws, r, 2, ['Ítem Nº', 'Denominación', 'Un.', 'Cantidad', 'Precio', 'Importe ($)', 'Incid. %',
      'Costo unit. ($)', 'Costo total ($)']);
    ws.getRow(r).height = 26;
    r++;

    // Obra sin rubros (ver js/numeracion.js): la hoja lleva sólo las filas de
    // ítem, como el papel.
    const plana = m.numeracion.sinRubros;

    const primera = r;
    // El total se escribe recién al final, pero las incidencias lo necesitan:
    // se calcula la fila de antemano contando lo que se va a escribir.
    const cantidadFilas = m.rubros.reduce((acc, ru) => acc + (plana ? 0 : 1) + ru.lineas.length, 0);
    const filaTotal = primera + Math.max(cantidadFilas, 1) + 1;   // vacío queda la fila del aviso
    const ultima = filaTotal - 2;
    const filasRubro = [];

    m.rubros.forEach(rubro => {
      const filaRubro = r;
      if (!plana) {
        filasRubro.push(filaRubro);
        // El código va como texto, no como número: con la numeración
        // personalizada puede ser "I" o "01" (ver js/numeracion.js). Los dos
        // lados de cada VLOOKUP que lo busca quedan texto contra texto, que es
        // la única forma de que el match exacto siga encontrándolo.
        ws.getCell(r, 2).value = rubro.numero;
        ws.getCell(r, 2).alignment = { horizontal: 'center' };
        ws.getCell(r, 3).value = rubro.nombre || '(sin nombre)';
        // La planilla original suma cada rubro con SUMIF sobre el código
        // ("3.*" junta 3.1, 3.2, …), pero ese rango incluye la celda del propio
        // subtotal: Excel lo resuelve igual, otros programas de planilla lo
        // rechazan como referencia circular. Sumar las filas del rubro da
        // exactamente lo mismo y el rango se sigue estirando solo si alguien
        // inserta un ítem en el medio.
        ws.getCell(r, 7).value = rubro.lineas.length
          ? f(`=SUM(G${filaRubro + 1}:G${filaRubro + rubro.lineas.length})`)
          : 0;
        ws.getCell(r, 7).numFmt = FMT_ARS;
        ws.getCell(r, 8).value = f(`=IFERROR(G${r}/$G$${filaTotal},0)`);
        ws.getCell(r, 8).numFmt = FMT_PCT;
        ws.getCell(r, 10).value = rubro.lineas.length
          ? f(`=SUM(J${filaRubro + 1}:J${filaRubro + rubro.lineas.length})`)
          : 0;
        ws.getCell(r, 10).numFmt = FMT_ARS;
        pintar(ws, r, 2, 10, GRIS_CABECERA);
        negrita(ws, r, 2, 10);
        r++;
      }

      rubro.lineas.forEach(l => {
        ws.getCell(r, 2).value = l.numero;                 // texto: "3.1"
        ws.getCell(r, 3).value = l.nombre || '';
        ws.getCell(r, 3).alignment = { wrapText: true, vertical: 'top' };
        ws.getCell(r, 4).value = l.unidad || '';
        ws.getCell(r, 4).alignment = { horizontal: 'center' };
        ws.getCell(r, 5).value = num(l.cantidad);
        ws.getCell(r, 5).numFmt = FMT_CANT;
        // Precio y costo unitarios: los busca en la hoja A.P por el código del
        // ítem, que es único. Tocar un precio de material en la hoja
        // Materiales se propaga hasta acá sin volver a exportar.
        ws.getCell(r, 6).value = f(`=INDEX(${ref.ap.rangoPrecios},MATCH($B${r},${ref.ap.rangoCodigos},0))`);
        ws.getCell(r, 6).numFmt = FMT_ARS;
        // Redondeado a 2 decimales de verdad: cantidad × precio unitario
        // (que ya viene redondeado desde el A.P) puede dar más de 2
        // decimales si la cantidad los tiene.
        ws.getCell(r, 7).value = f(`=ROUND(E${r}*F${r},2)`);
        ws.getCell(r, 7).numFmt = FMT_ARS;
        ws.getCell(r, 8).value = f(`=IFERROR(G${r}/$G$${filaTotal},0)`);
        ws.getCell(r, 8).numFmt = FMT_PCT;
        ws.getCell(r, 9).value = f(`=INDEX(${ref.ap.rangoCostos},MATCH($B${r},${ref.ap.rangoCodigos},0))`);
        ws.getCell(r, 9).numFmt = FMT_ARS;
        ws.getCell(r, 10).value = f(`=+E${r}*I${r}`);
        ws.getCell(r, 10).numFmt = FMT_ARS;
        r++;
      });
    });

    if (r === primera) {
      ws.getCell(r, 2).value = plana ? 'Sin ítems cargados en el Cómputo.' : 'Sin rubros cargados en el Cómputo.';
      r++;
    }
    bordear(ws, primera, 2, Math.max(r - 1, primera), 10);

    /* El total suma los subtotales de rubro, que a su vez suman sus ítems; en
       una obra sin rubros suma directo las filas de ítem. La planilla original
       usaba SUMIF(código,"*.*") para quedarse con los ítems y saltear las filas
       de rubro, pero eso ataba el total a que todo código de ítem tuviera un
       punto y ninguno de rubro lo tuviera: con la numeración personalizada un
       ítem puede llamarse "1 bis" y un rubro "1.A", y el total daba cualquier
       cosa. Sumar celdas concretas no depende de cómo se escriban los códigos. */
    const hayItems = m.rubros.some(ru => ru.lineas.length);
    const sumaDe = col => {
      if (plana) return hayItems ? f(`=SUM(${col}${primera}:${col}${ultima})`) : 0;
      return filasRubro.length ? f(`=SUM(${filasRubro.map(fr => `${col}${fr}`).join(',')})`) : 0;
    };

    r = filaTotal;
    ws.getCell(r, 2).value = 'PRESUPUESTO TOTAL';
    ws.mergeCells(r, 2, r, 6);
    ws.getCell(r, 7).value = sumaDe('G');
    ws.getCell(r, 7).numFmt = FMT_ARS;
    ws.getCell(r, 8).value = f(`=IFERROR(G${r}/$G$${r},0)`);
    ws.getCell(r, 8).numFmt = FMT_PCT;
    ws.getCell(r, 10).value = sumaDe('J');
    ws.getCell(r, 10).numFmt = FMT_ARS;
    pintar(ws, r, 2, 10, AZUL);
    negrita(ws, r, 2, 10, 'FFFFFFFF');
    bordear(ws, r, 2, r, 10, fuerteBorde);

    ws.views = [{ state: 'frozen', ySplit: filaCab }];
    ws.pageSetup = {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: `${filaCab}:${filaCab}`,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    };

    ref.cyp = {
      primera, ultima, filaTotal,
      total: `CyP!$G$${filaTotal}`,
      costoComputo: `CyP!$J$${filaTotal}`,
    };
  }

  /* ===== Hoja Carga fija =====
     Los gastos generales de la obra concepto por concepto. Cada uno se calcula
     según su tipo, igual que totalLineaCargaFija(): monto fijo
     (cantidad × precio × meses) o un porcentaje del costo del Cómputo, del
     presupuesto propio (s/IVA o c/IVA) o del presupuesto oficial.

     El total de esta hoja es lo que la hoja Datos prorratea sobre el costo del
     Cómputo para sacar el % de Gastos Generales del Coeficiente K, así que
     agregar un concepto acá mueve el K y con él todo el presupuesto.

     Los conceptos calculados sobre el presupuesto propio necesitan un cuidado
     extra: apuntan al total del presupuesto, que sale del K, que sale de estos
     gastos. En la app eso se resuelve despejando (ver calcCargaFija en
     calcCostos.js); acá hay que además evitar que Excel vea un círculo de
     referencias, porque los rechaza aunque la cuenta tenga solución. Por eso el
     % de Gastos Generales de la hoja Datos deja de ser "total / costo del
     Cómputo" cuando existen esos conceptos y pasa a la fórmula despejada, que
     no toca ninguna celda que dependa del K. */

  const BASE_PCT = {
    pctComputo: 'del costo del Cómputo',
    pctPrecioSinIva: 'del presupuesto s/IVA',
    pctPrecioConIva: 'del presupuesto c/IVA',
    pctOficial: 'del presupuesto oficial',
  };

  // [5,6,8,9,10] → "H5:H6,H8:H10" — para sumar sólo ciertas filas sin tocar las
  // que quedan en el medio (las que dependen del K y armarían el círculo).
  function rangosDe(filas, col) {
    const partes = [];
    for (let i = 0; i < filas.length;) {
      let j = i;
      while (j + 1 < filas.length && filas[j + 1] === filas[j] + 1) j++;
      partes.push(filas[i] === filas[j] ? `${col}${filas[i]}` : `${col}${filas[i]}:${col}${filas[j]}`);
      i = j + 1;
    }
    return partes.join(',');
  }

  function hojaCargaFija(ws, ctx, ref) {
    const m = ctx.modelo;
    const cf = m.cargaFija;

    ws.getColumn(1).width = 4;
    ws.getColumn(2).width = 56;
    ws.getColumn(3).width = 12;
    ws.getColumn(4).width = 20;
    ws.getColumn(5).width = 10;
    ws.getColumn(6).width = 10;
    ws.getColumn(7).width = 28;
    ws.getColumn(8).width = 22;
    ws.getColumn(9).width = 11;

    let r = 2;
    r = titulo(ws, r, 2, 9, 'CARGA FIJA', 13);
    ws.getCell(r, 2).value = m.obra.nombre || '';
    ws.getCell(r, 2).font = { size: 9, color: { argb: GRIS_TEXTO } };
    r += 2;

    const dato = (etiqueta, valor, unidad, fmt) => {
      ws.getCell(r, 2).value = etiqueta;
      negrita(ws, r, 2, 2);
      const cell = ws.getCell(r, 3);
      cell.value = valor;
      if (fmt) cell.numFmt = fmt;
      if (unidad) {
        ws.getCell(r, 4).value = unidad;
        ws.getCell(r, 4).font = { size: 9, color: { argb: GRIS_TEXTO } };
      }
      return r++;
    };

    // Duración de la obra: los conceptos que están cargados con esa cantidad de
    // meses la referencian, así que cambiarla acá los mueve a todos de una,
    // igual que el campo de la pantalla de Carga Fija.
    const duracion = num(cf.config.duracionMeses);
    const filaDuracion = dato('Duración de la obra', duracion, 'meses', '#,##0.##');
    const filaCosto = dato('Costo del Cómputo', f(`=${ref.cyp.costoComputo}`), '', FMT_ARS);
    const filaOficial = dato('Presupuesto oficial', num(m.obra.presupuestoOficial), '', FMT_ARS);

    const conceptos = window.lineasCargaFijaOrdenadas(cf.lineas);
    const hayCeldasSobrePrecio = conceptos.some(([, l]) => window.tipoCargaFijaEsSobrePrecio(l.tipo));

    // El presupuesto que sale del K, sólo si algún concepto se calcula sobre
    // él. El c/IVA es el total de la hoja CyP; el s/IVA se arma con el subtotal
    // con gasto financiero y los impuestos que NO son IVA, que sí integran el
    // neto facturado.
    let filaPresupSinIva = null, filaPresupConIva = null;
    if (hayCeldasSobrePrecio) {
      filaPresupSinIva = dato('Presupuesto s/IVA',
        f(`=${ref.cyp.costoComputo}*${ref.coef.subtotalConFinanciero}*(1+${ref.coef.pctOtrosImpuestos})`), '', FMT_ARS);
      filaPresupConIva = dato('Presupuesto c/IVA', f(`=${ref.cyp.total}`), '', FMT_ARS);
    }
    r++;

    const filaCab = r;
    cabecera(ws, r, 2, ['Concepto', 'Cantidad', 'Precio unitario', 'Meses', '%', 'Base', 'Total', 'Incid. %']);
    ws.getRow(r).height = 26;
    r++;

    const primera = r;
    const filaTotal = primera + Math.max(conceptos.length, 1) + 1;
    const filaBase = {
      pctComputo: () => filaCosto, pctOficial: () => filaOficial,
      pctPrecioSinIva: () => filaPresupSinIva, pctPrecioConIva: () => filaPresupConIva,
    };
    // Filas que NO dependen del K: son las únicas que puede sumar el % de
    // Gastos Generales de la hoja Datos sin cerrar el círculo.
    const filasIndependientes = [], filasSinIva = [], filasConIva = [];

    conceptos.forEach(([, l]) => {
      const tipo = l.tipo || 'monto';
      ws.getCell(r, 2).value = l.concepto || '(sin nombre)';
      ws.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
      if (tipo === 'pctPrecioSinIva') filasSinIva.push(r);
      else if (tipo === 'pctPrecioConIva') filasConIva.push(r);
      else filasIndependientes.push(r);
      if (window.tipoCargaFijaEsPorcentaje(tipo)) {
        ws.getCell(r, 6).value = num(l.porcentaje) / 100;
        ws.getCell(r, 6).numFmt = FMT_PCT;
        ws.getCell(r, 7).value = BASE_PCT[tipo];
        ws.getCell(r, 7).font = { size: 9, color: { argb: GRIS_TEXTO } };
        ws.getCell(r, 8).value = f(`=+F${r}*$C$${filaBase[tipo]()}`);
      } else {
        ws.getCell(r, 3).value = num(l.cantidad);
        ws.getCell(r, 3).numFmt = FMT_CANT;
        ws.getCell(r, 4).value = num(l.precioUnitario);
        ws.getCell(r, 4).numFmt = FMT_ARS;
        ws.getCell(r, 5).value = duracion != null && num(l.meses) === duracion
          ? f(`=$C$${filaDuracion}`)
          : num(l.meses);
        ws.getCell(r, 5).numFmt = '#,##0.##';
        ws.getCell(r, 8).value = f(`=+C${r}*D${r}*E${r}`);
      }
      ws.getCell(r, 8).numFmt = FMT_ARS;
      ws.getCell(r, 9).value = f(`=IFERROR(H${r}/$H$${filaTotal},0)`);
      ws.getCell(r, 9).numFmt = FMT_PCT;
      r++;
    });

    if (r === primera) { ws.getCell(r, 2).value = 'Esta obra todavía no tiene conceptos de carga fija cargados.'; r++; }
    const ultima = filaTotal - 2;
    bordear(ws, primera, 2, Math.max(r - 1, primera), 9);

    r = filaTotal;
    ws.getCell(r, 2).value = 'TOTAL DE GASTOS FIJOS';
    ws.mergeCells(r, 2, r, 7);
    ws.getCell(r, 8).value = f(`=SUM(H${primera}:H${ultima})`);
    ws.getCell(r, 8).numFmt = FMT_ARS;
    ws.getCell(r, 9).value = f(`=IFERROR(H${r}/$H$${r},0)`);
    ws.getCell(r, 9).numFmt = FMT_PCT;
    pintar(ws, r, 2, 9, AZUL);
    negrita(ws, r, 2, 9, 'FFFFFFFF');
    bordear(ws, r, 2, r, 9, fuerteBorde);
    r += 2;

    // Piezas del despeje. Van a la vista (no en celdas escondidas) porque son
    // las que explican de dónde sale el % de Gastos Generales de la hoja Datos
    // cuando hay conceptos calculados sobre el presupuesto propio.
    const apoyo = {};
    if (hayCeldasSobrePrecio) {
      const filaApoyo = (etiqueta, formula, fmt) => {
        ws.getCell(r, 2).value = etiqueta;
        ws.getCell(r, 2).font = { size: 9, color: { argb: GRIS_TEXTO } };
        ws.mergeCells(r, 2, r, 7);
        ws.getCell(r, 8).value = f(formula);
        ws.getCell(r, 8).numFmt = fmt;
        return r++;
      };
      const fSub = filaApoyo('Subtotal de gastos que no dependen del presupuesto',
        filasIndependientes.length ? `=SUM(${rangosDe(filasIndependientes, 'H')})` : '=0', FMT_ARS);
      const fQs = filaApoyo('Suma de los % sobre el Presupuesto s/IVA',
        filasSinIva.length ? `=SUM(${rangosDe(filasSinIva, 'F')})` : '=0', FMT_PCT);
      const fQc = filaApoyo('Suma de los % sobre el Presupuesto c/IVA',
        filasConIva.length ? `=SUM(${rangosDe(filasConIva, 'F')})` : '=0', FMT_PCT);
      apoyo.gastosIndependientes = `'Carga fija'!$H$${fSub}`;
      apoyo.qSinIva = `'Carga fija'!$H$${fQs}`;
      apoyo.qConIva = `'Carga fija'!$H$${fQc}`;
      r++;
    }

    ws.getCell(r, 2).value = hayCeldasSobrePrecio
      ? 'Hay conceptos calculados sobre el presupuesto de esta misma obra, que sale del Coeficiente K, '
        + 'que sale de estos gastos. No es un círculo sin salida: la ecuación se despeja, y por eso el % de '
        + 'Gastos Generales de la hoja Datos usa las tres celdas de acá arriba en vez del total. Ver la hoja Datos.'
      : 'El % de Gastos Generales de la Carga Fija sale de este total dividido por el costo del Cómputo. Ver la hoja Datos.';
    ws.getCell(r, 2).font = { size: 9, italic: true, color: { argb: GRIS_TEXTO } };
    ws.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
    ws.mergeCells(r, 2, r, 9);
    if (hayCeldasSobrePrecio) ws.getRow(r).height = 30;

    ws.views = [{ state: 'frozen', ySplit: filaCab }];
    ws.pageSetup = {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    };

    ref.cargaFija = { total: `'Carga fija'!$H$${filaTotal}`, hayCeldasSobrePrecio, ...apoyo };
  }

  /* ===== Hoja Resumen =====
     Un renglón por rubro, con la designación y el importe traídos de CyP por
     VLOOKUP sobre el número de rubro. Es la carátula del presupuesto. */

  function hojaResumen(ws, ctx, ref, logoId) {
    const m = ctx.modelo;

    ws.getColumn(1).width = 3;
    ws.getColumn(2).width = 9;
    ws.getColumn(3).width = 78;
    ws.getColumn(4).width = 8;
    ws.getColumn(5).width = 10;
    ws.getColumn(6).width = 22;
    ws.getColumn(7).width = 24;
    ws.getColumn(8).width = 11;

    let r = membrete(ws, ctx, logoId, 8);
    r = titulo(ws, r, 2, 8, 'RESUMEN DE CÓMPUTO Y PRESUPUESTO', 12);
    r++;

    const filaCab = r;
    cabecera(ws, r, 2, ['Ítem', 'Designación', 'Un.', 'Cant.', 'Precio unitario', 'Precio total', 'Incid. %']);
    ws.getRow(r).height = 26;
    r++;

    const primera = r;
    const filaTotal = primera + Math.max(m.rubros.length, 1) + 1;

    m.rubros.forEach(rubro => {
      ws.getCell(r, 2).value = rubro.numero;
      ws.getCell(r, 2).alignment = { horizontal: 'center' };
      // La designación y el importe se buscan por número de rubro (único),
      // no por nombre: dos rubros pueden llamarse igual.
      ws.getCell(r, 3).value = f(`=VLOOKUP($B${r},CyP!$B:$C,2,FALSE)`);
      ws.getCell(r, 3).alignment = { wrapText: true, vertical: 'top' };
      ws.getCell(r, 4).value = 'gl';
      ws.getCell(r, 4).alignment = { horizontal: 'center' };
      ws.getCell(r, 5).value = 1;
      ws.getCell(r, 5).numFmt = FMT_CANT;
      ws.getCell(r, 6).value = f(`=VLOOKUP($B${r},CyP!$B:$G,6,FALSE)`);
      ws.getCell(r, 6).numFmt = FMT_ARS;
      ws.getCell(r, 7).value = f(`=+E${r}*F${r}`);
      ws.getCell(r, 7).numFmt = FMT_ARS;
      ws.getCell(r, 8).value = f(`=IFERROR(+G${r}/$G$${filaTotal},0)`);
      ws.getCell(r, 8).numFmt = FMT_PCT;
      r++;
    });

    if (r === primera) { ws.getCell(r, 2).value = 'Sin rubros cargados en el Cómputo.'; r++; }
    bordear(ws, primera, 2, Math.max(r - 1, primera), 8);
    const ultima = filaTotal - 2;

    r = filaTotal;
    ws.getCell(r, 2).value = 'PRECIO TOTAL DE LA OBRA';
    ws.mergeCells(r, 2, r, 6);
    ws.getCell(r, 7).value = f(`=SUM(G${primera}:G${ultima})`);
    ws.getCell(r, 7).numFmt = FMT_ARS;
    ws.getCell(r, 8).value = f(`=SUM(H${primera}:H${ultima})`);
    ws.getCell(r, 8).numFmt = FMT_PCT;
    pintar(ws, r, 2, 8, AZUL);
    negrita(ws, r, 2, 8, 'FFFFFFFF');
    bordear(ws, r, 2, r, 8, fuerteBorde);
    r += 2;

    ws.getCell(r, 2).value = `SON PESOS: ${ctx.totalEnLetras}`;
    ws.getCell(r, 2).font = { bold: true, size: 9 };
    ws.mergeCells(r, 2, r, 8);
    bordear(ws, r, 2, r, 8, fuerteBorde);
    r++;

    pie(ws, r, ctx, 8);

    ws.views = [{ state: 'frozen', ySplit: filaCab }];
    ws.pageSetup = {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    };

    ref.resumen = { primera, ultima, filaTotal };
  }

  /* ===== Hoja Plan de trabajos =====
     El cronograma de avance e inversiones. Cada ítem ocupa tres renglones,
     como en la planilla: el "% en Ítem" es lo único que se carga a mano, y de
     ahí salen el "% en Obra" (× la incidencia del ítem) y el "% en Cant."
     (× la cantidad de contrato). La cabecera de cada rubro suma el "% en Obra"
     de sus ítems, y al pie van las certificaciones parcial y acumulada, en
     porcentaje y en pesos.

     Todo lo que no es avance —designación, unidad, cantidad y precio— se trae
     de CyP por el código del ítem, así que el cronograma se mantiene alineado
     con el presupuesto sin volver a exportar. */

  function hojaPlanTrabajos(ws, ctx, ref, logoId, curvasImgs) {
    const plan = ctx.plan;
    const n = plan.n;
    const unidad = window.nombreUnidadPlan(ctx.planConfig);
    const colP0 = 9;   // primera columna de período (I)

    ws.getColumn(1).width = 3;
    ws.getColumn(2).width = 10;
    ws.getColumn(3).width = 44;
    ws.getColumn(4).width = 9;
    ws.getColumn(5).width = 13;
    ws.getColumn(6).width = 22;
    ws.getColumn(7).width = 10;
    ws.getColumn(8).width = 14;
    for (let i = 0; i < n; i++) ws.getColumn(colP0 + i).width = 12;

    const colFin = colP0 + n - 1;
    const col = i => ws.getColumn(colP0 + i).letter;

    // La hoja Remanentes (más abajo) es el contrario de ésta: no repite el
    // avance cargado, lo lee de acá con fórmulas — necesita saber en qué fila
    // quedó la fila "% en Ítem" (t) y "% en Obra" (o, de ahí salen incidencia,
    // cantidad y precio) de cada ítem, y en cuál el pie "Remanente ($)"/
    // "Certificación acumulada %".
    ref.plan = { colP0, n, itemFila: {}, filaAcumPct: null, filaRemanenteM: null };

    let r = membrete(ws, ctx, logoId, 8);
    r = titulo(ws, r, 2, 8, 'PLAN DE TRABAJOS — CRONOGRAMA DE AVANCE E INVERSIONES', 12);
    r++;

    /* Datos de cierre del plan: el anticipo se cobra al inicio y se amortiza
       sobre cada certificado, así que sale de acá el (1 − anticipo) de los
       importes parciales. */
    const filaTotal = r;
    ws.getCell(r, 2).value = 'Total del presupuesto';
    negrita(ws, r, 2, 2);
    ws.getCell(r, 6).value = f(`=${ref.cyp.total}`);
    ws.getCell(r, 6).numFmt = FMT_ARS;
    r++;
    const filaAnticipoPct = r;
    ws.getCell(r, 2).value = 'Anticipo financiero';
    negrita(ws, r, 2, 2);
    ws.getCell(r, 6).value = plan.anticipoFrac || 0;
    ws.getCell(r, 6).numFmt = FMT_PCT;
    r++;
    const filaAnticipo = r;
    ws.getCell(r, 2).value = 'Anticipo';
    ws.getCell(r, 6).value = f(`=$F$${filaAnticipoPct}*$F$${filaTotal}`);
    ws.getCell(r, 6).numFmt = FMT_ARS;
    r++;
    ws.getCell(r, 2).value = 'Plazo de obra';
    const plural = unidad === 'Mes' ? 'meses' : 'semanas';
    ws.getCell(r, 6).value = `${n} ${n === 1 ? unidad.toLowerCase() : plural}`;
    r += 2;

    /* Cabecera: número de período arriba y fecha de arranque abajo. */
    const filaCab = r;
    cabecera(ws, r, 2, ['Ítem Nº', 'Designación', 'Unidad', 'Cant. contrato', 'Precio del ítem', 'Incid. %', '']);
    for (let i = 0; i < n; i++) {
      const cell = ws.getCell(r, colP0 + i);
      cell.value = `${i + 1}° ${unidad}`;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
    pintar(ws, r, colP0, colFin, GRIS_CABECERA);
    negrita(ws, r, colP0, colFin);
    bordear(ws, r, colP0, r, colFin, fuerteBorde);
    ws.getRow(r).height = 26;
    r++;
    ws.getCell(r, 8).value = 'Inicio de obra';
    ws.getCell(r, 8).font = { size: 8, color: { argb: GRIS_TEXTO } };
    for (let i = 0; i < n; i++) {
      const d = window.fechaPeriodoPlan(ctx.planConfig, i);
      const cell = ws.getCell(r, colP0 + i);
      if (d) {
        cell.value = d;
        cell.numFmt = 'dd/mm/yy';
      }
      cell.font = { size: 8, color: { argb: GRIS_TEXTO } };
      cell.alignment = { horizontal: 'center' };
    }
    bordear(ws, r, 2, r, colFin);
    r++;

    const primera = r;
    const filasRubro = [];

    // Obra sin rubros: el cronograma sale sólo con ítems, sin cabeceras de rubro.
    const plana = ctx.modelo.numeracion.sinRubros;

    plan.gruposRubro.forEach(g => {
      const filaRubro = r;
      if (!plana) {
        filasRubro.push(filaRubro);
        ws.getCell(r, 2).value = g.numero;
        ws.getCell(r, 2).alignment = { horizontal: 'center' };
        ws.getCell(r, 3).value = f(`=VLOOKUP($B${r},CyP!$B:$C,2,FALSE)`);
        ws.getCell(r, 6).value = f(`=VLOOKUP($B${r},CyP!$B:$G,6,FALSE)`);
        ws.getCell(r, 6).numFmt = FMT_ARS;
        ws.getCell(r, 7).value = f(`=+F${r}/$F$${filaTotal}`);
        ws.getCell(r, 7).numFmt = FMT_PCT;
        ws.getCell(r, 8).value = '% en Obra';
        pintar(ws, r, 2, colFin, GRIS_CABECERA);
        negrita(ws, r, 2, colFin);
        r++;
      }

      const itemsDesde = r;
      g.lineas.forEach(x => {
        const o = r;           // % en Obra
        const c = r + 1;       // % en Cant.
        const t = r + 2;       // % en Ítem  ← lo único que se carga a mano
        ref.plan.itemFila[x.key] = { o, c, t };
        ws.getCell(o, 2).value = x.numero;
        ws.getCell(o, 3).value = f(`=VLOOKUP($B${o},CyP!$B:$C,2,FALSE)`);
        ws.getCell(o, 3).alignment = { wrapText: true, vertical: 'middle' };
        ws.getCell(o, 4).value = f(`=VLOOKUP($B${o},CyP!$B:$D,3,FALSE)`);
        ws.getCell(o, 4).alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getCell(o, 5).value = f(`=VLOOKUP($B${o},CyP!$B:$E,4,FALSE)`);
        ws.getCell(o, 5).numFmt = FMT_CANT;
        ws.getCell(o, 6).value = f(`=VLOOKUP($B${o},CyP!$B:$G,6,FALSE)`);
        ws.getCell(o, 6).numFmt = FMT_ARS;
        ws.getCell(o, 7).value = f(`=+F${o}/$F$${filaTotal}`);
        ws.getCell(o, 7).numFmt = FMT_PCT;
        for (let k = 2; k <= 7; k++) ws.mergeCells(o, k, t, k);

        ws.getCell(o, 8).value = '% en Obra';
        ws.getCell(c, 8).value = '% en Cant.';
        ws.getCell(t, 8).value = '% en Ítem';
        [o, c, t].forEach(fila => { ws.getCell(fila, 8).font = { size: 8, color: { argb: GRIS_TEXTO } }; });
        negrita(ws, t, 8, 8);

        for (let i = 0; i < n; i++) {
          const L = col(i);
          ws.getCell(o, colP0 + i).value = f(`=+${L}${t}*$G${o}`);
          ws.getCell(o, colP0 + i).numFmt = FMT_PCT;
          ws.getCell(c, colP0 + i).value = f(`=+${L}${t}*$E${o}`);
          ws.getCell(c, colP0 + i).numFmt = FMT_CANT;
          const celda = ws.getCell(t, colP0 + i);
          celda.value = x.pctItem[i] || 0;
          celda.numFmt = '0.##%';
          celda.font = { bold: true };
        }
        bordear(ws, o, 2, t, colFin);
        r += 3;
      });

      // La cabecera del rubro suma el "% en Obra" de sus propios ítems: la
      // etiqueta de la columna H es la que distingue esas filas de las otras dos.
      const itemsHasta = r - 1;
      if (!plana) {
        for (let i = 0; i < n; i++) {
          const L = col(i);
          ws.getCell(filaRubro, colP0 + i).value = g.lineas.length
            ? f(`=SUMIF($H$${itemsDesde}:$H$${itemsHasta},"% en Obra",${L}$${itemsDesde}:${L}$${itemsHasta})`)
            : 0;
          ws.getCell(filaRubro, colP0 + i).numFmt = FMT_PCT;
        }
        bordear(ws, filaRubro, 2, filaRubro, colFin, fuerteBorde);
      }
    });

    const ultimaFilaItem = r - 1;
    if (r === primera) { ws.getCell(r, 2).value = 'Sin ítems en el Cómputo.'; r++; }
    r++;

    /* Pie: la certificación de cada período. El parcial en pesos amortiza el
       anticipo y el acumulado arranca justamente en el anticipo, que es lo que
       ya se cobró antes del primer certificado.

       Sin rubros no hay cabeceras que sumar, así que el parcial junta el
       "% en Obra" de todos los ítems de la hoja — el mismo SUMIF sobre la
       etiqueta de la columna H que usa cada cabecera de rubro. */
    const sumaRubros = plana
      ? (ultimaFilaItem >= primera
        ? L => `SUMIF($H$${primera}:$H$${ultimaFilaItem},"% en Obra",${L}$${primera}:${L}$${ultimaFilaItem})`
        : () => '0')
      : (filasRubro.length
        ? L => filasRubro.map(fr => `${L}${fr}`).join('+')
        : () => '0');

    const filaPie = (etiqueta, formulaDe, fmt, clase) => {
      const fila = r;
      ws.getCell(fila, 2).value = etiqueta;
      ws.mergeCells(fila, 2, fila, 8);
      for (let i = 0; i < n; i++) {
        const cell = ws.getCell(fila, colP0 + i);
        cell.value = f(formulaDe(col(i), i));
        cell.numFmt = fmt;
      }
      if (clase === 'total') {
        pintar(ws, fila, 2, colFin, AZUL);
        negrita(ws, fila, 2, colFin, 'FFFFFFFF');
      } else {
        pintar(ws, fila, 2, colFin, GRIS_SUAVE);
        negrita(ws, fila, 2, colFin);
      }
      bordear(ws, fila, 2, fila, colFin);
      r++;
      return fila;
    };

    const fParcialPct = filaPie('Certificación parcial %', L => `=${sumaRubros(L)}`, FMT_PCT);
    ref.plan.filaAcumPct = filaPie('Certificación acumulada %',
      (L, i) => (i === 0 ? `=${L}${fParcialPct}` : `=${col(i - 1)}${r}+${L}${fParcialPct}`), FMT_PCT);
    const fParcialM = filaPie('Certificación parcial ($)',
      L => `=${L}${fParcialPct}*$F$${filaTotal}*(1-$F$${filaAnticipoPct})`, FMT_ARS);
    const fAcumM = filaPie('Certificación acumulada ($)',
      (L, i) => (i === 0 ? `=$F$${filaAnticipo}+${L}${fParcialM}` : `=${col(i - 1)}${r}+${L}${fParcialM}`),
      FMT_ARS, 'total');
    ref.plan.filaRemanenteM = filaPie('Remanente ($)', L => `=$F$${filaTotal}-${L}${fAcumM}`, FMT_ARS);
    r++;

    // Las curvas, imagen fija pegada debajo del cronograma (ver la nota en
    // svgComoPng): filas en blanco reservadas a ojo, un renglón de Excel por
    // default mide ~20px.
    if (curvasImgs) {
      const ALTO_FILA_PX = 20;
      r++;
      r = titulo(ws, r, 2, 8, 'Plan de avance — acumulado y remanente', 10);
      ws.addImage(curvasImgs.avance.id, { tl: { col: 1, row: r - 1 }, ext: curvasImgs.avance.ext });
      r += Math.ceil(curvasImgs.avance.ext.height / ALTO_FILA_PX) + 2;

      r = titulo(ws, r, 2, 8, 'Curva de inversión — acumulado y remanente', 10);
      ws.addImage(curvasImgs.inversion.id, { tl: { col: 1, row: r - 1 }, ext: curvasImgs.inversion.ext });
      r += Math.ceil(curvasImgs.inversion.ext.height / ALTO_FILA_PX) + 2;
    }

    ws.views = [{ state: 'frozen', xSplit: 8, ySplit: filaCab + 1 }];
    ws.pageSetup = {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: `${filaCab}:${filaCab + 1}`,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    };
  }

  /* ===== Hoja Remanentes =====
     El contrario de "Plan de trabajos": no carga nada, lee de ahí con
     fórmulas (ref.plan, armado más arriba en hojaPlanTrabajos) cuánto le
     queda por ejecutar a cada ítem a partir de cada período — mismo layout
     ítem/rubro × período, sin la fila "% en Ítem" editable. Las columnas
     fijas (designación, unidad, cantidad, precio, incidencia) se traen del
     ítem en Plan de trabajos en vez de repetir el VLOOKUP contra CyP, así
     las dos hojas nunca pueden mostrar datos distintos del mismo ítem. */

  function hojaRemanentes(ws, ctx, ref, logoId) {
    const plan = ctx.plan;
    const { colP0, n, itemFila, filaAcumPct, filaRemanenteM } = ref.plan;
    const unidad = window.nombreUnidadPlan(ctx.planConfig);
    const HOJA_PLAN = "'Plan de trabajos'";

    ws.getColumn(1).width = 3;
    ws.getColumn(2).width = 10;
    ws.getColumn(3).width = 44;
    ws.getColumn(4).width = 9;
    ws.getColumn(5).width = 13;
    ws.getColumn(6).width = 22;
    ws.getColumn(7).width = 10;
    ws.getColumn(8).width = 18;
    for (let i = 0; i < n; i++) ws.getColumn(colP0 + i).width = 12;

    const colFin = colP0 + n - 1;
    const col = i => ws.getColumn(colP0 + i).letter;

    let r = membrete(ws, ctx, logoId, 8);
    r = titulo(ws, r, 2, 8, 'CUADRO DE REMANENTES — SALDO POR EJECUTAR POR ÍTEM', 12);
    ws.getCell(r, 2).value = 'El contrario del Plan de trabajos: cuánto le queda a cada ítem a partir de cada período. No se carga acá.';
    ws.getCell(r, 2).font = { italic: true, size: 8, color: { argb: GRIS_TEXTO } };
    r += 2;

    const filaCab = r;
    cabecera(ws, r, 2, ['Ítem Nº', 'Designación', 'Unidad', 'Cant. contrato', 'Precio del ítem', 'Incid. %', '']);
    for (let i = 0; i < n; i++) {
      const cell = ws.getCell(r, colP0 + i);
      cell.value = `${i + 1}° ${unidad}`;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
    pintar(ws, r, colP0, colFin, GRIS_CABECERA);
    negrita(ws, r, colP0, colFin);
    bordear(ws, r, colP0, r, colFin, fuerteBorde);
    ws.getRow(r).height = 26;
    r++;
    ws.getCell(r, 8).value = 'Inicio de obra';
    ws.getCell(r, 8).font = { size: 8, color: { argb: GRIS_TEXTO } };
    for (let i = 0; i < n; i++) {
      const d = window.fechaPeriodoPlan(ctx.planConfig, i);
      const cell = ws.getCell(r, colP0 + i);
      if (d) { cell.value = d; cell.numFmt = 'dd/mm/yy'; }
      cell.font = { size: 8, color: { argb: GRIS_TEXTO } };
      cell.alignment = { horizontal: 'center' };
    }
    bordear(ws, r, 2, r, colFin);
    r++;

    const primera = r;
    const plana = ctx.modelo.numeracion.sinRubros;

    plan.gruposRubro.forEach(g => {
      const filaRubro = r;
      const filasObraRubro = [];   // filas "% remanente en Obra" de los ítems de este rubro
      if (!plana) {
        ws.getCell(r, 2).value = g.numero;
        ws.getCell(r, 2).alignment = { horizontal: 'center' };
        ws.getCell(r, 3).value = f(`=VLOOKUP($B${r},CyP!$B:$C,2,FALSE)`);
        ws.getCell(r, 6).value = f(`=VLOOKUP($B${r},CyP!$B:$G,6,FALSE)`);
        ws.getCell(r, 6).numFmt = FMT_ARS;
        ws.getCell(r, 7).value = f(`=+F${r}/${ref.cyp.total}`);
        ws.getCell(r, 7).numFmt = FMT_PCT;
        ws.getCell(r, 8).value = '% remanente en Obra';
        pintar(ws, r, 2, colFin, GRIS_CABECERA);
        negrita(ws, r, 2, colFin);
        r++;
      }

      g.lineas.forEach(x => {
        const orig = itemFila[x.key];
        const rt = r;       // % remanente (principal)
        const ro = r + 1;   // % remanente en Obra
        const rc = r + 2;   // Cantidad remanente
        const rm = r + 3;   // Monto remanente
        filasObraRubro.push(ro);

        ws.getCell(rt, 2).value = x.numero;
        ws.getCell(rt, 3).value = f(`=${HOJA_PLAN}!C${orig.o}`);
        ws.getCell(rt, 3).alignment = { wrapText: true, vertical: 'middle' };
        ws.getCell(rt, 4).value = f(`=${HOJA_PLAN}!D${orig.o}`);
        ws.getCell(rt, 4).alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getCell(rt, 5).value = f(`=${HOJA_PLAN}!E${orig.o}`);
        ws.getCell(rt, 5).numFmt = FMT_CANT;
        ws.getCell(rt, 6).value = f(`=${HOJA_PLAN}!F${orig.o}`);
        ws.getCell(rt, 6).numFmt = FMT_ARS;
        ws.getCell(rt, 7).value = f(`=${HOJA_PLAN}!G${orig.o}`);
        ws.getCell(rt, 7).numFmt = FMT_PCT;
        for (let k = 2; k <= 7; k++) ws.mergeCells(rt, k, rm, k);

        ws.getCell(rt, 8).value = '% remanente';
        ws.getCell(ro, 8).value = '% remanente en Obra';
        ws.getCell(rc, 8).value = 'Cantidad remanente';
        ws.getCell(rm, 8).value = 'Monto remanente';
        [rt, ro, rc, rm].forEach(fila => { ws.getCell(fila, 8).font = { size: 8, color: { argb: GRIS_TEXTO } }; });
        negrita(ws, rt, 8, 8);

        for (let i = 0; i < n; i++) {
          const L = col(i);
          // 1 − lo acumulado del ítem hasta este período, leído de la fila
          // "% en Ítem" (orig.t) de Plan de trabajos — la única celda que ahí
          // se carga a mano.
          const celdaRt = ws.getCell(rt, colP0 + i);
          celdaRt.value = f(`=1-SUM(${HOJA_PLAN}!$${col(0)}$${orig.t}:$${L}$${orig.t})`);
          celdaRt.numFmt = '0.##%';
          celdaRt.font = { bold: true };

          ws.getCell(ro, colP0 + i).value = f(`=+${L}${rt}*${HOJA_PLAN}!$G$${orig.o}`);
          ws.getCell(ro, colP0 + i).numFmt = FMT_PCT;
          ws.getCell(rc, colP0 + i).value = f(`=+${L}${rt}*${HOJA_PLAN}!$E$${orig.o}`);
          ws.getCell(rc, colP0 + i).numFmt = FMT_CANT;
          ws.getCell(rm, colP0 + i).value = f(`=+${L}${rt}*${HOJA_PLAN}!$F$${orig.o}`);
          ws.getCell(rm, colP0 + i).numFmt = FMT_ARS;
        }
        bordear(ws, rt, 2, rm, colFin);
        r += 4;
      });

      if (!plana) {
        for (let i = 0; i < n; i++) {
          const L = col(i);
          ws.getCell(filaRubro, colP0 + i).value = filasObraRubro.length
            ? f(`=${filasObraRubro.map(fr => `${L}${fr}`).join('+')}`)
            : 0;
          ws.getCell(filaRubro, colP0 + i).numFmt = FMT_PCT;
        }
        bordear(ws, filaRubro, 2, filaRubro, colFin, fuerteBorde);
      }
    });

    if (r === primera) { ws.getCell(r, 2).value = 'Sin ítems en el Cómputo.'; r++; }
    r++;

    const filaPieR = (etiqueta, formulaDe, fmt, clase) => {
      const fila = r;
      ws.getCell(fila, 2).value = etiqueta;
      ws.mergeCells(fila, 2, fila, 8);
      for (let i = 0; i < n; i++) {
        const cell = ws.getCell(fila, colP0 + i);
        cell.value = f(formulaDe(col(i)));
        cell.numFmt = fmt;
      }
      if (clase === 'total') { pintar(ws, fila, 2, colFin, AZUL); negrita(ws, fila, 2, colFin, 'FFFFFFFF'); }
      else { pintar(ws, fila, 2, colFin, GRIS_SUAVE); negrita(ws, fila, 2, colFin); }
      bordear(ws, fila, 2, fila, colFin);
      r++;
      return fila;
    };

    // Mismos números que el pie de Plan de trabajos, en las dos unidades: si
    // alguna vez no coinciden es que se rompió una de las dos fórmulas.
    filaPieR('Remanente total %', L => `=1-${HOJA_PLAN}!${L}${filaAcumPct}`, FMT_PCT);
    filaPieR('Remanente total ($)', L => `=${HOJA_PLAN}!${L}${filaRemanenteM}`, FMT_ARS, 'total');

    ws.views = [{ state: 'frozen', xSplit: 8, ySplit: filaCab + 1 }];
    ws.pageSetup = {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: `${filaCab}:${filaCab + 1}`,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    };
  }

  /* ===== Armado y descarga ===== */

  const nombreArchivo = obra =>
    `Presupuesto - ${(obra.nombre || 'obra').replace(/[\\/:*?"<>|]/g, '-').trim()}.xlsx`;

  window.descargarExcelObra = async function (ctx) {
    const ExcelJS = await cargarExcelJS();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'VIMECO S.A. — Sistema de Gestión';
    wb.created = new Date();
    // Sin valores cacheados en el archivo: Excel recalcula todo al abrirlo.
    wb.calcProperties.fullCalcOnLoad = true;

    // ctx.logo es el logo elegido en Exportar (por defecto el de VIMECO, ver
    // logoActual() en exportar.js); puede ser PNG o JPG según lo que se suba.
    const logoMatch = /^data:image\/(png|jpe?g);base64,(.*)$/is.exec(ctx.logo || LOGO_BASE64);
    const logoExtension = logoMatch ? logoMatch[1].toLowerCase().replace('jpg', 'jpeg') : 'png';
    const logoBase64 = logoMatch ? logoMatch[2] : LOGO_BASE64.split(',')[1];
    const logoId = wb.addImage({ base64: logoBase64, extension: logoExtension });

    // Igual que hayPlanCargado() en js/exportar.js: un plan recién creado ya
    // tiene 12 semanas vacías por default, así que "hay plan" es que se haya
    // cargado al menos un punto de avance, no que el objeto exista.
    const hayPlanCargado = ctx.plan && ctx.plan.acumPct.some(v => v > 0);
    let curvasImgs = null;
    if (hayPlanCargado) {
      const unidad = window.nombreUnidadPlan(ctx.planConfig);
      const ANCHO_CURVA_PX = 680;
      const [avance, inversion] = await Promise.all([
        svgComoPng(window.svgPlanAvance(ctx.plan, { unidad }), ANCHO_CURVA_PX),
        svgComoPng(window.svgCurvaInversion(ctx.plan, { unidad, fmtMonto: window.fmtARS }), ANCHO_CURVA_PX),
      ]);
      curvasImgs = {
        avance: { id: wb.addImage({ base64: avance.base64, extension: 'png' }), ext: { width: avance.width, height: avance.height } },
        inversion: { id: wb.addImage({ base64: inversion.base64, extension: 'png' }), ext: { width: inversion.width, height: inversion.height } },
      };
    }

    // Las hojas se crean en el orden en que se leen; se llenan después, en el
    // orden en que se necesitan las direcciones de celda de las anteriores.
    // Una obra sin rubros no tiene Resumen por rubro que mostrar (igual que en
    // el papel, ver seccionesDisponibles() en js/exportar.js).
    const hojas = {
      resumen: ctx.modelo.numeracion.sinRubros ? null : wb.addWorksheet('Resumen'),
      cyp: wb.addWorksheet('CyP'),
      ap: wb.addWorksheet('A.P'),
      apAux: ctx.modelo.auxiliares.length ? wb.addWorksheet('A.P auxiliares') : null,
      plan: ctx.plan ? wb.addWorksheet('Plan de trabajos') : null,
      remanentes: ctx.plan ? wb.addWorksheet('Remanentes') : null,
      cargafija: wb.addWorksheet('Carga fija'),
      materiales: wb.addWorksheet('Materiales'),
      equipos: wb.addWorksheet('Equipos'),
      datos: wb.addWorksheet('Datos'),
    };

    const ref = {};
    hojaDatos(hojas.datos, ctx, ref);
    hojaMateriales(hojas.materiales, ctx, ref);
    hojaEquipos(hojas.equipos, ctx, ref);
    // ref.auxiliares se arma ANTES de escribir la hoja A.P (un ítem del
    // Cómputo puede usar un auxiliar como insumo) y ANTES de A.P auxiliares
    // (un auxiliar puede usar a otro) — a diferencia de ref.ap (que sale de
    // recorrer hojaAP y se conoce recién después), acá el rango se estima
    // generoso de entrada, no hace falta que sea exacto. Los valores reales
    // los escribe hojaAPAuxiliares más abajo, en cualquier orden: una fórmula
    // que apunta a una celda que se llena después en el mismo libro anda
    // igual — Excel no recalcula hasta abrirlo.
    if (hojas.apAux) {
      const hastaAux = Math.max(ctx.modelo.auxiliares.length * 40 + 200, 300);
      ref.auxiliares = {
        rangoCodigos: `${HOJA_APAUX}!$C$2:$C$${hastaAux}`,
        rangoSubtotales: `${HOJA_APAUX}!$K$2:$K$${hastaAux}`,
      };
    }
    hojaAP(hojas.ap, ctx, ref);
    if (hojas.apAux) hojaAPAuxiliares(hojas.apAux, ctx, ref);
    hojaCyP(hojas.cyp, ctx, ref, logoId);
    hojaCargaFija(hojas.cargafija, ctx, ref);
    if (hojas.plan) hojaPlanTrabajos(hojas.plan, ctx, ref, logoId, curvasImgs);
    if (hojas.remanentes) hojaRemanentes(hojas.remanentes, ctx, ref, logoId);
    if (hojas.resumen) hojaResumen(hojas.resumen, ctx, ref, logoId);

    // Último eslabón: los Gastos Generales del Coeficiente K son el total de la
    // hoja Carga fija prorrateado sobre el costo del Cómputo. Recién se puede
    // escribir cuando existen las dos hojas. No hay círculo: el costo del
    // Cómputo son los análisis de precio sin K.
    //
    // Salvo que haya conceptos calculados sobre el presupuesto propio: ahí ese
    // total sí depende del K y Excel rechazaría la referencia circular. Se
    // escribe entonces la misma cuenta ya despejada — el desarrollo está en
    // calcCargaFija() (js/calcCostos.js):
    //
    //             1 + %Beneficio + GastosIndependientes/CostoCómputo
    //   Subtotal = ─────────────────────────────────────────────────────
    //              1 − (1+%Fin)·[ q_s·(1+%otros) + q_c·(1+%otros+%IVA) ]
    //
    //   %GG = Subtotal − 1 − %Beneficio
    //
    // Ninguna celda de esa fórmula depende del K, así que la cadena queda
    // abierta: %GG → K → precios → los conceptos sobre el presupuesto.
    if (!ref.ggEsManual) {
      const celda = hojas.datos.getCell(ref.filaGG, 3);
      if (ref.cargaFija.hayCeldasSobrePrecio) {
        const c = ref.coef;
        const numerador = `(1+${c.beneficio}+${ref.cargaFija.gastosIndependientes}/${ref.cyp.costoComputo})`;
        const divisor = `(1-(1+${c.financiero})*(${ref.cargaFija.qSinIva}*(1+${c.pctOtrosImpuestos})`
          + `+${ref.cargaFija.qConIva}*(1+${c.pctOtrosImpuestos}+${c.pctIva})))`;
        celda.value = f(`=${numerador}/${divisor}-1-${c.beneficio}`);
      } else {
        celda.value = f(`=${ref.cargaFija.total}/${ref.cyp.costoComputo}`);
      }
      celda.numFmt = FMT_PCT;
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo(ctx.modelo.obra);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
})();
