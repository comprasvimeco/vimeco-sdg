/* VIMECO S.A. — Numeración del Cómputo (fuente única)

   El número con el que se conoce un rubro o un ítem ("3", "3.1") aparece en el
   Cómputo, en el Análisis de Precio, en el Presupuesto, en el Plan de trabajos,
   en el PDF y en el Excel. Antes cada pantalla lo derivaba de la posición por su
   cuenta (`${ri+1}.${li+1}` repetido en cinco archivos): alcanzaba con que una
   ordenara distinto para que el papel saliera con otra numeración que la
   pantalla. Acá se calcula una sola vez.

   Además, los pliegos no numeran todos igual y el presupuesto que emitimos tiene
   que salir como el del comitente. Por eso una obra puede activar:

   - `numeracionPersonalizada` — el código de cada rubro/línea se puede escribir
     a mano (`rubro.codigo` / `linea.codigo`), y donde no se escribe nada el
     automático sigue el `estiloNumeracion` elegido.
   - `sinRubros` — no hay rubros que mostrar: las líneas se numeran corridas en
     toda la obra.

   Las dos ausentes (el caso de todas las obras que ya existen) dan exactamente
   la numeración de siempre: 1, 1.1, 1.2, 2, 2.1… */

(function () {
  const ROMANOS = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];

  // Fuera de 1..3999 no hay romano posible: se cae al arábigo antes de dibujar
  // una fila sin número.
  function romano(n) {
    if (!(n >= 1 && n <= 3999)) return String(n);
    let resto = Math.floor(n), out = '';
    ROMANOS.forEach(([valor, letra]) => {
      while (resto >= valor) { out += letra; resto -= valor; }
    });
    return out;
  }

  const pad2 = n => String(n).padStart(2, '0');

  const ESTILOS = {
    arabigo: { nivel1: n => String(n), nivel2: n => String(n) },
    romano:  { nivel1: romano,         nivel2: n => String(n) },
    padded:  { nivel1: pad2,           nivel2: pad2 },
  };

  // Para el <select> de Datos de obra.
  window.NUMERACION_ESTILOS = [
    { id: 'arabigo', label: 'Arábigo — 1 · 1.1' },
    { id: 'romano',  label: 'Romano — I · I.1' },
    { id: 'padded',  label: 'Con cero — 01 · 01.01' },
  ];

  /* Las tres opciones de numeración de una obra, ya resueltas. El estilo sólo
     manda con la numeración personalizada prendida: apagada, la obra numera
     como siempre aunque tenga un estilo guardado de antes. */
  window.numeracionCfg = function (obra) {
    const o = obra || {};
    const personalizada = !!o.numeracionPersonalizada;
    const estilo = personalizada && ESTILOS[o.estiloNumeracion] ? o.estiloNumeracion : 'arabigo';
    return { personalizada, sinRubros: !!o.sinRubros, estilo };
  };

  // Cada pantalla tiene los rubros y las líneas en una forma distinta (mapa
  // crudo de RTDB en unas, array ya armado en otras): se aceptan las dos.
  function aLista(x) {
    if (!x) return [];
    if (Array.isArray(x)) return x.map(o => ({ ...o }));
    return Object.entries(x).map(([key, o]) => ({ key, ...o }));
  }

  const porOrden = (a, b) => (a.orden || 0) - (b.orden || 0);

  /* Numera un cómputo completo.

     Devuelve:
       cfg            — lo que resolvió numeracionCfg
       rubros         — [{ ...rubro, codigo, lineas: [{ ...linea, codigo }] }]
                        en orden; `codigo` vacío en las obras sin rubros
       lineasEnOrden  — las mismas líneas, planas y en el orden en que se leen
       codigoDeRubro  — { rubroKey: '3' }
       codigoDeLinea  — { lineaKey: '3.1' }
       autoDeRubro /
       autoDeLinea    — el mismo mapa pero ignorando los códigos a mano
       duplicados     — códigos que quedaron repetidos

     `duplicados` importa de verdad: el código es la clave con la que el Excel
     exportado cruza las hojas CyP, A.P, Resumen y Plan (VLOOKUP / INDEX+MATCH).
     Dos códigos iguales dejan la planilla llena de #N/A, así que el Cómputo lo
     usa para rechazar un código repetido antes de guardarlo.

     Las líneas que apuntan a un rubro que ya no existe quedan afuera: ninguna
     tabla las muestra (aunque su plata siga contando en el total, ver
     presupuestoDatos.js). */
  window.numerarComputo = function (obra, rubrosInput, lineasInput) {
    const cfg = window.numeracionCfg(obra);
    const est = ESTILOS[cfg.estilo];
    const rubros = aLista(rubrosInput).sort(porOrden);
    const lineas = aLista(lineasInput).sort(porOrden);

    const codigoDeRubro = {};
    const codigoDeLinea = {};
    // El automático aparte del efectivo: es lo que el Cómputo muestra como
    // placeholder del campo del código, o sea qué número saldría si se lo deja
    // vacío.
    const autoDeRubro = {};
    const autoDeLinea = {};
    const duplicados = [];
    const veces = {};
    function marcar(cod) {
      const k = cod.trim().toLowerCase();
      if (!k) return;
      veces[k] = (veces[k] || 0) + 1;
      if (veces[k] === 2) duplicados.push(cod);
    }

    // El código a mano sólo cuenta con la opción prendida; apagada queda
    // guardado pero dormido, y vuelve a valer si se la prende otra vez.
    const manual = e => (cfg.personalizada && e.codigo != null && String(e.codigo).trim()
      ? String(e.codigo).trim() : '');

    const lineasEnOrden = [];
    let posGlobal = 0;

    const rubrosModelo = rubros.map((rubro, ri) => {
      const autoRubro = cfg.sinRubros ? '' : est.nivel1(ri + 1);
      const codRubro = cfg.sinRubros ? '' : (manual(rubro) || autoRubro);
      if (codRubro) {
        codigoDeRubro[rubro.key] = codRubro;
        autoDeRubro[rubro.key] = autoRubro;
        marcar(codRubro);
      }

      const propias = lineas.filter(l => l.rubroId === rubro.key);
      const lineasModelo = propias.map((l, li) => {
        // El automático sale de la posición, no de un contador que saltee los
        // códigos escritos a mano: poner "1 bis" en una línea no corre a las
        // demás. El segundo nivel se cuelga del código efectivo del rubro, así
        // que un rubro llamado "A" numera sus líneas "A.1", "A.2"…
        const auto = cfg.sinRubros
          ? est.nivel1(posGlobal + 1)
          : `${codRubro}.${est.nivel2(li + 1)}`;
        posGlobal++;
        const codigo = manual(l) || auto;
        codigoDeLinea[l.key] = codigo;
        autoDeLinea[l.key] = auto;
        marcar(codigo);
        const modelo = { ...l, codigo };
        lineasEnOrden.push(modelo);
        return modelo;
      });

      return { ...rubro, codigo: codRubro, lineas: lineasModelo };
    });

    return {
      cfg, rubros: rubrosModelo, lineasEnOrden,
      codigoDeRubro, codigoDeLinea, autoDeRubro, autoDeLinea, duplicados,
    };
  };
})();
