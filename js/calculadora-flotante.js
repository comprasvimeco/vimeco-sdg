/* VIMECO S.A. — Calculadora flotante: "+" fuera de un campo (no hace falta
   estar parado en ninguna celda) abre un panel flotante con un campo de
   fórmula de verdad — cursor, click para posicionarte, flechas, selección,
   todo nativo del <input>. Clickear cualquier valor marcado en pantalla
   (data-calc-valor) lo inserta en la posición del cursor — pero SÓLO
   mientras ese campo de fórmula tiene el foco (como la barra de fórmulas de
   Excel: click en la barra, después click en una celda, la referencia se
   inserta ahí). En cuanto se clickea otro campo de la página para pegar o
   editar, deja de intervenir — no sigue "sumando" ese click.

   Dentro del campo se puede escribir directo: dígitos, + - * / ^,
   paréntesis; "p" inserta "pi", "r" inserta "raiz(" (mismo motor que
   evalFormula en calc.js). "Copiar" (o Enter) copia "=" + la fórmula, con
   punto decimal y sin separador de miles, lista para pegar en cualquier
   campo "=..." de la app — y le saca el foco al campo de fórmula, para que
   el próximo click en la pantalla sea un click normal. Esc cierra. */

(function () {
  const SELECTOR = '[data-calc-valor]';

  let open = false;
  let modo = 'suma'; // 'suma' (sólo click, rápido) | 'completa' (más botones + fórmula libre)
  let expresion = ''; // texto crudo de la fórmula, ej. "2458.75+1-2458.75"
  let panelEl = null;
  let posicion = null; // { left, top } en px, mientras se arrastra el panel
  let seleccionados = []; // [{ el, texto }] — celdas resaltadas mientras su valor siga en la fórmula

  function esEditable(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  function getInput() {
    return panelEl ? panelEl.querySelector('.calc-flotante-expr-input') : null;
  }

  function inputTieneFoco() {
    const input = getInput();
    return !!input && document.activeElement === input;
  }

  // Limpia ruido binario de punto flotante y devuelve el número con punto
  // decimal, sin separador de miles — el mismo formato que evalFormula()
  // sabe leer. No redondea a centavos: mantiene la precisión real del valor.
  function fmtFormula(n) {
    const limpio = roundLimpio(n);
    return window.decimalString ? window.decimalString(limpio) : limpio.toString();
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

  // ¿El texto insertado sigue presente en la fórmula como número completo
  // (no como parte de otro número más largo)? Se usa para saber si una
  // celda sigue "seleccionada" tras editar la fórmula a mano.
  function expresionContieneAtomo(expr, atomo) {
    const idx = expr.indexOf(atomo);
    if (idx === -1) return false;
    const antes = expr[idx - 1];
    const despues = expr[idx + atomo.length];
    return (!antes || !/[0-9.,]/.test(antes)) && (!despues || !/[0-9.,]/.test(despues));
  }

  function marcarSeleccionado(el, texto) {
    el.classList.add('calc-flotante-seleccionado');
    seleccionados.push({ el, texto });
  }

  function limpiarSeleccionados() {
    seleccionados.forEach(s => s.el.classList.remove('calc-flotante-seleccionado'));
    seleccionados = [];
  }

  // Se llama después de cada edición de la fórmula: si el texto de una
  // celda ya no está en la fórmula (se borró o se sobreescribió a mano), le
  // saca el resaltado.
  function revisarSeleccionados() {
    seleccionados = seleccionados.filter(s => {
      const sigue = expresionContieneAtomo(expresion, s.texto);
      if (!sigue) s.el.classList.remove('calc-flotante-seleccionado');
      return sigue;
    });
  }

  function cursorPos() {
    const input = getInput();
    if (!input) return { start: expresion.length, end: expresion.length };
    return {
      start: input.selectionStart != null ? input.selectionStart : expresion.length,
      end: input.selectionEnd != null ? input.selectionEnd : expresion.length,
    };
  }

  // Inserta un valor "completo" (click en la pantalla, o π/√/pi/raiz) en la
  // posición del cursor — antepone un "+" si hace falta (si justo antes del
  // cursor ya hay un valor completo, para no concatenar dos números).
  function insertarValorEnCursor(texto) {
    const { start, end } = cursorPos();
    const antes = expresion.slice(0, start);
    const despues = expresion.slice(end);
    const necesitaOperador = antes.length > 0 && !/[+\-*/^(]$/.test(antes);
    const insercion = (necesitaOperador ? '+' : '') + texto;
    expresion = antes + insercion + despues;
    actualizarVista(start + insercion.length);
  }

  // Inserta un símbolo suelto (operador, paréntesis) en el cursor — sin la
  // lógica de "operador implícito", el usuario controla el texto.
  function insertarSimboloEnCursor(texto) {
    const { start, end } = cursorPos();
    expresion = expresion.slice(0, start) + texto + expresion.slice(end);
    actualizarVista(start + texto.length);
  }

  // Emula un Backspace nativo mirando el cursor/selección actual — así el
  // botón "⌫" borra donde está el cursor, no siempre el final del texto.
  function borrarEnCursor() {
    const { start, end } = cursorPos();
    if (start !== end) {
      expresion = expresion.slice(0, start) + expresion.slice(end);
      actualizarVista(start);
    } else if (start > 0) {
      expresion = expresion.slice(0, start - 1) + expresion.slice(start);
      actualizarVista(start - 1);
    }
  }

  function agregarValor(el) {
    const valor = parseFloat(el.dataset.calcValor);
    if (isNaN(valor)) return;
    const texto = fmtFormula(valor);
    insertarValorEnCursor(texto);
    flashHighlight(el);
    marcarSeleccionado(el, texto);
  }

  function abrir() {
    open = true;
    modo = 'suma';
    expresion = '';
    posicion = null;
    document.body.classList.add('calc-flotante-activa');
    renderPanel();
    const input = getInput();
    if (input) input.focus();
  }

  function cerrar() {
    open = false;
    limpiarSeleccionados();
    if (panelEl) { panelEl.remove(); panelEl = null; }
    document.body.classList.remove('calc-flotante-activa');
  }

  // Actualiza el campo de fórmula, el resultado y los botones SIN rehacer
  // el panel entero — así el <input> nunca pierde el foco ni el cursor
  // mientras se escribe o se clickean valores.
  function actualizarVista(posicionCursor) {
    if (!panelEl) return;
    revisarSeleccionados();
    const input = getInput();
    if (input) {
      input.value = expresion;
      if (posicionCursor != null) { input.focus(); input.setSelectionRange(posicionCursor, posicionCursor); }
    }
    const parenBtn = panelEl.querySelector('[data-paren]');
    if (parenBtn) {
      const label = balanceParentesis(expresion) > 0 ? ')' : '(';
      parenBtn.textContent = label;
      parenBtn.dataset.paren = label;
    }
    const resEl = panelEl.querySelector('.calc-flotante-resultado');
    if (resEl) {
      if (!expresion) { resEl.innerHTML = '= <span class="calc-flotante-vacio">—</span>'; }
      else {
        try { resEl.textContent = '= ' + fmtARS(calcularResultado()); }
        catch (_) { resEl.innerHTML = '= <span class="calc-flotante-vacio">…</span>'; }
      }
    }
    const hay = expresion.length > 0;
    ['calc-flotante-undo', 'calc-flotante-clear', 'calc-flotante-copiar'].forEach(cls => {
      const btn = panelEl.querySelector('.' + cls);
      if (btn) btn.disabled = !hay;
    });
  }

  // Muestra/oculta los botones de operaciones y ajusta título/ayuda según
  // el modo — sin tocar el <input> (no se pierde el foco ni lo ya escrito
  // al pasar de "suma" a "completa" con el segundo "+").
  function actualizarModo() {
    if (!panelEl) return;
    const ops = panelEl.querySelector('.calc-flotante-ops');
    if (ops) ops.classList.toggle('hidden', modo !== 'completa');
    const titulo = panelEl.querySelector('.calc-flotante-titulo');
    if (titulo) titulo.textContent = modo === 'completa' ? 'Calculadora' : 'Selección de suma';
    const hint = panelEl.querySelector('.calc-flotante-hint');
    if (hint) hint.textContent = modo === 'completa'
      ? 'Clickeá números en pantalla o escribí acá la fórmula (+ − × ÷ ^, "p"=pi, "r"=raíz).'
      : 'Clickeá números en pantalla para sumarlos. Apretá "+" de nuevo para más operaciones.';
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

    panelEl.innerHTML = `
      <div class="calc-flotante-header calc-flotante-drag">
        <span class="calc-flotante-titulo">Calculadora</span>
        <button type="button" class="calc-flotante-close" title="Cerrar (Esc)">${window.icSvg ? icSvg('x') : '×'}</button>
      </div>
      <p class="calc-flotante-hint">Clickeá números en pantalla o escribí acá la fórmula (+ − × ÷ ^, "p"=pi, "r"=raíz). Click afuera del campo para pegar en otro lado.</p>
      <input type="text" class="calc-flotante-expr-input" spellcheck="false" autocomplete="off" placeholder="Escribí o clickeá números…">
      <div class="calc-flotante-resultado">= <span class="calc-flotante-vacio">—</span></div>
      <div class="calc-flotante-ops">
        <button type="button" data-sym="+">+</button>
        <button type="button" data-sym="-">−</button>
        <button type="button" data-sym="*">×</button>
        <button type="button" data-sym="/">÷</button>
        <button type="button" data-sym="^">^</button>
        <button type="button" data-atomo="pi" title="Pi">π</button>
        <button type="button" data-atomo="raiz(" title="Raíz cuadrada">√</button>
        <button type="button" data-paren="(" title="Paréntesis">(</button>
      </div>
      <div class="calc-flotante-acciones">
        <button type="button" class="calc-flotante-undo" disabled>⌫</button>
        <button type="button" class="calc-flotante-clear" disabled>Limpiar</button>
        <button type="button" class="calc-flotante-copiar btn btn-sm btn-primary" disabled>Copiar</button>
      </div>`;

    const input = getInput();
    input.addEventListener('input', () => { expresion = input.value; actualizarVista(); });
    input.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // no interferir con copiar/pegar/etc. del navegador
      // Con el foco ya en este campo (lo normal después de clickear
      // celdas), el "+" del teclado también tiene que poder pasar a modo
      // completa — si no, se escribiría como un "+" literal en la fórmula.
      // Una vez en modo completa, "+" pasa de largo y el input lo escribe
      // normal (ahí sí es un operador real de la fórmula).
      if (e.key === '+' && modo === 'suma') { e.preventDefault(); modo = 'completa'; actualizarModo(); return; }
      if (e.key === 'Enter') { e.preventDefault(); copiar(); return; }
      if (e.key.toLowerCase() === 'p') { e.preventDefault(); insertarValorEnCursor('pi'); return; }
      if (e.key.toLowerCase() === 'r') { e.preventDefault(); insertarValorEnCursor('raiz('); return; }
      // todo lo demás (dígitos, - * / ^, paréntesis, Backspace, flechas, selección) lo maneja el input nativo
    });

    panelEl.querySelector('.calc-flotante-close').addEventListener('click', cerrar);
    panelEl.querySelector('.calc-flotante-undo').addEventListener('click', borrarEnCursor);
    panelEl.querySelector('.calc-flotante-clear').addEventListener('click', () => { expresion = ''; actualizarVista(0); });
    panelEl.querySelector('.calc-flotante-copiar').addEventListener('click', copiar);
    panelEl.querySelectorAll('.calc-flotante-ops [data-sym]').forEach(btn => {
      btn.addEventListener('click', () => insertarSimboloEnCursor(btn.dataset.sym));
    });
    panelEl.querySelectorAll('.calc-flotante-ops [data-atomo]').forEach(btn => {
      btn.addEventListener('click', () => insertarValorEnCursor(btn.dataset.atomo));
    });
    panelEl.querySelector('[data-paren]').addEventListener('click', function () { insertarSimboloEnCursor(this.dataset.paren); });

    attachDrag(panelEl.querySelector('.calc-flotante-drag'));
    actualizarModo();
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
  // miles, tal cual la entiende evalFormula(). Le saca el foco al campo de
  // fórmula a propósito: el próximo click en la pantalla es un click
  // normal (para pegar en otro campo), no vuelve a sumar.
  function copiar() {
    if (!expresion) return;
    navigator.clipboard.writeText('=' + expresion)
      .then(() => { if (window.showToast) showToast('Fórmula copiada — pegala en un campo "=..." con Ctrl+V.'); })
      .catch(() => { if (window.showToast) showToast('No se pudo copiar.', 'error'); });
    const input = getInput();
    if (input) input.blur();
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open) { cerrar(); return; }
    if (e.key === '+' && !e.ctrlKey && !e.metaKey && !e.altKey && !esEditable(document.activeElement)) {
      e.preventDefault();
      if (!open) { abrir(); return; }
      if (modo === 'suma') { modo = 'completa'; actualizarModo(); } // "++": más operaciones
      const input = getInput(); if (input) input.focus(); // reabre el foco si se había ido a clickear otra cosa
    }
  });

  // La suma/inserción sólo interviene mientras el campo de fórmula tiene el
  // foco — si no, el click en la pantalla es un click normal (permite
  // pegar/editar otro campo después de copiar, sin que la calculadora lo
  // siga interceptando).
  document.addEventListener('mousedown', e => {
    if (!inputTieneFoco()) return;
    const el = e.target.closest(SELECTOR);
    if (!el) return;
    e.preventDefault(); // evita que el click le robe el foco al campo de fórmula
  }, true);

  document.addEventListener('click', e => {
    if (!inputTieneFoco()) return;
    const el = e.target.closest(SELECTOR);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    agregarValor(el);
  }, true);

  window.addEventListener('vimeco:moneda', () => { if (open) actualizarVista(); });
})();
