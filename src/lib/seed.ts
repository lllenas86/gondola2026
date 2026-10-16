import type { AppData, Conteo, Recepcion } from '../types';
import { addDays, isoDate, startOfDay } from './dates';

/**
 * Datos de prueba. Las fechas se calculan relativas a "ahora" para que la
 * pantalla Hoy siempre tenga sentido, sin importar cuándo se abra la app.
 */
export function crearDatosDeEjemplo(ahora: Date = new Date()): AppData {
  const hoy = startOfDay(ahora);
  const momento = (diasAtras: number, hora: number, min = 0) => {
    const d = addDays(hoy, -diasAtras);
    d.setHours(hora, min, 0, 0);
    return d.toISOString();
  };
  const fecha = (dias: number) => isoDate(addDays(hoy, dias));

  const productos: AppData['productos'] = [
    { id: 'p-coca', nombre: 'Coca-Cola 2,25 L', unidad: 'unidad', perecedero: false, puntoDePedido: 12 },
    { id: 'p-sprite', nombre: 'Sprite 2,25 L', unidad: 'unidad', perecedero: false, puntoDePedido: 6 },
    { id: 'p-agua', nombre: 'Agua mineral 1,5 L', unidad: 'unidad', perecedero: false, puntoDePedido: 10 },
    { id: 'p-leche', nombre: 'Leche entera 1 L', unidad: 'unidad', perecedero: true, puntoDePedido: 20 },
    { id: 'p-yogur', nombre: 'Yogur bebible 1 L', unidad: 'unidad', perecedero: true, puntoDePedido: 6 },
    { id: 'p-yerba', nombre: 'Yerba 1 kg', unidad: 'unidad', perecedero: false, puntoDePedido: 8 },
  ];

  const proveedores: AppData['proveedores'] = [
    { id: 'v-centro', nombre: 'Distribuidora Centro', diasDeVisita: [2, 5] },
    { id: 'v-lacteos', nombre: 'Lácteos del Sur', diasDeVisita: [1, 3, 5] },
    { id: 'v-mayorista', nombre: 'Mayorista Rosario', diasDeVisita: [4] },
  ];

  const productoProveedor: AppData['productoProveedor'] = [
    { proveedorId: 'v-centro', productoId: 'p-coca' },
    { proveedorId: 'v-centro', productoId: 'p-sprite' },
    { proveedorId: 'v-centro', productoId: 'p-agua' },
    { proveedorId: 'v-lacteos', productoId: 'p-leche' },
    { proveedorId: 'v-lacteos', productoId: 'p-yogur' },
    { proveedorId: 'v-mayorista', productoId: 'p-yerba' },
    { proveedorId: 'v-mayorista', productoId: 'p-coca' },
  ];

  // [producto, días atrás, cantidad, vencimiento (días desde hoy)]
  const historial: [string, number, number, number?][] = [
    ['p-coca', 21, 20], ['p-coca', 14, 9], ['p-coca', 7, 14], ['p-coca', 2, 15],
    ['p-sprite', 21, 8], ['p-sprite', 14, 3], ['p-sprite', 7, 7], ['p-sprite', 2, 4],
    ['p-agua', 22, 18], ['p-agua', 15, 12], ['p-agua', 11, 24], ['p-agua', 4, 20],
    ['p-leche', 20, 26, -12], ['p-leche', 13, 18, -6], ['p-leche', 6, 32, 1], ['p-leche', 1, 30, 5],
    ['p-yogur', 20, 9, -10], ['p-yogur', 13, 5, -4], ['p-yogur', 6, 11, 3], ['p-yogur', 1, 8, 2],
    ['p-yerba', 23, 14], ['p-yerba', 16, 10], ['p-yerba', 9, 20],
  ];

  const conteos: Conteo[] = historial.map(([productoId, dias, cantidad, venc], i) => ({
    id: `c-${i + 1}`,
    productoId,
    cantidad,
    fechaHora: momento(dias, 9, 15 + (i % 30)),
    ...(venc !== undefined ? { fechaVencimiento: fecha(venc) } : {}),
  }));

  // Recepciones pasadas: todas anteriores al último conteo de cada producto,
  // así el stock actual coincide con los datos de prueba.
  const recepciones: Recepcion[] = [
    {
      id: 'r-1', proveedorId: 'v-centro', fecha: fecha(-12), registradaEn: momento(12, 11), origen: 'manual',
      lineas: [{ productoId: 'p-coca', cantidad: 12 }, { productoId: 'p-sprite', cantidad: 6 }, { productoId: 'p-agua', cantidad: 12 }],
    },
    {
      id: 'r-2', proveedorId: 'v-lacteos', fecha: fecha(-10), registradaEn: momento(10, 10), origen: 'manual',
      lineas: [{ productoId: 'p-leche', cantidad: 24, fechaVencimiento: fecha(0) }, { productoId: 'p-yogur', cantidad: 12, fechaVencimiento: fecha(-1) }],
    },
    {
      id: 'r-3', proveedorId: 'v-mayorista', fecha: fecha(-14), registradaEn: momento(14, 12), origen: 'manual',
      lineas: [{ productoId: 'p-yerba', cantidad: 12 }, { productoId: 'p-coca', cantidad: 6 }],
    },
  ];

  return { version: 1, productos, proveedores, productoProveedor, conteos, recepciones };
}
