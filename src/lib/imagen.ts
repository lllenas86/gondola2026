/** Tamaño máximo de la foto que se manda a leer y se guarda (la consigna pide menos de 1,5 MB). */
export const MAX_BYTES_FOTO = 1_400_000;

async function abrir(archivo: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(archivo);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('No se pudo abrir la imagen.'));
      i.src = url;
    });
  } finally {
    // La imagen ya quedó decodificada en memoria
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function aJpeg(img: HTMLImageElement, ladoMax: number, calidad: number): string {
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
}

/** Bytes reales de un data URL en base64. */
export function bytesDataUrl(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Achica la foto a JPEG (lado mayor 1600 px) y, si hace falta, baja la calidad
 * y el tamaño hasta que pese menos de 1,5 MB.
 */
export async function comprimirImagen(archivo: File): Promise<string> {
  if (!archivo.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
  const img = await abrir(archivo);
  const intentos: [number, number][] = [[1600, 0.8], [1600, 0.68], [1400, 0.62], [1200, 0.58], [1000, 0.55], [800, 0.5]];
  let ultimo = '';
  for (const [lado, calidad] of intentos) {
    ultimo = aJpeg(img, lado, calidad);
    if (bytesDataUrl(ultimo) <= MAX_BYTES_FOTO) return ultimo;
  }
  return ultimo;
}

export function dataUrlABlob(dataUrl: string): Blob {
  const [cabecera, b64] = dataUrl.split(',');
  const tipo = /data:([^;]+)/.exec(cabecera)?.[1] ?? 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: tipo });
}
