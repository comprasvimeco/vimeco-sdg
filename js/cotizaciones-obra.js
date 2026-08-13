/* VIMECO S.A. — Sistema de Gestión — Cotizaciones de la obra
   Carpeta de archivos: los presupuestos de proveedores se suben y quedan
   guardados en /obras/{obraKey}/cotizaciones apenas se eligen, sin depender
   de que la IA lea nada. La extracción de precios con IA es una acción
   posterior sobre un archivo ya guardado, y vive en js/cotizaciones-ia.js,
   que se apoya en el `$` declarado acá — ambos corren en el mismo scope
   global. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

const MAX_FILE_BYTES = 10 * 1024 * 1024; // límite de subida del plan free de Cloudinary
// Formatos que Gemini puede leer. Cualquier otro archivo igual se guarda en la
// carpeta (un Excel del proveedor, por ejemplo), sólo que sin botón de IA.
const TIPOS_IA = ['application/pdf', 'image/jpeg', 'image/png'];

let obra = null;
let cotizaciones = {}; // { cotizacionKey: { archivoNombre, archivoUrl, estado, proveedor, fecha, ... } }
let subidas = [];      // fichas temporales mientras se sube: { id, nombre, error }

// Archivos elegidos en esta sesión, por key de cotización. Permite extraer con
// IA sin volver a bajar el archivo de Cloudinary cuando se acaba de subir.
window.cotizFilesEnSesion = window.cotizFilesEnSesion || {};

const fmtFecha = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const fmtTamano = bytes => {
  if (!bytes) return '';
  return bytes >= 1024 * 1024
    ? (bytes / 1024 / 1024).toFixed(1) + ' MB'
    : Math.max(1, Math.round(bytes / 1024)) + ' KB';
};

const ESTADO_LABEL = { pendiente: 'Sin procesar', aplicada: 'Aplicada', aplicada_parcial: 'Aplicada parcial' };
const ESTADO_CLASE = { pendiente: 'cotiz-estado--pendiente', aplicada: 'cotiz-estado--aplicada', aplicada_parcial: 'cotiz-estado--parcial' };

const esExtraible = c => TIPOS_IA.includes(c.archivoTipo) || /\.(pdf|jpe?g|png)$/i.test(c.archivoNombre || '');

function renderCotizaciones() {
  const container = $('cotizaciones-lista');
  const entradas = Object.entries(cotizaciones).sort((a, b) => (b[1].creadoEn || 0) - (a[1].creadoEn || 0));

  const htmlSubidas = subidas.map(s => `
    <div class="item-card cotiz-card-subiendo" data-subida="${escHtml(s.id)}">
      <div class="item-card-info">
        <span class="item-card-title">${escHtml(s.nombre)}</span>
        <span class="item-card-meta">${s.error ? escHtml(s.error) : 'Subiendo…'}</span>
      </div>
      <div class="item-card-actions">
        ${s.error ? '<button class="btn btn-sm btn-outline btn-descartar-subida">Descartar</button>' : ''}
      </div>
    </div>`).join('');

  if (!entradas.length && !subidas.length) {
    container.innerHTML = '<div class="list-empty">No hay archivos subidos todavía.</div>';
    return;
  }

  container.innerHTML = htmlSubidas + entradas.map(([key, c]) => {
    const estado = c.estado || 'pendiente';
    const meta = [c.proveedor, c.fecha ? fmtFecha(c.fecha) : '', fmtTamano(c.archivoTamano)].filter(Boolean).join(' · ');
    const nLineas = (c.lineasAplicadas || []).length;
    const estadoTexto = (ESTADO_LABEL[estado] || estado) + (nLineas ? ` (${nLineas} precio${nLineas === 1 ? '' : 's'})` : '');
    return `
      <div class="item-card" data-key="${escHtml(key)}">
        <div class="item-card-info">
          <span class="item-card-title">${escHtml(c.archivoNombre || 'Cotización')}</span>
          <span class="item-card-meta">
            <span class="cotiz-estado ${ESTADO_CLASE[estado] || ''}">${escHtml(estadoTexto)}</span>${meta ? ' · ' + escHtml(meta) : ''}
          </span>
        </div>
        <div class="item-card-actions">
          ${c.archivoUrl ? `<a class="btn btn-sm btn-outline" href="${escHtml(c.archivoUrl)}" target="_blank" rel="noopener">${icSvg('file')} Ver archivo</a>` : ''}
          ${esExtraible(c) ? `<button class="btn btn-sm btn-outline btn-extraer-cotizacion">${icSvg('sparkles')} ${estado === 'pendiente' ? 'Extraer con IA' : 'Volver a extraer'}</button>` : ''}
          <button class="btn btn-sm btn-danger btn-del-cotizacion">Eliminar</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.btn-del-cotizacion').forEach(btn => {
    const key = btn.closest('.item-card').dataset.key;
    btn.addEventListener('click', () => deleteCotizacion(key));
  });
  container.querySelectorAll('.btn-extraer-cotizacion').forEach(btn => {
    const key = btn.closest('.item-card').dataset.key;
    btn.addEventListener('click', () => openCotizacionModal(obraKey, key, cotizaciones[key], refreshCotizaciones));
  });
  container.querySelectorAll('.btn-descartar-subida').forEach(btn => {
    const id = btn.closest('.item-card').dataset.subida;
    btn.addEventListener('click', () => {
      subidas = subidas.filter(s => s.id !== id);
      renderCotizaciones();
    });
  });
}

async function refreshCotizaciones() {
  try {
    cotizaciones = await _fbGet(`/obras/${obraKey}/cotizaciones.json`) || {};
  } catch (_) {
    cotizaciones = {};
  }
  renderCotizaciones();
}

// --- Subida de archivos ---

function validarArchivo(file) {
  if (file.size > MAX_FILE_BYTES) return 'es demasiado grande (máx. 10MB)';
  if (!file.size) return 'está vacío';
  return null;
}

async function subirArchivos(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const errEl = $('cotiz-archivo-error');
  errEl.classList.add('hidden');

  const rechazados = [];
  const aSubir = [];
  files.forEach(file => {
    const problema = validarArchivo(file);
    if (problema) rechazados.push(`${file.name} ${problema}`);
    else aSubir.push(file);
  });

  if (rechazados.length) {
    errEl.textContent = 'No se subió: ' + rechazados.join('; ') + '.';
    errEl.classList.remove('hidden');
  }
  if (!aSubir.length) return;

  // Fichas temporales para que se vea qué está subiendo antes de que exista
  // el registro en Firebase.
  const pendientes = aSubir.map(file => ({
    id: 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    nombre: file.name,
    file,
    error: null,
  }));
  subidas = subidas.concat(pendientes);
  renderCotizaciones();

  let ok = 0;
  // Secuencial a propósito: el plan free de Cloudinary no agradece ráfagas, y
  // así el orden de las fichas queda igual al orden en que se eligieron.
  for (const p of pendientes) {
    try {
      const archivoUrl = await _stUpload(p.file, `cotizaciones/${obraKey}`);
      const key = 'cotiz_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const registro = {
        archivoNombre: p.file.name,
        archivoTipo: p.file.type || '',
        archivoTamano: p.file.size,
        archivoUrl,
        estado: 'pendiente',
        creadoEn: Date.now(),
      };
      await _fbPut(`/obras/${obraKey}/cotizaciones/${key}.json`, registro);
      cotizaciones[key] = registro;
      window.cotizFilesEnSesion[key] = p.file;
      subidas = subidas.filter(s => s.id !== p.id);
      ok++;
    } catch (_) {
      p.error = 'No se pudo subir. Revisá la conexión (o la configuración de Cloudinary) y probá de nuevo.';
    }
    renderCotizaciones();
  }

  if (ok) showToast(ok === 1 ? 'Archivo guardado.' : `${ok} archivos guardados.`);
  if (subidas.some(s => s.error)) showToast('Algún archivo no se pudo subir.', 'error');
}

async function deleteCotizacion(key) {
  const c = cotizaciones[key] || {};
  const aviso = (c.lineasAplicadas || []).length
    ? 'Se borra el archivo de la carpeta. Los precios de materiales que ya se aplicaron NO se revierten — esto sólo elimina la evidencia.'
    : 'Se borra el archivo de la carpeta.';
  const ok = await showConfirm('Eliminar archivo', aviso);
  if (!ok) return;
  delete cotizaciones[key];
  delete window.cotizFilesEnSesion[key];
  renderCotizaciones();
  try {
    await _fbDel(`/obras/${obraKey}/cotizaciones/${key}.json`);
  } catch (_) {
    showToast('Error al eliminar el archivo.', 'error');
    return;
  }
  showToast('Archivo eliminado.');
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, cotizacionesData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/cotizaciones.json`),
  ]);

  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;
  cotizaciones = cotizacionesData || {};

  $('header-obra-nombre').textContent = 'Cotizaciones — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'cotizaciones');
  renderCotizaciones();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('cotiz-elegir-icon').innerHTML = icSvg('file');
  $('btn-add-cotizacion').addEventListener('click', () => $('cotiz-archivo-input').click());
  $('btn-cotiz-elegir-archivo').addEventListener('click', () => $('cotiz-archivo-input').click());
  $('cotiz-archivo-input').addEventListener('change', e => {
    subirArchivos(e.target.files);
    e.target.value = ''; // permite volver a elegir el mismo archivo
  });

  const dropzone = $('cotiz-dropzone');
  ['dragover', 'dragenter'].forEach(evt => dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  }));
  ['dragleave', 'dragend'].forEach(evt => dropzone.addEventListener(evt, () => dropzone.classList.remove('dragover')));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files) subirArchivos(e.dataTransfer.files);
  });

  await loadAll();
  await getDolarSnapshot().catch(() => {});
});
