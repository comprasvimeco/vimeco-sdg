/* VIMECO S.A. — Calculadora flotante: "+" fuera de un campo (no hace falta
   estar parado en ninguna celda) abre un panel flotante en modo selección;
   clickear cualquier valor marcado en pantalla (data-calc-valor) lo suma.
   "+" de nuevo con el panel abierto pasa a modo calculadora completa, donde
   además de clickear valores se puede escribir la fórmula directo por
   teclado: dígitos, + - * / ^, paréntesis, "p" inserta "pi" y "r" inserta
   "raiz(" (mismo motor que evalFormula en calc.js). El resultado y la
   fórmula quedan en el panel — no se inserta en ningún campo. "Copiar" copia
   la fórmula lista para pegar en un campo "=..." de la app (con "=" adelante,
   punto decimal, sin separador de miles). Esc cierra. */

(function () {
  const SELECTOR = '[data-calc-valor]';

  let open = false;
  let modo = 'suma'; // 'suma' | 'completa'
  let expresion = ''; // texto crudo de la fórmula, ej. "2458.75+1-2458.75"
  let panelEl = null;
  let posicion = null; // { left, top } en px, mientras se arrastra el panel

  function esEditable(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  // Redondea a centavos y devuelve el número con punto decimal, sin
  // separador de miles — el mismo formato que evalFormula() sabe leer.
  function fmtFormula(n) {
    return (Math.round(n * 100) / 100).toString();
  }

  function calcularResultado() {
    return window.evalFormula(expresion);
  }

  function balanceParentesis(s) {
    let b = 0;
    for (const ch of s) { if (ch === '(') b++; else if (ch === ')') b--; }
    return b;
  }

  function flashHighlight(el) {
    el.classList.add('calc-flotante-flash');
    setTimeout(() => el.classList.remove('calc-flotante-flash'), 350);
  }

  // Antes de insertar un valor "completo" (click en la pantalla, o los
  // botones π/√) hace falta un operador si la expresión ya termina en un
  // valor — si no, se concatenarían dos números sin sentido.
  function necesitaOperadorAntes() {
    return expresion.length > 0 && !/[+\-*/^(]$/.test(expresion);
  }

  function insertarAtomo(texto) {
    if (necesitaOperadorAntes()) expresion += '+';
    expresion += texto;
    renderPanel();
  }

  // Para teclas/botones que son operadores o símbolos sueltos: se anexan
  // directo, sin lógica de "operador implícito" (el usuario controla el
  // texto igual que en un campo de texto común).
  function anexar(texto) {
    expresion += texto;
    renderPanel();
  }

  function borrarUltimo() {
    expresion = expresion.slice(0, -1);
    renderPanel();
  }

  function agregarValor(el) {
    const valor = parseFloat(el.dataset.calcValor);
    if (isNaN(valor)) return;
    insertarAtomo(fmtFormula(valor));
    flashHighlight(el);
  }

  function abrir() {
    open = true;
    modo = 'suma';
    expresion = '';
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

    const hayExpresion = expresion.length > 0;
    let resultadoHtml = '<span class="calc-flotante-vacio">—</span>';
    if (hayExpresion) {
      try { resultadoHtml = fmtARS(calcularResultado()); }
      catch (_) { resultadoHtml = '<span class="calc-flotante-vacio">…</span>'; }
    }

    const parenLabel = balanceParentesis(expresion) > 0 ? ')' : '(';
    const opsHtml = modo === 'completa'
      ? `<div class="calc-flotante-ops">
          <button type="button" data-sym="+">+</button>
          <button type="button" data-sym="-">−</button>
          <button type="button" data-sym="*">×</button>
          <button type="button" data-sym="/">÷</button>
          <button type="button" data-sym="^">^</button>
          <button type="button" data-atomo="pi" title="Pi">π</button>
          <button type="button" data-atomo="raiz(" title="Raíz cuadrada">√</button>
          <button type="button" data-sym="${parenLabel}">${parenLabel}</button>
        </div>`
      : '';

    panelEl.innerHTML = `
      <div class="calc-flotante-header calc-flotante-drag">
        <span class="calc-flotante-titulo">${modo === 'completa' ? 'Calculadora' : 'Selección de suma'}</span>
        <button type="button" class="calc-flotante-close" title="Cerrar (Esc)">${window.icSvg ? icSvg('x') : '×'}</button>
      </div>
      <p class="calc-flotante-hint">${modo === 'completa'
        ? 'Clickeá números en pantalla o escribí la fórmula: + − × ÷ ^, paréntesis, "p" = pi, "r" = raíz.'
        : 'Clickeá números en pantalla para sumarlos. Apretá "+" de nuevo para escribir la fórmula a mano.'}</p>
      <div class="calc-flotante-expr">${hayExpresion ? escHtml(expresion) : '<span class="calc-flotante-vacio">Sin fórmula todavía</span>'}</div>
      <div class="calc-flotante-resultado">= ${resultadoHtml}</div>
      ${opsHtml}
      <div class="calc-flotante-acciones">
        <button type="button" class="calc-flotante-undo" ${hayExpresion ? '' : 'disabled'}>⌫</button>
        <button type="button" class="calc-flotante-clear" ${hayExpresion ? '' : 'disabled'}>Limpiar</button>
        <button type="button" class="calc-flotante-copiar btn btn-sm btn-primary" ${hayExpresion ? '' : 'disabled'}>Copiar</button>
      </div>`;

    panelEl.querySelector('.calc-flotante-close').addEventListener('click', cerrar);
    panelEl.querySelector('.calc-flotante-undo').addEventListener('click', borrarUltimo);
    panelEl.querySelector('.calc-flotante-clear').addEventListener('click', () => { expresion = ''; renderPanel(); });
    panelEl.querySelector('.calc-flotante-copiar').addEventListener('click', copiar);
    panelEl.querySelectorAll('.calc-flotante-ops [data-sym]').forEach(btn => {
      btn.addEventListener('click', () => anexar(btn.dataset.sym));
    });
    panelEl.querySelectorAll('.calc-flotante-ops [data-atomo]').forEach(btn => {
      btn.addEventListener('click', () => insertarAtomo(btn.dataset.atomo));
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

  // Copia la fórmula lista para pegar en un campo "=..." de la app (no el
  // resultado): "=" + la expresión, con punto decimal y sin separador de
  // miles, tal cual la entiende evalFormula().
  function copiar() {
    if (!expresion) return;
    navigator.clipboard.writeText('=' + expresion)
      .then(() => { if (window.showToast) showToast('Fórmula copiada — pegala en un campo "=..." con Ctrl+V.'); })
      .catch(() => { if (window.showToast) showToast('No se pudo copiar.', 'error'); });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open) { cerrar(); return; }

    if (!open) {
      if (e.key === '+' && !e.ctrlKey && !e.metaKey && !e.altKey && !esEditable(document.activeElement)) {
        e.preventDefault();
        abrir();
      }
      return;
    }

    if (esEditable(document.activeElement)) return; // no robar tipeo de otros campos
    if (e.ctrlKey || e.metaKey || e.altKey) return;  // no interferir con atajos del navegador

    if (e.key === '+') {
      e.preventDefault();
      if (modo === 'suma') { modo = 'completa'; renderPanel(); }
      else anexar('+');
      return;
    }
    if (e.key === '-') { e.preventDefault(); anexar('-'); return; }
    if (e.key === '*') { e.preventDefault(); anexar('*'); return; }
    if (e.key === '/') { e.preventDefault(); anexar('/'); return; }
    if (e.key === '^') { e.preventDefault(); anexar('^'); return; }
    if (e.key === '(' || e.key === ')') { e.preventDefault(); anexar(e.key); return; }
    if (e.key >= '0' && e.key <= '9') { e.preventDefault(); anexar(e.key); return; }
    if (e.key === '.' || e.key === ',') { e.preventDefault(); anexar('.'); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); borrarUltimo(); return; }
    if (e.key === 'Enter') { e.preventDefault(); copiar(); return; }
    if (e.key.toLowerCase() === 'p') { e.preventDefault(); insertarAtomo('pi'); return; }
    if (e.key.toLowerCase() === 'r') { e.preventDefault(); insertarAtomo('raiz('); return; }
  });

  document.addEventListener('mousedown', e => {
    if (!open) return;
    const el = e.target.closest(SELECTOR);
    if (!el) return;
    e.preventDefault(); // evita foco/selección de texto en inputs marcados
  }, true);

  // La suma se agrega en el click (no en el mousedown) y en fase de
  // captura: así, si el elemento tiene su propio listener de click (ej. el
  // botón de costo unitario de material abre el modal de precio), la
  // propagación se corta acá y ese listener nunca llega a dispararse.
  document.addEventListener('click', e => {
    if (!open) return;
    const el = e.target.closest(SELECTOR);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    agregarValor(el);
  }, true);
})();
