/**
 * Achica la foto (lado mayor 1400 px, JPEG) para que entre en el
 * almacenamiento del navegador y se envíe rápido al servicio de lectura.
 */
export async function comprimirImagen(archivo: File, ladoMax = 1400, calidad = 0.72): Promise<string> {
  if (!archivo.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('No se pudo abrir la imagen.'));
      i.src = url;
    });
    const escala = Math.min(1, ladoMax / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo procesar la imagen.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', calidad);
  } finally {
    URL.revokeObjectURL(url);
  }
}
