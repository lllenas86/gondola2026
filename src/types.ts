// Modelo de datos. Regla crítica: el stock NUNCA se guarda ni se sobrescribe.
// Se calcula siempre a partir del historial de conteos y recepciones.

/** 0 = domingo, 1 = lunes … 6 = sábado (igual que Date.getDay()). */
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

export interface Recepcion {
  id: string;
  proveedorId: string;
  /** Fecha del remito o de la entrega (AAAA-MM-DD) */
  fecha: string;
  /** Momento en que se confirmó la carga (ISO). Se usa para calcular el stock. */
  registradaEn: string;
  origen: 'manual' | 'remito_foto';
  /** data URL de la foto, o "ejemplo:<id>" para los remitos de ejemplo */
  imagen?: string;
  lineas: LineaRecepcion[];
}

export interface AppData {
  version: 1;
  productos: Producto[];
  proveedores: Proveedor[];
  productoProveedor: ProductoProveedor[];
  conteos: Conteo[];
  recepciones: Recepcion[];
}
