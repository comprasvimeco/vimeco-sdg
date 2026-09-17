/* VIMECO S.A. — Post-its del Análisis de Precio
   Notas libres por AP-en-esta-obra: viven en versionesObra/{obraKey}/postits,
   colgadas del mismo basePath() que usa item.js. Al no estar en la raíz del
   ítem, quedan afuera de "Usar otro AP como base" (que copia sólo rendimiento/
   lineas/baseUsada) sin necesitar ninguna exclusión explícita — mismo criterio
   por el que sinSeguridadCapataz tampoco se copia. Puramente internas: no
   entran en ninguna exportación.

   Reescrituras por clave puntual (_fbPatch), nunca PUT del nodo "postits"
   entero: dos personas agregando/borrando post-its casi al mismo tiempo no
   deben poder pisarse la una a la otra. */

(function () {
  const MAX_FILE_BYTES = 10 * 1024 * 1024; // mismo límite que Cotizaciones (plan free de Cloudinary)
  const COLORES = ['amarillo', 'rosa', 'celeste', 'verde'];
  const PURIFY_CONFIG = {
    ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'br', 'img', 'a', 'div'],
    ALLOWED_ATTR: ['src', 'href', 'target', 'rel'],
  };

  let container = null;
  let itemKeyActual = null;
  let basePathActual = null;
  let postits = {};
  let draggedKey = null;
  const saveTimers = {};

  function sanitize(html) {
    return window.DOMPurify ? window.DOMPurify.sanitize(html || '', PURIFY_CONFIG) : '';
  }

  function ordenadas() {
    return Object.entries(postits).sort((a, b) => (a[1].orden || 0) - (b[1].orden || 0));
  }

  function fmtTamano(bytes) {
    if (!bytes) return '';
    return bytes >= 1024 * 1024
      ? (bytes / 1024 / 1024).toFixed(1) + ' MB'
      : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  // -- Render -----------------------------------------------------------

  function render() {
    if (!container) return;
    const entradas = ordenadas();
    container.innerHTML = entradas.length
      ? entradas.map(([key, p]) => renderCard(key, p)).join('')
      : '<p class="text-muted" style="font-size:.85rem;">Todavía no hay ninguna nota en este AP.</p>';
    entradas.forEach(([key, p]) => wireCard(key, p));
  }

  function renderCard(key, p) {
    const color = COLORES.includes(p.color) ? p.color : 'amarillo';
    const archivos = Object.entries(p.archivos || {});
    const ro = !!window._soloLectura;
    return `
      <div class="postit postit-${color}" data-key="${escHtml(key)}" draggable="${ro ? 'false' : 'true'}">
        <div class="postit-toolbar">
          <span class="postit-colores">
            ${COLORES.map(c => `<button type="button" class="postit-color-dot postit-color-${c}${c === color ? ' activo' : ''}" data-color="${c}" title="Color ${c}" ${ro ? 'disabled' : ''}></button>`).join('')}
          </span>
          <span class="postit-formato">
            <button type="button" class="postit-fmt" data-cmd="bold" title="Negrita" ${ro ? 'disabled' : ''}><b>N</b></button>
            <button type="button" class="postit-fmt" data-cmd="italic" title="Cursiva" ${ro ? 'disabled' : ''}><i>K</i></button>
            <button type="button" class="postit-fmt" data-cmd="insertUnorderedList" title="Lista" ${ro ? 'disabled' : ''}>&bull;&equiv;</button>
          </span>
          <span class="postit-acciones">
            <label class="postit-adjuntar" title="Adjuntar archivo">${icSvg('clip')}<input type="file" class="postit-file-input" multiple hidden ${ro ? 'disabled' : ''}></label>
            <button type="button" class="postit-del" title="Eliminar post-it" ${ro ? 'disabled' : ''}>${icSvg('x')}</button>
          </span>
        </div>
        <div class="postit-body" contenteditable="${ro ? 'false' : 'true'}" data-placeholder="Escribí acá...">${sanitize(p.texto)}</div>
        ${archivos.length ? `<div class="postit-archivos">${archivos.map(([ak, a]) => renderArchivo(ak, a)).join('')}</div>` : ''}
      </div>`;
  }

  function renderArchivo(archivoKey, a) {
    const esImagen = (a.tipo || '').startsWith('image/');
    const info = `${escHtml(a.nombre || 'Archivo')}${a.tamano ? ' · ' + fmtTamano(a.tamano) : ''}`;
    const delBtn = `<button type="button" class="postit-chip-del" data-archivo-del="${escHtml(archivoKey)}" title="Quitar adjunto" ${window._soloLectura ? 'disabled' : ''}>${icSvg('x')}</button>`;
    return esImagen
      ? `<span class="postit-chip postit-chip-img">
           <a href="${escHtml(a.url)}" target="_blank" rel="noopener"><img src="${escHtml(a.url)}" alt="${escHtml(a.nombre || '')}"></a>
           ${delBtn}
         </span>`
      : `<span class="postit-chip">
           <a href="${escHtml(a.url)}" target="_blank" rel="noopener">${icSvg('file')} ${info}</a>
           ${delBtn}
         </span>`;
  }

  function cursorAlFinal(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function wireCard(key) {
    const card = container.querySelector(`.postit[data-key="${key}"]`);
    if (!card) return;
    const body = card.querySelector('.postit-body');

    card.addEventListener('dragstart', () => { draggedKey = key; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); draggedKey = null; persistirOrden(); });

    body.addEventListener('input', () => scheduleSave(key, body));
    body.addEventListener('blur', () => saveTexto(key, body));
    body.addEventListener('paste', e => onPaste(key, body, e));

    card.querySelectorAll('.postit-fmt').forEach(btn => {
      btn.addEventListener('click', () => {
        body.focus();
        document.execCommand(btn.dataset.cmd, false, null);
        // "insertUnorderedList" sobre texto suelto (sin bloques todavía) hace
        // que Chrome reconstruya todo el contenido en un <li> y pierda dónde
        // estaba el cursor, dejándolo al principio — se lo devolvemos al
        // final para poder seguir escribiendo donde se esperaba.
        if (btn.dataset.cmd === 'insertUnorderedList') cursorAlFinal(body);
        scheduleSave(key, body);
      });
    });

    card.querySelectorAll('.postit-color-dot').forEach(btn => {
      btn.addEventListener('click', () => cambiarColor(key, btn.dataset.color));
    });

    card.querySelector('.postit-del').addEventListener('click', () => eliminarPostit(key));

    const fileInput = card.querySelector('.postit-file-input');
    fileInput.addEventListener('change', () => {
      onAdjuntar(key, fileInput.files);
      fileInput.value = '';
    });

    card.querySelectorAll('[data-archivo-del]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        eliminarArchivo(key, btn.dataset.archivoDel);
      });
    });
  }

  // -- Texto (autosave con debounce + guardado en blur como red de seguridad)

  function scheduleSave(key, el) {
    clearTimeout(saveTimers[key]);
    saveTimers[key] = setTimeout(() => saveTexto(key, el), 800);
  }

  function saveTexto(key, el) {
    if (guardBloqueoObra()) return;
    clearTimeout(saveTimers[key]);
    delete saveTimers[key];
    if (!postits[key]) return;
    const texto = sanitize(el.innerHTML);
    postits[key] = { ...postits[key], texto, actualizadoEn: Date.now() };
    _fbPatch(`${basePathActual}/postits/${key}.json`, { texto, actualizadoEn: Date.now() })
      .catch(() => showToast('Error al guardar la nota.', 'error'));
  }

  // Pegar imagen: sube a Cloudinary y la inserta. Pegar texto: siempre como
  // texto plano, se ignora el formato/HTML de origen (Word, otra web, etc.)
  // para no arrastrar estilos ni marcado ajeno.
  async function onPaste(key, el, e) {
    if (guardBloqueoObra()) { e.preventDefault(); return; }
    const items = Array.from((e.clipboardData || {}).items || []);
    const imgItem = items.find(it => it.type && it.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      const file = imgItem.getAsFile();
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) { showToast('La imagen es demasiado grande (máx. 10MB).', 'error'); return; }
      try {
        const url = await _stUpload(file, `postits/${itemKeyActual}`);
        document.execCommand('insertHTML', false, `<img src="${escHtml(url)}">`);
        scheduleSave(key, el);
      } catch (_) {
        showToast('No se pudo subir la imagen. Revisá la conexión.', 'error');
      }
      return;
    }
    e.preventDefault();
    const texto = (e.clipboardData || {}).getData('text/plain') || '';
    document.execCommand('insertText', false, texto);
    scheduleSave(key, el);
  }

  // -- Color ----------------------------------------------------------------

  // Sólo toca las clases de ESTA tarjeta — nunca un render() completo del
  // grid, que reconstruiría el innerHTML de todos los .postit-body y podría
  // borrar texto que se esté escribiendo en otro post-it (o en éste mismo,
  // si el debounce del autosave todavía no disparó).
  function cambiarColor(key, color) {
    if (guardBloqueoObra()) return;
    if (!postits[key] || postits[key].color === color) return;
    postits[key].color = color;
    const card = container.querySelector(`.postit[data-key="${key}"]`);
    if (card) {
      COLORES.forEach(c => card.classList.remove('postit-' + c));
      card.classList.add('postit-' + color);
      card.querySelectorAll('.postit-color-dot').forEach(dot => {
        dot.classList.toggle('activo', dot.dataset.color === color);
      });
    }
    _fbPatch(`${basePathActual}/postits/${key}.json`, { color })
      .catch(() => showToast('Error al guardar el color.', 'error'));
  }

  // -- Adjuntos ---------------------------------------------------------------

  function wireArchivoDel(chipEl, postitKey) {
    const btn = chipEl.querySelector('[data-archivo-del]');
    if (!btn) return;
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      eliminarArchivo(postitKey, btn.dataset.archivoDel);
    });
  }

  // Agrega el chip al DOM de esa tarjeta puntual, sin tocar el resto del
  // grid (mismo motivo que cambiarColor).
  function agregarChipDOM(postitKey, archivoKey, registro) {
    const card = container.querySelector(`.postit[data-key="${postitKey}"]`);
    if (!card) return;
    let cont = card.querySelector('.postit-archivos');
    if (!cont) {
      cont = document.createElement('div');
      cont.className = 'postit-archivos';
      card.appendChild(cont);
    }
    cont.insertAdjacentHTML('beforeend', renderArchivo(archivoKey, registro));
    wireArchivoDel(cont.lastElementChild, postitKey);
  }

  // Secuencial a propósito, mismo motivo que en Cotizaciones: el plan free de
  // Cloudinary no agradece ráfagas.
  async function onAdjuntar(key, files) {
    if (guardBloqueoObra()) return;
    const arr = Array.from(files || []);
    if (!arr.length || !postits[key]) return;
    let huboError = false;
    for (const file of arr) {
      if (file.size > MAX_FILE_BYTES) {
        showToast(`${file.name} es demasiado grande (máx. 10MB).`, 'error');
        continue;
      }
      try {
        const url = await _stUpload(file, `postits/${itemKeyActual}`);
        const archivoKey = 'archivo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const registro = { nombre: file.name, tipo: file.type || '', tamano: file.size, url, creadoEn: Date.now() };
        postits[key].archivos = postits[key].archivos || {};
        postits[key].archivos[archivoKey] = registro;
        agregarChipDOM(key, archivoKey, registro);
        await _fbPatch(`${basePathActual}/postits/${key}/archivos.json`, { [archivoKey]: registro });
      } catch (_) {
        huboError = true;
      }
    }
    if (huboError) showToast('Algún archivo no se pudo subir.', 'error');
  }

  async function eliminarArchivo(postitKey, archivoKey) {
    if (guardBloqueoObra()) return;
    if (postits[postitKey] && postits[postitKey].archivos) delete postits[postitKey].archivos[archivoKey];
    const card = container.querySelector(`.postit[data-key="${postitKey}"]`);
    const btn = card && card.querySelector(`[data-archivo-del="${archivoKey}"]`);
    const chip = btn && btn.closest('.postit-chip');
    if (chip) chip.remove();
    try {
      await _fbPatch(`${basePathActual}/postits/${postitKey}/archivos.json`, { [archivoKey]: null });
    } catch (_) {
      showToast('Error al quitar el adjunto.', 'error');
    }
  }

  // -- Alta / baja de post-its ------------------------------------------------

  // Inserta sólo la tarjeta nueva al final del grid (no reconstruye las
  // demás, mismo motivo que cambiarColor/onAdjuntar).
  function agregarPostit() {
    if (guardBloqueoObra()) return;
    const key = 'postit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const entradas = ordenadas();
    const orden = entradas.length ? Math.max(...entradas.map(([, p]) => p.orden || 0)) + 1 : 1;
    const data = { texto: '', color: 'amarillo', orden, creadoEn: Date.now() };
    const eraElPrimero = !entradas.length;
    postits[key] = data;
    if (eraElPrimero) container.innerHTML = '';
    container.insertAdjacentHTML('beforeend', renderCard(key, data));
    wireCard(key);
    const body = container.querySelector(`.postit[data-key="${key}"] .postit-body`);
    if (body) body.focus();
    _fbPatch(`${basePathActual}/postits.json`, { [key]: data })
      .catch(() => showToast('Error al crear el post-it.', 'error'));
  }

  async function eliminarPostit(key) {
    if (guardBloqueoObra()) return;
    const ok = await showConfirm('Eliminar post-it',
      'Se borra esta nota. Los adjuntos no se borran de Cloudinary, sólo dejan de estar linkeados acá. ¿Continuar?');
    if (!ok) return;
    delete postits[key];
    const card = container.querySelector(`.postit[data-key="${key}"]`);
    if (card) card.remove();
    if (!Object.keys(postits).length) render(); // no queda ninguna tarjeta con contenido en riesgo: mostrar el estado vacío
    try {
      await _fbPatch(`${basePathActual}/postits.json`, { [key]: null });
    } catch (_) {
      showToast('Error al eliminar el post-it.', 'error');
    }
  }

  // -- Reordenar (drag) — mismo mecanismo que datos-obra.js/carga-fija.js:
  // el contenedor escucha "dragover" una sola vez (no se recrea entre renders,
  // sólo su contenido) y va moviendo la tarjeta en el DOM; recién al soltar se
  // lee el orden final y se persiste sólo lo que cambió. ---------------------

  function tarjetaDespuesDe(cont, y) {
    const tarjetas = [...cont.querySelectorAll('.postit:not(.dragging)')];
    return tarjetas.reduce((masCercana, el) => {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > masCercana.offset) return { offset, elemento: el };
      return masCercana;
    }, { offset: -Infinity, elemento: null }).elemento;
  }

  function engancharDragContainer() {
    container.addEventListener('dragover', e => {
      if (!draggedKey) return;
      e.preventDefault();
      const dragging = container.querySelector('.postit.dragging');
      if (!dragging) return;
      const despuesDe = tarjetaDespuesDe(container, e.clientY);
      if (despuesDe == null) container.appendChild(dragging);
      else container.insertBefore(dragging, despuesDe);
    });
  }

  function persistirOrden() {
    if (guardBloqueoObra()) return;
    const claves = [...container.querySelectorAll('.postit[data-key]')].map(el => el.dataset.key);
    const cambios = {};
    let huboCambio = false;
    claves.forEach((key, i) => {
      const p = postits[key];
      if (!p) return;
      const nuevoOrden = i + 1;
      if ((p.orden || 0) !== nuevoOrden) huboCambio = true;
      p.orden = nuevoOrden;
      cambios[`${key}/orden`] = nuevoOrden;
    });
    if (!huboCambio) return;
    _fbPatch(`${basePathActual}/postits.json`, cambios).catch(() => showToast('Error al guardar el orden.', 'error'));
  }

  // -- Init -----------------------------------------------------------------

  // Se llama desde el onChange del switch de modo lectura/edición (js/ui.js,
  // vía item.js) para repintar las tarjetas ya cargadas con el nuevo estado
  // de habilitado/deshabilitado, sin volver a pedirlas a Firebase.
  window._postitsRender = function () { render(); };

  // Se llama desde activarVersion() en item.js cada vez que cambia la obra
  // activa de este AP (incluida la carga inicial). `basePath` ya viene
  // resuelto (string), no una función, porque en el momento del llamado
  // activeVersion/itemKey de item.js ya están al día.
  window._postitsInit = async function (containerEl, { itemKey, basePath }) {
    container = containerEl;
    itemKeyActual = itemKey;
    basePathActual = basePath;
    postits = {};
    render();

    if (!container.dataset.dragEnganchado) {
      engancharDragContainer();
      container.dataset.dragEnganchado = '1';
    }
    const addBtn = document.getElementById('btn-add-postit');
    if (addBtn && !addBtn.dataset.wired) {
      addBtn.addEventListener('click', agregarPostit);
      addBtn.dataset.wired = '1';
    }

    try {
      postits = await _fbGet(`${basePathActual}/postits.json`) || {};
    } catch (_) {
      postits = {};
    }
    if (basePathActual === basePath) render(); // no pisar si ya se cambió de versión mientras cargaba
  };
})();
