// Qué puede hacer cada rol. Es la MISMA regla que aplican las políticas de la base
// (supabase/05_roles_y_almacenes.sql): la interfaz solo evita mostrar lo que la base rechazaría.
import type { Rol } from './auth';

export type Accion =
  | 'contar' | 'recibir' | 'altaProducto' | 'editarCatalogo' | 'proveedores'
  | 'pedidos' | 'devoluciones' | 'bajas' | 'proyeccion' | 'panel' | 'equipo' | 'restablecerDemo';

const TODOS: Rol[] = ['empleado', 'encargado', 'dueno'];
const GESTION: Rol[] = ['encargado', 'dueno'];

const REGLAS: Record<Accion, Rol[]> = {
  contar: TODOS,
  recibir: TODOS,
  // Alta rápida desde un remito (producto + presentación nuevos)
  altaProducto: TODOS,
  editarCatalogo: GESTION,
  proveedores: GESTION,
  pedidos: GESTION,
  devoluciones: GESTION,
  bajas: GESTION,
  proyeccion: GESTION,
  panel: ['dueno'],
  equipo: ['dueno'],
  restablecerDemo: ['dueno'],
};

/** rol null = modo abierto (la base no tiene usuarios todavía): se permite todo, como antes. */
export function puede(rol: Rol | null, accion: Accion): boolean {
  return rol === null || REGLAS[accion].includes(rol);
}
