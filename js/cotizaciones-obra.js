/* VIMECO S.A. — Sistema de Gestión — Cotizaciones de la obra
   Listado de los presupuestos de proveedores subidos para esta obra
   (/obras/{obraKey}/cotizaciones). El alta y la revisión con IA viven en
   js/cotizaciones-ia.js, que se apoya en el `$` declarado acá — ambos
   corren en el mismo scope global. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let cotizaciones = {}; // { cotizacionKey: { proveedor, fecha, archivoNombre, archivoUrl, estado, ... } }

const fmtFecha = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const ESTADO_LABEL = { aplicada: 'Aplicada', aplicada_parcial: 'Aplicada parcial' };

function renderCotizaciones() {
  const container = $('cotizaciones-lista');
  const entradas = Object.entries(cotizaciones).sort((a, b) => (b[1].creadoEn || 0) - (a[1].creadoEn || 0));
  if (!entradas.length) {
    container.innerHTML = '<div class="list-empty">No hay cotizaciones subidas todavía.</div>';
    return;
  }
  container.innerHTML = entradas.map(([key, c]) => {
    const meta = [c.proveedor, c.fecha ? fmtFecha(c.fecha) : '', ESTADO_LABEL[c.estado] || c.estado].filter(Boolean).join(' · ');
    return `
      <div class="item-card" data-key="${escHtml(key)}">
        <div class="item-card-info">
          <span class="item-card-title">${escHtml(c.archivoNombre || 'Cotización')}</span>
          <span class="item-card-meta">${escHtml(meta)}</span>
        </div>
        <div class="item-card-actions">
          ${c.archivoUrl ? `<a class="btn btn-sm btn-outline" href="${escHtml(c.archivoUrl)}" target="_blank" rel="noopener">${icSvg('file')} Ver archivo</a>` : ''}
          <button class="btn btn-sm btn-danger btn-del-cotizacion">Eliminar</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.btn-del-cotizacion').forEach(btn => {
    const key = btn.closest('.item-card').dataset.key;
    btn.addEventListener('click', () => deleteCotizacion(key));
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

async function deleteCotizacion(key) {
  const ok = await showConfirm('Eliminar cotización', 'Se borra el registro (y el link al archivo). Los precios de materiales que ya se aplicaron NO se revierten — esto sólo elimina la evidencia.');
  if (!ok) return;
  delete cotizaciones[key];
  renderCotizaciones();
  try {
    await _fbDel(`/obras/${obraKey}/cotizaciones/${key}.json`);
  } catch (_) {
    showToast('Error al eliminar la cotización.', 'error');
  }
  showToast('Cotización eliminada.');
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
  $('btn-add-cotizacion').addEventListener('click', () => openCotizacionModal(obraKey, refreshCotizaciones));
  await loadAll();
  await getDolarSnapshot().catch(() => {});
});
