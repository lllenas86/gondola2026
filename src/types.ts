// Modelo de datos. Regla crítica: el stock NUNCA se guarda ni se sobrescribe.
// Se calcula siempre a partir del historial de conteos y recepciones
// (en la base: vista v_stock_actual).

/** 0 = domingo, 1 = lunes … 6 = sábado (igual que Date.getDay()).
 *  En la base se guarda 1 = lunes … 7 = domingo; la conversión está en lib/datos.ts. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Unidad = 'unidad' | 'kg' | 'litro' | 'paquete' | 'caja';

/** Unidad del tamaño de una presentación (473 ml, 1 l, 500 g…). */
export type UnidadContenido = 'ml' | 'l' | 'g' | 'kg' | 'unidad';

/** Ficha única de producto (p. ej. "Cerveza Quilmes"). Agrupa sus presentaciones. */
export interface Ficha {
  id: string;
  nombre: string;
  /** Quedó sin presentaciones porque se movieron a otra ficha */
  archivada: boolean;
}

/**
 * Presentación de una ficha (p. ej. "473 ml"). Es lo que se cuenta, se recibe, se pide
 * y se devuelve: el stock se lleva por presentación. En la base es la tabla `productos`.
 * `nombre` es el nombre completo para mostrar ("Cerveza Quilmes 473 ml").
 */
export interface Producto {
  id: string;
  nombre: string;
  unidad: Unidad;
  perecedero: boolean;
  puntoDePedido: number;
  fichaId: string;
  /** Nombre de la presentación dentro de la ficha. «Única» si la ficha tiene una sola. */
  presentacion: string;
  contenido?: number;
  unidadContenido?: UnidadContenido;
  /** Equivalencia: unidades sueltas que trae (pack x6 = 6). */
  unidadesPorPresentacion: number;
}

export interface Proveedor {
  id: string;
  nombre: string;
  diasDeVisita: DiaSemana[];
  /** Teléfono para mandar el pedido por WhatsApp (opcional) */
  telefono?: string;
}

/** Relación muchos a muchos: un producto puede venir de varios proveedores. */
export interface ProductoProveedor {
  productoId: string;
  proveedorId: string;
}

export interface Conteo {
  id: string;
  productoId: string;
  cantidad: number;
  /** ISO con fecha y hora */
  fechaHora: string;
  /** AAAA-MM-DD, solo perecederos */
  fechaVencimiento?: string;
  /** Sesión de conteo (los conteos anteriores a la migración 04 no tienen) */
  sesionId?: string;
  /** Stock que esperaba el sistema justo antes de contar */
  stockEsperado?: number;
}

export interface SesionConteo {
  id: string;
  tipo: 'inicial' | 'periodico';
  notas?: string;
  creadaEn: string;
}

export type EstadoDevolucion = 'preparada' | 'entregada' | 'resuelta' | 'cancelada';
export type RespuestaProveedor = 'pendiente' | 'aceptada' | 'rechazada';
export type MotivoDevolucion = 'vencido' | 'proximo_a_vencer' | 'danado' | 'otro';

export interface LineaDevolucion {
  id: number;
  productoId: string;
  cantidad: number;
  fechaVencimiento?: string;
  recepcionId?: string;
}

export interface Devolucion {
  id: string;
  numero: number;
  proveedorId: string;
  tipo: 'devolucion' | 'cambio';
  motivo: MotivoDevolucion;
  nota?: string;
  estado: EstadoDevolucion;
  respuestaProveedor: RespuestaProveedor;
  resolucion?: string;
  fecha: string;
  creadaEn: string;
  entregadaEn?: string;
  resueltaEn?: string;
  lineas: LineaDevolucion[];
}

/** Salida de stock: devolución entregada o baja por descarte. */
export interface Movimiento {
  id: string;
  productoId: string;
  tipo: 'devolucion' | 'baja';
  cantidad: number;
  fechaVencimiento?: string;
  motivo?: string;
  devolucionLineaId?: number;
  fechaHora: string;
}

export interface LineaRecepcion {
  productoId: string;
  cantidad: number;
  fechaVencimiento?: string;
}

/** Recepción confirmada (las que suman al stock). */
export interface Recepcion {
  id: string;
  proveedorId: string;
  /** Fecha del remito o de la entrega (AAAA-MM-DD) */
  fecha: string;
  /** Momento en que se confirmó (ISO). Se usa para calcular el stock. */
  registradaEn: string;
  origen: 'manual' | 'remito_foto';
  /** Ruta de la foto en el bucket "remitos", o "ejemplo:<id>" para los remitos de ejemplo */
  imagen?: string;
  lineas: LineaRecepcion[];
}

export interface LineaBorradorBase {
  productoId: string | null;
  descripcion: string;
  /** null si la IA no pudo leer la cantidad */
  cantidad: number | null;
  fechaVencimiento?: string;
  /** Confianza de la lectura de la IA (0 a 1) */
  confianza?: number;
  /** Confianza de la vinculación con el catálogo (0 a 1), si se calculó en la app */
  confianzaVinculo?: number;
}

/** Recepción en borrador (por ejemplo, un remito leído por la IA y todavía sin revisar). */
export interface Borrador {
  id: string;
  proveedorId: string | null;
  /** Proveedor tal como figura en el remito */
  proveedorTexto?: string;
  fecha: string | null;
  origen: 'manual' | 'remito_foto';
  imagen?: string;
  creadaEn: string;
  lineas: LineaBorradorBase[];
}

export interface AppData {
  fichas: Ficha[];
  productos: Producto[];
  proveedores: Proveedor[];
  productoProveedor: ProductoProveedor[];
  conteos: Conteo[];
  recepciones: Recepcion[];
  borradores: Borrador[];
  sesiones: SesionConteo[];
  devoluciones: Devolucion[];
  movimientos: Movimiento[];
}

// ---- Filas de las vistas de la base ----

export interface FilaStock {
  productoId: string;
  nombre: string;
  puntoPedido: number;
  stockActual: number | null;
  bajoPuntoPedido: boolean;
  conteoDesactualizado: boolean;
  fechaUltimoConteo: string | null;
  diasDesdeConteo: number | null;
}

export interface FilaVisita {
  proveedorId: string;
  nombre: string;
  proximaVisita: string;
  diasHasta: number;
}

export interface FilaVencimiento {
  productoId: string;
  nombre: string;
  fechaVencimiento: string;
  cantidad: number;
  diasParaVencer: number;
}

/** Un período entre dos conteos consecutivos (vista v_consumo_historico). */
export interface FilaConsumo {
  productoId: string;
  /** Unidades consumidas en el período (puede ser negativo si faltó registrar una recepción) */
  consumo: number;
  /** Días del período */
  dias: number;
}

export type EstadoLote = 'vencido' | 'por_vencer' | 'vigente' | 'sin_fecha';

/** Lote (partida) vivo de una presentación: misma fecha de vencimiento (vista v_lotes). */
export interface Lote {
  productoId: string;
  fechaVencimiento: string | null;
  cantidad: number;
  /** Recepción más reciente que aportó a este lote, si vino de una recepción */
  recepcionId: string | null;
  origen: 'conteo' | 'recepcion';
  diasParaVencer: number | null;
  estado: EstadoLote;
}

export interface Vistas {
  stock: FilaStock[];
  lotes: Lote[];
  visitas: FilaVisita[];
  vencimientos: FilaVencimiento[];
  consumo: FilaConsumo[];
  /** true si la base ya tiene la columna proveedores.telefono (supabase/03_pedido_y_demo.sql) */
  tieneTelefono: boolean;
}
