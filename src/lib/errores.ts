import { ErrorBase } from './supabase';

/** Mensaje para mostrar en pantalla y, si corresponde, el campo del formulario al que se refiere. */
export interface MensajeError {
  texto: string;
  campo?: 'nombre' | 'puntoDePedido' | 'dias' | 'cantidad';
  sinConexion?: boolean;
}

export const TEXTO_SIN_CONEXION = 'Sin conexión con la base: los cambios no se guardan.';

// Restricciones definidas en supabase/01_esquema.sql → mensaje en lenguaje simple.
const POR_RESTRICCION: Record<string, MensajeError> = {
  productos_nombre_no_vacio: { texto: 'Escribí el nombre del producto.', campo: 'nombre' },
  productos_nombre_unico: { texto: 'Ya existe un producto con ese nombre.', campo: 'nombre' },
  productos_punto_pedido_no_negativo: { texto: 'El punto de pedido no puede ser negativo.', campo: 'puntoDePedido' },
  productos_unidad_valida: { texto: 'Elegí una unidad de la lista.' },
  proveedores_nombre_no_vacio: { texto: 'Escribí el nombre del proveedor.', campo: 'nombre' },
  proveedores_nombre_unico: { texto: 'Ya existe un proveedor con ese nombre.', campo: 'nombre' },
  proveedores_con_dias: { texto: 'Elegí al menos un día de visita.', campo: 'dias' },
  proveedores_dias_validos: { texto: 'Los días de visita no son válidos.', campo: 'dias' },
  conteos_cantidad_no_negativa: { texto: 'La cantidad contada no puede ser negativa.', campo: 'cantidad' },
  lineas_cantidad_positiva: { texto: 'Cada producto recibido tiene que tener una cantidad mayor a 0.', campo: 'cantidad' },
  lineas_vinculada_con_producto: { texto: 'Hay líneas del remito sin producto asignado.' },
};

/** Traduce cualquier error de la base a un mensaje para el usuario. */
export function mensajeError(e: unknown): MensajeError {
  if (e instanceof ErrorBase) {
    if (e.tipo === 'red') return { texto: TEXTO_SIN_CONEXION, sinConexion: true };
    if (e.tipo === 'config') return { texto: e.message, sinConexion: true };
    if (e.codigo === '401' || e.codigo === 'PGRST301' || /api key|jwt/i.test(e.message)) {
      return { texto: 'La clave de Supabase no es válida. Revisá las variables en Vercel.', sinConexion: true };
    }
    if (e.codigo === 'PGRST205' || e.codigo === '42P01') {
      return { texto: 'Faltan tablas en la base: hay que correr supabase/01_esquema.sql.', sinConexion: true };
    }
    // Función o columna nueva que todavía no se creó en la base
    if (e.codigo === 'PGRST202' || e.codigo === 'PGRST204' || e.codigo === '42883' || e.codigo === '42703') {
      return { texto: 'Falta actualizar la base: corré supabase/03_pedido_y_demo.sql en Supabase → SQL Editor.' };
    }
    for (const [restriccion, msg] of Object.entries(POR_RESTRICCION)) {
      if (e.message.includes(restriccion)) return msg;
    }
    // Reglas de los triggers: ya vienen en castellano
    if (e.codigo === 'P0001') return { texto: e.message };
    if (e.codigo === '42501') return { texto: 'La base no permite esta operación.' };
    if (e.codigo === '23503') return { texto: 'El dato al que hace referencia ya no existe. Recargá la pantalla.' };
    return { texto: `La base rechazó el cambio. Revisá los datos e intentá de nuevo. (Detalle: ${e.codigo} · ${e.message.slice(0, 120)})` };
  }
  return { texto: 'Ocurrió un error inesperado. Intentá de nuevo.' };
}
