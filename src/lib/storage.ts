// Los datos ya no se guardan en el navegador: viven en Supabase (ver lib/datos.ts).
// Este archivo solo genera identificadores para registros nuevos.

export function nuevoId(_prefijo?: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Respaldo para navegadores viejos: UUID v4 con Math.random
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
