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

  // Cierre de hoja: notas al pie, lugar y fecha.
  function pie(ws, r, ctx, colFin, conNotas) {
    r++;
    if (conNotas && ctx.notas && ctx.notas.trim()) {
      ctx.notas.split('\n').forEach(linea => {
        const cell = ws.getCell(r, 2);
        cell.value = linea;
        cell.font = { size: 8, color: { argb: GRIS_TEXTO } };
        if (colFin > 2) ws.mergeCells(r, 2, r, colFin);
        r++;
      });
      r++;
    }
    if (ctx.lugar || ctx.fechaLarga) {
      ws.getCell(r, 2).value = `${ctx.lugar}${ctx.lugar && ctx.fechaLarga ? ', ' : ''}${ctx.fechaLarga}.`;
      ws.getCell(r, 2).font = { size: 9 };
      r += 2;
    }
    ws.getCell(r, 2).value = ctx.oferente;
    ws.getCell(r, 2).font = { bold: true, size: 9 };
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
    r = titulo(ws, r, 2, 4, 'COEFICIENTE K', 12);
    cabecera(ws, r, 2, ['Concepto', '%', 'Aporte al K']);
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
    ws.getCell(r, 2).value = 'COEFICIENTE K';
    ws.getCell(r, 4).value = f(rangoImp ? `=D${rSubF}*(1+SUM(${rangoImp}))` : `=D${rSubF}`);
    ws.getCell(r, 4).numFmt = FMT_COEF;
    pintar(ws, r, 2, 4, AZUL);
    negrita(ws, r, 2, 4, 'FFFFFFFF');
    ws.mergeCells(r, 2, r, 3);
    ref.k = `Datos!$D$${r}`;
    ref.ggPct = `Datos!$C$${rGG}`;
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
      colCosto: 12,   // M, contando desde B
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

    let r = membrete(ws, ctx, logoId, 8);
    r = titulo(ws, r, 2, 8, 'DETALLE DE LA PROPUESTA DISCRIMINADA POR ÍTEM', 12);
    r++;

    const filaCab = r;
    cabecera(ws, r, 2, ['Ítem Nº', 'Denominación', 'Un.', 'Cantidad', 'Precio', 'Importe ($)', 'Incid. %']);
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
      ws.getCell(r, 2).value = Number(rubro.numero);
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
      ws.getCell(r, 8).value = f(`=G${r}/$G$${filaTotal}`);
      ws.getCell(r, 8).numFmt = FMT_PCT;
      pintar(ws, r, 2, 8, GRIS_CABECERA);
      negrita(ws, r, 2, 8);
      r++;

      rubro.lineas.forEach(l => {
        ws.getCell(r, 2).value = l.numero;                 // texto: "3.1"
        ws.getCell(r, 3).value = l.nombre || '';
        ws.getCell(r, 3).alignment = { wrapText: true, vertical: 'top' };
        ws.getCell(r, 4).value = l.unidad || '';
        ws.getCell(r, 4).alignment = { horizontal: 'center' };
        ws.getCell(r, 5).value = num(l.cantidad);
        ws.getCell(r, 5).numFmt = FMT_CANT;
        // Precio unitario: valor mientras no exista la hoja A.P; pasa a
        // INDEX/MATCH contra el análisis de precio del ítem cuando se agrega.
        ws.getCell(r, 6).value = num(l.precioUnitario);
        ws.getCell(r, 6).numFmt = FMT_ARS;
        ws.getCell(r, 7).value = f(`=+E${r}*F${r}`);
        ws.getCell(r, 7).numFmt = FMT_ARS;
        ws.getCell(r, 8).value = f(`=G${r}/$G$${filaTotal}`);
        ws.getCell(r, 8).numFmt = FMT_PCT;
        r++;
      });
    });

    if (r === primera) {
      ws.getCell(r, 2).value = 'Sin rubros cargados en el Cómputo.';
      r++;
    }
    bordear(ws, primera, 2, Math.max(r - 1, primera), 8);

    r = filaTotal;
    ws.getCell(r, 2).value = 'PRESUPUESTO TOTAL';
    ws.mergeCells(r, 2, r, 6);
    // "*.*" toma sólo los códigos de ítem (los de rubro son números, sin punto).
    ws.getCell(r, 7).value = f(`=SUMIF(${rangoCod},"*.*",${rangoImp})`);
    ws.getCell(r, 7).numFmt = FMT_ARS;
    ws.getCell(r, 8).value = f(`=G${r}/$G$${r}`);
    ws.getCell(r, 8).numFmt = FMT_PCT;
    pintar(ws, r, 2, 8, AZUL);
    negrita(ws, r, 2, 8, 'FFFFFFFF');
    bordear(ws, r, 2, r, 8, fuerteBorde);

    ws.views = [{ state: 'frozen', ySplit: filaCab }];
    ws.pageSetup = {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: `${filaCab}:${filaCab}`,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    };

    ref.cyp = { primera, ultima, filaTotal, total: `CyP!$G$${filaTotal}` };
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
      ws.getCell(r, 2).value = Number(rubro.numero);
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
      ws.getCell(r, 8).value = f(`=+G${r}/$G$${filaTotal}`);
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

    pie(ws, r, ctx, 8, true);

    ws.views = [{ state: 'frozen', ySplit: filaCab }];
    ws.pageSetup = {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    };

    ref.resumen = { primera, ultima, filaTotal };
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
      materiales: wb.addWorksheet('Materiales'),
      equipos: wb.addWorksheet('Equipos'),
      datos: wb.addWorksheet('Datos'),
    };

    const ref = {};
    hojaDatos(hojas.datos, ctx, ref);
    hojaMateriales(hojas.materiales, ctx, ref);
    hojaEquipos(hojas.equipos, ctx, ref);
    hojaCyP(hojas.cyp, ctx, ref, logoId);
    hojaResumen(hojas.resumen, ctx, ref, logoId);

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
