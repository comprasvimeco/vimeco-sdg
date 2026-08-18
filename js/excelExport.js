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
    ref.consumo     = `Datos!$C$${dato('Consumo', num(pe.combustibleLtsPorHp), 'lts/HP·hora', '#,##0.000')}`;
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
    bordear(ws, filaK0, 2, r, 4);
    r++;
  }

  /* ===== Hoja Materiales =====
     El catálogo entero con el precio que rige para esta obra: el propio de la
     obra si lo tiene cargado, si no el más reciente de todas (lo mismo que
     resuelve resolverPreciosObra para la pantalla). El precio en pesos es la
     fuente de verdad; sólo cuando el material no lo tiene guardado se
     reconstruye desde el dólar, y ahí sí queda como fórmula. */

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

    const materiales = m.catalogos.materiales.slice()
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    const nombres = nombresUnicos(materiales, e => e.nombre);

    const primera = r;
    materiales.forEach(mat => {
      const precio = m.preciosObra[mat.key] || null;
      ws.getCell(r, 2).value = nombres[mat.key];
      ws.getCell(r, 3).value = mat.unidad || '';
      ws.getCell(r, 3).alignment = { horizontal: 'center' };
      ws.getCell(r, 4).value = precio ? num(precio.precioUSD) : null;
      ws.getCell(r, 4).numFmt = FMT_CANT;
      // Sin precioARS guardado (datos anteriores al campo dual) el precio en
      // pesos sale del dólar de la obra, igual que en calcCostoUnitarioItem.
      ws.getCell(r, 5).value = precio && precio.precioARS != null
        ? num(precio.precioARS)
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

    if (r === primera) { ws.getCell(r, 2).value = 'Sin materiales en la Biblioteca.'; r++; }
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
     parámetros de la hoja Datos. El A.P después sólo busca el costo diario.

     Un equipo al que le falte costo, vida útil o uso anual no cuesta nada en
     el sistema (la línea del análisis se descarta), así que acá va en cero y
     sin desglose: poner las fórmulas daría #¡DIV/0! y ensuciaría todo el libro. */

  function hojaEquipos(ws, ctx, ref) {
    const m = ctx.modelo;
    const hayDolar = m.dolarObra != null;

    ws.getColumn(1).width = 4;
    ws.getColumn(2).width = 42;
    [11, 12, 12, 14, 16, 15, 14, 15, 15, 14, 17].forEach((w, i) => { ws.getColumn(3 + i).width = w; });

    let r = 2;
    r = titulo(ws, r, 2, 13, 'EQUIPOS', 13) + 1;

    const filaCab = r;
    cabecera(ws, r, 2, ['Designación', 'Potencia\nHP', 'Uso anual\nHs', 'Vida útil\nHs',
      'Costo actual\nU$D', 'Costo actual\n$', 'Amortización\n$/día', 'Intereses\n$/día',
      'Reparaciones\n$/día', 'Combustible\n$/día', 'Lubricantes\n$/día', 'Costo diario\n$']);
    ws.getRow(r).height = 32;
    r++;

    const equipos = m.catalogos.equipos.slice()
      .sort((a, b) => `${a.tipo || ''} ${a.codigo || ''}`.localeCompare(`${b.tipo || ''} ${b.codigo || ''}`, 'es'));
    const nombres = nombresUnicos(equipos, e => `${e.tipo || ''} ${e.codigo || ''}`.trim());

    const primera = r;
    equipos.forEach(eq => {
      const completo = hayDolar && !!eq.costoUSD && !!eq.vidaUtil && !!eq.usoAnual;
      ws.getCell(r, 2).value = nombres[eq.key];
      ws.getCell(r, 3).value = num(eq.potencia) || 0;
      ws.getCell(r, 3).numFmt = '#,##0.##';
      ws.getCell(r, 4).value = num(eq.usoAnual);
      ws.getCell(r, 5).value = num(eq.vidaUtil);
      ws.getCell(r, 6).value = num(eq.costoUSD);
      ws.getCell(r, 6).numFmt = FMT_CANT;
      if (completo) {
        ws.getCell(r, 7).value  = f(`=F${r}*${ref.dolar}`);                                  // costo actual $
        ws.getCell(r, 8).value  = f(`=G${r}*${ref.jornada}/E${r}`);                           // amortización
        ws.getCell(r, 9).value  = f(`=G${r}*${ref.tasaInteres}/2/D${r}*${ref.jornada}`);      // intereses
        ws.getCell(r, 10).value = f(`=H${r}*${ref.reparaciones}`);                            // reparaciones
        ws.getCell(r, 11).value = f(`=(${ref.consumo}*C${r}*${ref.jornada})*${ref.combustible}`);
        ws.getCell(r, 12).value = f(`=K${r}*${ref.lubricantes}`);                             // lubricantes
        ws.getCell(r, 13).value = f(`=H${r}+I${r}+J${r}+K${r}+L${r}`);
      } else {
        ws.getCell(r, 13).value = 0;
      }
      for (let c = 7; c <= 13; c++) ws.getCell(r, c).numFmt = FMT_ARS;
      negrita(ws, r, 13, 13);
      r++;
    });

    if (r === primera) { ws.getCell(r, 2).value = 'Sin equipos en la Biblioteca.'; r++; }
    const ultima = r - 1;
    bordear(ws, primera, 2, ultima, 13);

    ws.views = [{ state: 'frozen', ySplit: filaCab, xSplit: 2 }];
    ws.autoFilter = { from: { row: filaCab, column: 2 }, to: { row: ultima, column: 13 } };

    ref.equipos = {
      nombres,
      rango: `Equipos!$B$${primera}:$M$${ultima}`,
      colPotencia: 2,   // C, contando desde B
      colCosto: 12,     // M
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

  function hojaAP(ws, ctx, ref) {
    const m = ctx.modelo;

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

    let r = 2;
    ref.ap = {};

    const lineas = m.rubros.flatMap(ru => ru.lineas);
    lineas.forEach(linea => {
      const ap = window.analisisDePrecioDe(m, linea.itemKey);
      const filaCodigo = r;

      ws.getCell(r, 2).value = 'Ítem:';
      negrita(ws, r, 2, 2);
      ws.getCell(r, 3).value = linea.numero;
      ws.getCell(r, 3).font = { bold: true, size: 12, color: { argb: AZUL } };
      ws.getCell(r, 10).value = 'Precio unitario';
      ws.getCell(r, 10).alignment = { horizontal: 'right' };
      ws.getCell(r, 12).value = 'Costo unitario';
      ws.getCell(r, 12).alignment = { horizontal: 'right' };
      r++;

      ws.getCell(r, 2).value = 'Descripción:';
      ws.getCell(r, 3).value = f(`=VLOOKUP(C${filaCodigo},CyP!$B:$C,2,FALSE)`);
      ws.getCell(r, 3).alignment = { wrapText: true, vertical: 'top' };
      ws.getCell(r, 10).value = 'Unidad:';
      ws.getCell(r, 10).alignment = { horizontal: 'right' };
      ws.getCell(r, 11).value = f(`=VLOOKUP(C${filaCodigo},CyP!$B:$D,3,FALSE)`);
      ws.getCell(r, 11).alignment = { horizontal: 'center' };
      r++;

      if (!ap) {
        ws.getCell(r, 3).value = 'Este ítem todavía no tiene un análisis de precio cargado.';
        ws.getCell(r, 3).font = { italic: true, color: { argb: GRIS_TEXTO } };
        ws.getCell(filaCodigo, 11).value = 0;
        ws.getCell(filaCodigo, 11).numFmt = FMT_ARS;
        ws.getCell(filaCodigo, 12).value = 0;
        ws.getCell(filaCodigo, 12).numFmt = FMT_ARS;
        r += 3;
        return;
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
      r++;
      ws.getCell(r, 2).value = 'Carga Fija';
      ws.getCell(r, 9).value = f(`=${ref.k}`);
      ws.getCell(r, 9).numFmt = FMT_COEF;
      r++;
      ws.getCell(r, 2).value = 'PRECIO UNITARIO';
      ws.getCell(r, 9).value = f(`=I${filaSub}*I${r - 1}`);
      ws.getCell(r, 9).numFmt = FMT_ARS;
      pintar(ws, r, 2, 9, AZUL);
      negrita(ws, r, 2, 9, 'FFFFFFFF');

      // Las dos celdas que lee CyP, en la fila del código.
      ws.getCell(filaCodigo, 11).value = f(`=I${r}`);
      ws.getCell(filaCodigo, 11).numFmt = FMT_ARS;
      ws.getCell(filaCodigo, 12).value = f(`=I${filaSub}`);
      ws.getCell(filaCodigo, 12).numFmt = FMT_ARS;
      r += 3;
    });

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

    const primera = r;
    // El total se escribe recién al final, pero las incidencias lo necesitan:
    // se calcula la fila de antemano contando lo que se va a escribir.
    const cantidadFilas = m.rubros.reduce((acc, ru) => acc + 1 + ru.lineas.length, 0);
    const filaTotal = primera + Math.max(cantidadFilas, 1) + 1;   // sin rubros queda la fila del aviso
    const ultima = filaTotal - 2;
    const rangoCod = `$B$${primera}:$B$${ultima}`;
    const rangoImp = `$G$${primera}:$G$${ultima}`;

    m.rubros.forEach(rubro => {
      const filaRubro = r;
      // El código va como texto, no como número: con la numeración
      // personalizada puede ser "I" o "01" (ver js/numeracion.js). Los dos lados
      // de cada VLOOKUP que lo busca quedan texto contra texto, que es la única
      // forma de que el match exacto siga encontrándolo.
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
        ws.getCell(r, 7).value = f(`=+E${r}*F${r}`);
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
      ws.getCell(r, 2).value = 'Sin rubros cargados en el Cómputo.';
      r++;
    }
    bordear(ws, primera, 2, Math.max(r - 1, primera), 10);

    r = filaTotal;
    ws.getCell(r, 2).value = 'PRESUPUESTO TOTAL';
    ws.mergeCells(r, 2, r, 6);
    // "*.*" toma sólo los códigos de ítem (los de rubro son números, sin punto).
    ws.getCell(r, 7).value = f(`=SUMIF(${rangoCod},"*.*",${rangoImp})`);
    ws.getCell(r, 7).numFmt = FMT_ARS;
    ws.getCell(r, 8).value = f(`=IFERROR(G${r}/$G$${r},0)`);
    ws.getCell(r, 8).numFmt = FMT_PCT;
    ws.getCell(r, 10).value = f(`=SUMIF(${rangoCod},"*.*",$J$${primera}:$J$${ultima})`);
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
     (cantidad × precio × meses) o un porcentaje del costo del Cómputo o del
     presupuesto oficial.

     El total de esta hoja es lo que la hoja Datos prorratea sobre el costo del
     Cómputo para sacar el % de Gastos Generales del Coeficiente K, así que
     agregar un concepto acá mueve el K y con él todo el presupuesto. */

  const BASE_PCT = {
    pctComputo: 'del costo del Cómputo',
    pctOficial: 'del presupuesto oficial',
  };

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
    r++;

    const filaCab = r;
    cabecera(ws, r, 2, ['Concepto', 'Cantidad', 'Precio unitario', 'Meses', '%', 'Base', 'Total', 'Incid. %']);
    ws.getRow(r).height = 26;
    r++;

    const conceptos = window.lineasCargaFijaOrdenadas(cf.lineas);
    const primera = r;
    const filaTotal = primera + Math.max(conceptos.length, 1) + 1;

    conceptos.forEach(([, l]) => {
      const tipo = l.tipo || 'monto';
      ws.getCell(r, 2).value = l.concepto || '(sin nombre)';
      ws.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
      if (tipo === 'pctComputo' || tipo === 'pctOficial') {
        ws.getCell(r, 6).value = num(l.porcentaje) / 100;
        ws.getCell(r, 6).numFmt = FMT_PCT;
        ws.getCell(r, 7).value = BASE_PCT[tipo];
        ws.getCell(r, 7).font = { size: 9, color: { argb: GRIS_TEXTO } };
        ws.getCell(r, 8).value = f(`=+F${r}*$C$${tipo === 'pctComputo' ? filaCosto : filaOficial}`);
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

    ws.getCell(r, 2).value = 'El % de Gastos Generales de la Carga Fija sale de este total dividido por el costo del Cómputo. Ver la hoja Datos.';
    ws.getCell(r, 2).font = { size: 9, italic: true, color: { argb: GRIS_TEXTO } };
    ws.mergeCells(r, 2, r, 9);

    ws.views = [{ state: 'frozen', ySplit: filaCab }];
    ws.pageSetup = {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    };

    ref.cargaFija = { total: `'Carga fija'!$H$${filaTotal}` };
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

  function hojaPlanTrabajos(ws, ctx, ref, logoId) {
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

    plan.gruposRubro.forEach(g => {
      const filaRubro = r;
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

      const itemsDesde = r;
      g.lineas.forEach(x => {
        const o = r;           // % en Obra
        const c = r + 1;       // % en Cant.
        const t = r + 2;       // % en Ítem  ← lo único que se carga a mano
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
      for (let i = 0; i < n; i++) {
        const L = col(i);
        ws.getCell(filaRubro, colP0 + i).value = g.lineas.length
          ? f(`=SUMIF($H$${itemsDesde}:$H$${itemsHasta},"% en Obra",${L}$${itemsDesde}:${L}$${itemsHasta})`)
          : 0;
        ws.getCell(filaRubro, colP0 + i).numFmt = FMT_PCT;
      }
      bordear(ws, filaRubro, 2, filaRubro, colFin, fuerteBorde);
    });

    if (r === primera) { ws.getCell(r, 2).value = 'Sin ítems en el Cómputo.'; r++; }
    r++;

    /* Pie: la certificación de cada período. El parcial en pesos amortiza el
       anticipo y el acumulado arranca justamente en el anticipo, que es lo que
       ya se cobró antes del primer certificado. */
    const sumaRubros = filasRubro.length
      ? L => filasRubro.map(fr => `${L}${fr}`).join('+')
      : () => '0';

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
    filaPie('Certificación acumulada %',
      (L, i) => (i === 0 ? `=${L}${fParcialPct}` : `=${col(i - 1)}${r}+${L}${fParcialPct}`), FMT_PCT);
    const fParcialM = filaPie('Certificación parcial ($)',
      L => `=${L}${fParcialPct}*$F$${filaTotal}*(1-$F$${filaAnticipoPct})`, FMT_ARS);
    const fAcumM = filaPie('Certificación acumulada ($)',
      (L, i) => (i === 0 ? `=$F$${filaAnticipo}+${L}${fParcialM}` : `=${col(i - 1)}${r}+${L}${fParcialM}`),
      FMT_ARS, 'total');
    filaPie('Remanente ($)', L => `=$F$${filaTotal}-${L}${fAcumM}`, FMT_ARS);

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

    const logoId = wb.addImage({ base64: LOGO_BASE64.split(',')[1], extension: 'png' });

    // Las hojas se crean en el orden en que se leen; se llenan después, en el
    // orden en que se necesitan las direcciones de celda de las anteriores.
    const hojas = {
      resumen: wb.addWorksheet('Resumen'),
      cyp: wb.addWorksheet('CyP'),
      ap: wb.addWorksheet('A.P'),
      plan: ctx.plan ? wb.addWorksheet('Plan de trabajos') : null,
      cargafija: wb.addWorksheet('Carga fija'),
      materiales: wb.addWorksheet('Materiales'),
      equipos: wb.addWorksheet('Equipos'),
      datos: wb.addWorksheet('Datos'),
    };

    const ref = {};
    hojaDatos(hojas.datos, ctx, ref);
    hojaMateriales(hojas.materiales, ctx, ref);
    hojaEquipos(hojas.equipos, ctx, ref);
    hojaAP(hojas.ap, ctx, ref);
    hojaCyP(hojas.cyp, ctx, ref, logoId);
    hojaCargaFija(hojas.cargafija, ctx, ref);
    if (hojas.plan) hojaPlanTrabajos(hojas.plan, ctx, ref, logoId);
    hojaResumen(hojas.resumen, ctx, ref, logoId);

    // Último eslabón: los Gastos Generales del Coeficiente K son el total de la
    // hoja Carga fija prorrateado sobre el costo del Cómputo. Recién se puede
    // escribir cuando existen las dos hojas. No hay círculo: el costo del
    // Cómputo son los análisis de precio sin K.
    if (!ref.ggEsManual) {
      const celda = hojas.datos.getCell(ref.filaGG, 3);
      celda.value = f(`=${ref.cargaFija.total}/${ref.cyp.costoComputo}`);
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
