/* VIMECO S.A. — Calculadora flotante: "+" fuera de un campo (no hace falta
   estar parado en ninguna celda) abre un panel flotante en modo selección;
   clickear cualquier valor marcado en pantalla (data-calc-valor) lo suma.
   "+" de nuevo con el panel abierto pasa a modo calculadora completa
   (resta/multiplicación/división, vía los botones del panel). El resultado
   y la fórmula quedan en el panel — no se inserta en ningún campo, se copia
   desde ahí con el botón "Copiar". Esc cierra. */

(function () {
  const SELECTOR = '[data-calc-valor]';

  let open = false;
  let modo = 'suma'; // 'suma' | 'completa'
  let terminos = []; // [{ op: '+'|'-'|'*'|'/', valor: number }]
  let opPendiente = '+';
  let panelEl = null;
  let posicion = null; // { left, top } en px, mientras se arrastra el panel

  function esEditable(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  function fmtNum(n) {
    return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function calcularResultado() {
    return terminos.reduce((acc, t) => {
      if (t.op === '+') return acc + t.valor;
      if (t.op === '-') return acc - t.valor;
      if (t.op === '*') return acc * t.valor;
      return t.valor === 0 ? acc : acc / t.valor;
    }, 0);
  }

  function formatearExpresion() {
    return terminos.map((t, i) => (i === 0 ? '' : ` ${t.op} `) + fmtNum(t.valor)).join('');
  }

  function flashHighlight(el) {
    el.classList.add('calc-flotante-flash');
    setTimeout(() => el.classList.remove('calc-flotante-flash'), 350);
  }

  function agregarValor(el) {
    const valor = parseFloat(el.dataset.calcValor);
    if (isNaN(valor)) return;
    const op = terminos.length === 0 ? '+' : (modo === 'completa' ? opPendiente : '+');
    terminos.push({ op, valor });
    opPendiente = '+';
    flashHighlight(el);
    renderPanel();
  }

  function abrir() {
    open = true;
    modo = 'suma';
    terminos = [];
    opPendiente = '+';
    posicion = null;
    document.body.classList.add('calc-flotante-activa');
    renderPanel();
  }

  function cerrar() {
    open = false;
    if (panelEl) { panelEl.remove(); panelEl = null; }
    document.body.classList.remove('calc-flotante-activa');
  }

  function renderPanel() {
    if (!panelEl) {
      panelEl = document.createElement('div');
      panelEl.className = 'calc-flotante-panel';
      panelEl.id = 'calc-flotante-panel';
      document.body.appendChild(panelEl);
    }
    if (posicion) {
      panelEl.style.left = posicion.left + 'px';
      panelEl.style.top = posicion.top + 'px';
    }

    const hayTerminos = terminos.length > 0;
    const opsHtml = modo === 'completa'
      ? `<div class="calc-flotante-ops">
          <button type="button" data-op="+" class="${opPendiente === '+' ? 'activo' : ''}">+</button>
          <button type="button" data-op="-" class="${opPendiente === '-' ? 'activo' : ''}">−</button>
          <button type="button" data-op="*" class="${opPendiente === '*' ? 'activo' : ''}">×</button>
          <button type="button" data-op="/" class="${opPendiente === '/' ? 'activo' : ''}">÷</button>
        </div>`
      : '';

    panelEl.innerHTML = `
      <div class="calc-flotante-header calc-flotante-drag">
        <span class="calc-flotante-titulo">${modo === 'completa' ? 'Calculadora' : 'Selección de suma'}</span>
        <button type="button" class="calc-flotante-close" title="Cerrar (Esc)">${window.icSvg ? icSvg('x') : '×'}</button>
      </div>
      <p class="calc-flotante-hint">${modo === 'completa'
        ? 'Clickeá números en pantalla. Elegí el operador antes de cada uno.'
        : 'Clickeá números en pantalla para sumarlos. Apretá "+" de nuevo para más operaciones.'}</p>
      <div class="calc-flotante-expr">${hayTerminos ? formatearExpresion() : '<span class="calc-flotante-vacio">Sin selección todavía</span>'}</div>
      <div class="calc-flotante-resultado">= ${fmtARS(calcularResultado())}</div>
      ${opsHtml}
      <div class="calc-flotante-acciones">
        <button type="button" class="calc-flotante-undo" ${hayTerminos ? '' : 'disabled'}>Deshacer</button>
        <button type="button" class="calc-flotante-clear" ${hayTerminos ? '' : 'disabled'}>Limpiar</button>
        <button type="button" class="calc-flotante-copiar btn btn-sm btn-primary" ${hayTerminos ? '' : 'disabled'}>Copiar</button>
      </div>`;

    panelEl.querySelector('.calc-flotante-close').addEventListener('click', cerrar);
    panelEl.querySelector('.calc-flotante-undo').addEventListener('click', () => { terminos.pop(); renderPanel(); });
    panelEl.querySelector('.calc-flotante-clear').addEventListener('click', () => { terminos = []; opPendiente = '+'; renderPanel(); });
    panelEl.querySelector('.calc-flotante-copiar').addEventListener('click', copiar);
    panelEl.querySelectorAll('.calc-flotante-ops button').forEach(btn => {
      btn.addEventListener('click', () => { opPendiente = btn.dataset.op; renderPanel(); });
    });
    attachDrag(panelEl.querySelector('.calc-flotante-drag'));
  }

  // Mueve el panel arrastrando desde el header — mouse y touch (celular).
  function attachDrag(handle) {
    function empezar(clientX, clientY) {
      const rect = panelEl.getBoundingClientRect();
      const offsetX = clientX - rect.left;
      const offsetY = clientY - rect.top;
      posicion = { left: rect.left, top: rect.top };
      panelEl.style.left = posicion.left + 'px';
      panelEl.style.top = posicion.top + 'px';

      function mover(cx, cy) {
        const left = Math.max(4, Math.min(cx - offsetX, window.innerWidth - rect.width - 4));
        const top = Math.max(4, Math.min(cy - offsetY, window.innerHeight - 40));
        posicion = { left, top };
        panelEl.style.left = left + 'px';
        panelEl.style.top = top + 'px';
      }

      function onMouseMove(e) { mover(e.clientX, e.clientY); }
      function onTouchMove(e) { mover(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
      function terminar() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', terminar);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', terminar);
      }
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', terminar);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', terminar);
    }

    handle.addEventListener('mousedown', e => {
      if (e.target.closest('.calc-flotante-close')) return;
      e.preventDefault();
      empezar(e.clientX, e.clientY);
    });
    handle.addEventListener('touchstart', e => {
      if (e.target.closest('.calc-flotante-close')) return;
      empezar(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
  }

  function copiar() {
    const texto = `${formatearExpresion()} = ${fmtARS(calcularResultado())}`;
    navigator.clipboard.writeText(texto)
      .then(() => { if (window.showToast) showToast('Copiado al portapapeles.'); })
      .catch(() => { if (window.showToast) showToast('No se pudo copiar.', 'error'); });
  }

  document.addEventListener('keydown', e => {
    if (e.key === '+' && !e.ctrlKey && !e.metaKey && !e.altKey && !esEditable(document.activeElement)) {
      e.preventDefault();
      if (!open) abrir();
      else if (modo === 'suma') { modo = 'completa'; renderPanel(); }
      return;
    }
    if (e.key === 'Escape' && open) cerrar();
  });

  document.addEventListener('mousedown', e => {
    if (!open) return;
    const el = e.target.closest(SELECTOR);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    agregarValor(el);
  }, true);
})();
