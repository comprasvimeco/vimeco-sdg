/* global CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET */
/* Subida de archivos vía Cloudinary (unsigned upload preset), sin backend
   propio. Firebase Storage quedó descartado: desde 2024 requiere el plan
   Blaze (pago) incluso para uso dentro de la franja gratuita, y este
   proyecto tiene que ser 100% gratuito. */

(function () {
  // Sube `file` (PDF/imagen) y devuelve la URL pública de descarga
  // (`secure_url`). `folder` es opcional, sólo para organizar en el
  // dashboard de Cloudinary. Tira Error con `.status` si falla.
  async function _stUpload(file, folder) {
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
      throw new Error('Cloudinary no configurado (completar CLOUDINARY_CLOUD_NAME/CLOUDINARY_UPLOAD_PRESET en js/config.js).');
    }
    // PDFs van como "raw": Cloudinary sólo guarda los bytes, sin intentar
    // parsearlos como imagen para generar preview — con "auto"/"image" un PDF
    // mal formado (frecuente en escaneos/exports de proveedores) rechaza la
    // subida entera con "Invalid PDF file".
    const resourceType = file.type && file.type.startsWith('image/') ? 'image' : 'raw';
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    if (folder) form.append('folder', folder);

    const resp = await fetch(url, { method: 'POST', body: form });
    if (!resp.ok) {
      const err = new Error('HTTP ' + resp.status);
      err.status = resp.status;
      throw err;
    }
    const data = await resp.json();
    return data.secure_url;
  }

  window._stUpload = _stUpload;
})();
