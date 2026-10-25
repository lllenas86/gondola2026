// Modelo de datos. Regla crítica: el stock NUNCA se guarda ni se sobrescribe.
// Se calcula siempre a partir del historial: último conteo + recepciones − devoluciones − bajas
// (en la base: vista v_stock_presentacion; en la app: lib/inventario.ts).
//
// El stock es de cada PRESENTACIÓN (473 ml, 1 L…), nunca del producto en general:
// no se suman ni se convierten presentaciones distintas.

/** 0 = domingo, 1 = lunes … 6 = sábado (igual que Date.getDay()).
 *  En la base se guarda 1 = lunes … 7 = domingo; la conversión está en lib/datos.ts. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** En qué se cuenta el stock de una presentación. */
export type Unidad = 'unidad' | 'kg' | 'litro' | 'paquete' | 'caja';
/** Unidad del tamaño de la presentación (solo para describirla y reconocerla en remitos). */
export type UnidadContenido = 'ml' | 'l' | 'g' | 'kg' | 'u';

/** Identidad del producto (lo que tienen en común sus presentaciones). */
export interface Producto {
  id: string;
  nombre: string;
  perecedero: boolean;
  activo: boolean;
}

/** Lo que se cuenta, se compra y se recibe. */
export interface Presentacion {
  id: string;
  productoId: string;
  /** "473 ml", "1 L", "Pack x 6". "Única" = creada por la migración desde un producto existente */
  nombre: string;
  contenido?: number;
  unidadContenido?: UnidadContenido;
  unidadStock: Unidad;
  /** Equivalencia configurada: 1 bulto = N unidades. Sin dato, la app no convierte. */
  unidadesPorBulto?: number;
  puntoDePedido: number;
  /** Costo de referencia por unidad (para valorizar mermas). */
  costoUnitario?: number;
  activa: boolean;
  migrada: boolean;
}

export interface Proveedor {
  id: string;
  nombre: string;
  diasDeVisita: DiaSemana[];
  /** Teléfono para mandar el pedido por WhatsApp (opcional) */
  telefono?: string;
}

/** Qué proveedor trae cada presentación (para comprar; el conteo no depende de esto). */
export interface PresentacionProveedor {
  presentacionId: string;
  proveedorId: string;
}

export interface LoteContado {
  fechaVencimiento: string;
  cantidad: number;
}

export interface Conteo {
  id: string;
  presentacionId: string;
  productoId: string;
  cantidad: number;
  /** ISO con fecha y hora */
  fechaHora: string;
  /** Vencimiento más próximo (compatibilidad con la versión anterior) */
  fechaVencimiento?: string;
  /** Desglose por vencimiento. Lo que no figura acá no tiene fecha cargada. */
  lotes?: LoteContado[];
  sesionId?: string;
  /** null = conteo anterior a la versión con presentaciones */
  tipo: 'inicial' | 'periodico' | null;
  /** Lo que decía el sistema antes de contar (lo calcula la base). */
  stockRegistrado: number | null;
}

export interface LineaRecepcion {
  presentacionId: string;
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
  presentacionId: string | null;
  descripcion: string;
  /** null si la IA no pudo leer la cantidad */
  cantidad: number | null;
  fechaVencimiento?: string;
  /** Confianza de la lectura de la IA (0 a 1) */
  confianza?: number;
  /** Confianza de la vinculación con el catálogo (0 a 1), si se calculó en la app */
  confianzaVinculo?: number;
  /** Por qué la vinculación quedó para revisar (por ejemplo, tamaño distinto) */
  motivoRevision?: string;
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

export type MotivoDevolucion = 'proximo_vencer' | 'vencido' | 'danado' | 'otro';
export type EstadoDevolucion = 'preparada' | 'confirmada' | 'resuelta' | 'cancelada';
export type ResolucionDevolucion = 'reemplazo' | 'nota_credito' | 'sin_compensacion' | 'otra';

export interface LineaDevolucion {
  presentacionId: string;
  cantidad: number;
  fechaVencimiento?: string;
  recepcionId?: string;
  costoUnitario?: number;
}

export interface Devolucion {
  id: string;
  /** Número del remito de devolución */
  numero: number;
  proveedorId: string;
  fecha: string;
  motivo: MotivoDevolucion;
  nota?: string;
  estado: EstadoDevolucion;
  resolucion?: ResolucionDevolucion;
  resolucionNota?: string;
  creadaEn: string;
  confirmadaEn?: string;
  resueltaEn?: string;
  canceladaEn?: string;
  lineas: LineaDevolucion[];
}

export type MotivoBaja = 'vencido' | 'danado' | 'otro';

/** Mercadería descartada (no vuelve al proveedor). */
export interface Baja {
  id: string;
  presentacionId: string;
  cantidad: number;
  fechaVencimiento?: string;
  motivo: MotivoBaja;
  nota?: string;
  costoUnitario?: number;
  registradaEn: string;
}

/** Texto de remito que ya se vinculó a mano con una presentación. */
export interface AliasRemito {
  texto: string;
  presentacionId: string;
}

export interface AppData {
  productos: Producto[];
  presentaciones: Presentacion[];
  proveedores: Proveedor[];
  presentacionProveedor: PresentacionProveedor[];
  conteos: Conteo[];
  recepciones: Recepcion[];
  borradores: Borrador[];
  devoluciones: Devolucion[];
  bajas: Baja[];
  alias: AliasRemito[];
}

// ---- Filas de las vistas de la base ----

export interface FilaStock {
  presentacionId: string;
  productoId: string;
  puntoPedido: number;
  /** null = nunca se contó ni se movió */
  stockActual: number | null;
  fechaUltimoConteo: string | null;
}

export interface FilaVisita {
  proveedorId: string;
  nombre: string;
  proximaVisita: string;
  diasHasta: number;
}

/** Un período entre dos conteos consecutivos (vista v_consumo_presentacion). */
export interface FilaConsumo {
  presentacionId: string;
  desde: string;
  hasta: string;
  /** Consumo estimado del período (negativo si faltó registrar una recepción) */
  consumo: number;
  /** Días del período */
  dias: number;
}

export interface Vistas {
  stock: FilaStock[];
  visitas: FilaVisita[];
  consumo: FilaConsumo[];
  /** true si la base ya tiene la columna proveedores.telefono (supabase/03_pedido_y_demo.sql) */
  tieneTelefono: boolean;
}
