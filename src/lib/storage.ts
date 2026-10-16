import type { AppData } from '../types';
import { crearDatosDeEjemplo } from './seed';

export const STORAGE_KEY = 'gondola-almacen-v1';

export function cargarDatos(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as AppData;
      if (data && data.version === 1 && Array.isArray(data.productos)) return data;
    }
  } catch {
    // Navegador sin localStorage o datos dañados: se usan los datos de ejemplo.
  }
  return crearDatosDeEjemplo();
}

/** Devuelve false si no se pudo guardar (por ejemplo, almacenamiento lleno). */
export function guardarDatos(data: AppData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function nuevoId(prefijo: string): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefijo}-${Date.now().toString(36)}-${rnd}`;
}
