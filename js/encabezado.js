/* VIMECO S.A. — Sistema de Gestión — Encabezado de la obra

   El membrete de todo lo que se exporta (documento imprimible y Excel) es una
   lista de filas "ETIQUETA: valor" que se edita en la pantalla Datos, bloque
   "Datos generales". Arranca sembrada con las filas de siempre —Obra,
   Ubicación, Comitente, Expediente, Oferente, Domicilio, Contacto— pero
   cualquiera de ellas se puede cambiar o borrar, y se pueden sumar otras:
   cada licitación pide lo suyo.

   Los datos de la pantalla Obras (nombre, ubicación, estado) son de uso
   interno y sólo alimentan el valor inicial de las filas: cambiarlos después
   no toca un encabezado ya cargado. Los "Datos adicionales" de la obra
   tampoco salen en el papel — son internos.

   Este archivo lo comparten js/datos-obra.js (edición) y js/exportar.js
   (papel y Excel), para que lo que se ve en la pantalla sea exactamente lo
   que sale impreso. */

const DOMICILIO_VIMECO = 'Bv. Rivadavia N° 3450, B° Los Boulevares, Córdoba';
const CONTACTO_VIMECO  = 'tecnica@vimeco.com.ar';

// Semilla del encabezado de una obra. Las keys son fijas y legibles porque
// son las filas de siempre; las que se agreguen a mano llevan key generada.
window.encabezadoInicial = function (obra) {
  const filas = {
    obra:       { etiqueta: 'Obra',       valor: obra.nombre || '' },
    ubicacion:  { etiqueta: 'Ubicación',  valor: obra.ubicacion || '' },
    comitente:  { etiqueta: 'Comitente',  valor: obra.comitente || '' },
    expediente: { etiqueta: 'Expediente', valor: '' },
    oferente:   { etiqueta: 'Oferente',   valor: 'VIMECO S.A.' },
    domicilio:  { etiqueta: 'Domicilio',  valor: DOMICILIO_VIMECO },
    contacto:   { etiqueta: 'Contacto',   valor: CONTACTO_VIMECO },
  };
  Object.keys(filas).forEach((k, i) => { filas[k].orden = i; });
  return filas;
};

// Las filas guardadas de la obra, o la semilla si la obra todavía no pasó por
// la pantalla Datos (así una obra vieja exporta con el encabezado completo sin
// tener que abrirla antes). Una obra ya sembrada que quedó sin filas se
// respeta vacía: se borraron todas a propósito.
window.encabezadoDeObra = function (obra, encabezado) {
  if (encabezado && Object.keys(encabezado).length) return encabezado;
  return obra.encabezadoSembrado ? {} : window.encabezadoInicial(obra);
};

// Filas listas para el membrete: en orden, sin las que quedaron sin valor y
// con la etiqueta en mayúsculas, que es como se imprimen.
window.filasEncabezado = function (obra, encabezado) {
  return Object.values(window.encabezadoDeObra(obra, encabezado))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0))
    .map(f => ({ etiqueta: (f.etiqueta || '').trim().toUpperCase(), valor: (f.valor || '').trim() }))
    .filter(f => f.valor !== '');
};
