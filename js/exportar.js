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

const OFERENTE = 'VIMECO S.A.';
const DOMICILIO = 'Bv. Rivadavia Nº 3450 — Bº Los Boulevares — Córdoba';

const NOTAS_DEFAULT =
  '* Los precios indicados incluyen IVA, Beneficios, Costos Directos e Indirectos, y todo otro gasto necesario para la correcta ejecución de los trabajos.\n' +
  '** En todos los ítems se cotiza de acuerdo a lo detallado en el Pliego de Especificaciones Técnicas y en la documentación gráfica del proyecto.';

const SECCIONES = [
  { id: 'resumen',     label: 'Resumen por rubro', render: seccionResumen },
  { id: 'presupuesto', label: 'Presupuesto detallado', render: seccionPresupuesto },
];

let modelo = null;
let config = { lugar: '', fecha: '', notas: null };
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

function fechaLarga(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-').map(Number);
  if (!a || !m || !d) return iso;
  // Mediodía para que ningún huso corra el día al formatear.
  return new Date(a, m - 1, d, 12).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function hoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

function membrete(titulo) {
  const filas = window.membreteDeObra(modelo)
    .concat([{ etiqueta: 'OFERENTE', valor: OFERENTE }, { etiqueta: 'DOMICILIO', valor: DOMICILIO }]);
  return `
    <div class="doc-membrete">
      <div class="doc-membrete-logo"><img src="${LOGO_BASE64}" alt="VIMECO S.A."></div>
      <dl class="doc-membrete-datos">
        ${filas.map(f => `<dt>${escHtml(f.etiqueta)}:</dt><dd>${escHtml(f.valor)}</dd>`).join('')}
      </dl>
    </div>
    <h2 class="doc-titulo">${escHtml(titulo)}</h2>`;
}

function pie(conNotas) {
  const notas = config.notas != null ? config.notas : NOTAS_DEFAULT;
  const lugar = (config.lugar || '').trim();
  const fecha = fechaLarga(config.fecha);
  return `
    ${conNotas && notas.trim() ? `<div class="doc-notas">${escHtml(notas)}</div>` : ''}
    <div class="doc-firma">
      ${lugar || fecha ? `${escHtml(lugar)}${lugar && fecha ? ', ' : ''}${escHtml(fecha)}.` : ''}
      <div class="doc-firma-linea">${escHtml(OFERENTE)}</div>
    </div>`;
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
      <td class="doc-num">${docPct(r.incidencia)}</td>
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
          <th style="width:17mm;">Incid.</th>
        </tr>
      </thead>
      <tbody>
        ${filas || '<tr><td colspan="7" class="doc-centro">Sin rubros cargados en el Cómputo.</td></tr>'}
        <tr class="doc-fila-total">
          <td colspan="5">Precio total de la obra</td>
          <td class="doc-num">${docARS(modelo.total)}</td>
          <td class="doc-num">100,00%</td>
        </tr>
      </tbody>
    </table>
    <div class="doc-son-pesos">Son pesos: ${escHtml(importeEnLetras(modelo.total))}</div>
    ${pie(true)}`;
}

function seccionPresupuesto() {
  const filas = modelo.rubros.map(r => {
    const cabecera = `
      <tr class="doc-fila-rubro">
        <td class="doc-centro">${escHtml(r.numero)}</td>
        <td>${escHtml(r.nombre || '(sin nombre)')}</td>
        <td colspan="3"></td>
        <td class="doc-num">${docARS(r.subtotal)}</td>
        <td class="doc-num">${docPct(r.incidencia)}</td>
      </tr>`;
    const lineas = r.lineas.map(l => `
      <tr>
        <td class="doc-centro doc-item">${escHtml(l.numero)}</td>
        <td>${escHtml(l.nombre)}</td>
        <td class="doc-centro">${escHtml(l.unidad)}</td>
        <td class="doc-num">${docCant(l.cantidad)}</td>
        <td class="doc-num">${docARS(l.precioUnitario)}</td>
        <td class="doc-num">${docARS(l.total)}</td>
        <td class="doc-num">${docPct(l.incidencia)}</td>
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
          <th style="width:16mm;">Incid.</th>
        </tr>
      </thead>
      <tbody>
        ${filas || '<tr><td colspan="7" class="doc-centro">Sin rubros cargados en el Cómputo.</td></tr>'}
        <tr class="doc-fila-total">
          <td colspan="5">Total del presupuesto</td>
          <td class="doc-num">${docARS(modelo.total)}</td>
          <td class="doc-num">100,00%</td>
        </tr>
      </tbody>
    </table>
    ${pie(false)}`;
}

/* ===== Render ===== */

function renderDocumento() {
  const doc = $('doc');
  if (modelo.k == null) {
    doc.innerHTML = '<p style="padding:2rem;text-align:center;color:#6b7280;">Esta obra todavía no tiene ítems cargados en el Cómputo: no hay presupuesto que exportar.</p>';
    $('btn-imprimir').disabled = true;
    $('export-aviso').textContent = 'Cargá el Cómputo de la obra para poder exportar.';
    return;
  }
  $('btn-imprimir').disabled = false;
  $('export-aviso').textContent = 'En el diálogo de impresión: A4, márgenes por defecto y "Gráficos de fondo" activado.';
  doc.innerHTML = SECCIONES
    .map(s => `<section class="doc-seccion${incluidas[s.id] ? '' : ' oculta'}" data-seccion="${s.id}">${incluidas[s.id] ? s.render() : ''}</section>`)
    .join('');
}

function renderSecciones() {
  $('exportar-secciones').innerHTML = SECCIONES.map(s => `
    <label class="exportar-check">
      <input type="checkbox" data-seccion="${s.id}" ${incluidas[s.id] ? 'checked' : ''}>
      <span>${escHtml(s.label)}</span>
    </label>`).join('');

  $('exportar-secciones').querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      incluidas[chk.dataset.seccion] = chk.checked;
      renderDocumento();
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
  const lugar = $('export-lugar');
  const fecha = $('export-fecha');
  const notas = $('export-notas');

  lugar.value = config.lugar || '';
  fecha.value = config.fecha || '';
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

  guardar(lugar, 'lugar', v => v.trim());
  guardar(fecha, 'fecha');
  guardar(notas, 'notas');
}

/* ===== Carga ===== */

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [m, exportData] = await Promise.all([
    window.cargarPresupuestoObra(obraKey),
    _fbGet(`/obras/${obraKey}/export.json`),
  ]);
  if (!m) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  modelo = m;
  config = { lugar: 'Córdoba', fecha: hoyIso(), notas: null, ...(exportData || {}) };
  SECCIONES.forEach(s => { incluidas[s.id] = true; });

  $('header-obra-nombre').textContent = 'Exportar — ' + modelo.obra.nombre;
  renderHeaderTabs(obraKey, 'exportar');
  renderSecciones();
  engancharConfig();
  renderDocumento();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-imprimir').addEventListener('click', () => window.print());
  await loadAll();
  await getDolarSnapshot().catch(() => {});
});
