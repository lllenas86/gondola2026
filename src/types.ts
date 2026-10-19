// Modelo de datos. Regla crítica: el stock NUNCA se guarda ni se sobrescribe.
// Se calcula siempre a partir del historial de conteos y recepciones
// (en la base: vista v_stock_actual).

/** 0 = domingo, 1 = lunes … 6 = sábado (igual que Date.getDay()).
 *  En la base se guarda 1 = lunes … 7 = domingo; la conversión está en lib/datos.ts. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Unidad = 'unidad' | 'kg' | 'litro' | 'paquete' | 'caja';

export interface Producto {
  id: string;
  nombre: string;
  unidad: Unidad;
  perecedero: boolean;
  puntoDePedido: number;
}

export interface Proveedor {
  id: string;
  nombre: string;
  diasDeVisita: DiaSemana[];
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
  productos: Producto[];
  proveedores: Proveedor[];
  productoProveedor: ProductoProveedor[];
  conteos: Conteo[];
  recepciones: Recepcion[];
  borradores: Borrador[];
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

export interface Vistas {
  stock: FilaStock[];
  visitas: FilaVisita[];
  vencimientos: FilaVencimiento[];
}
