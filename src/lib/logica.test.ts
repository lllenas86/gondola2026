import { describe, expect, it } from 'vitest';
import type { AppData, Presentacion, Vistas } from '../types';
import { estadoInventario, ritmoConsumo, nombreItem, itemsActivos } from './inventario';
import { proyectar } from './proyeccion';
import { aBultos, mensajePedido, sugerir, ventanaDePedido } from './pedido';
import { vincularLinea } from './match';
import { isoDate, addDays, startOfDay } from './dates';

// Fecha fija: martes 20/10/2026, 12:00
const AHORA = new Date(2026, 9, 20, 12, 0, 0);
const hoy = startOfDay(AHORA);
const d = (n: number, h = 9) => { const x = addDays(hoy, n); x.setHours(h); return x.toISOString(); };
const f = (n: number) => isoDate(addDays(hoy, n));

const pres = (id: string, productoId: string, nombre: string, extra: Partial<Presentacion> = {}): Presentacion => ({
  id, productoId, nombre, unidadStock: 'unidad', puntoDePedido: 5, activa: true, migrada: false, ...extra,
});

function base(): AppData {
  return {
    productos: [
      { id: 'coca', nombre: 'Coca-Cola', perecedero: false, activo: true },
      { id: 'leche', nombre: 'Leche entera', perecedero: true, activo: true },
    ],
    presentaciones: [
      pres('c225', 'coca', '2,25 L', { contenido: 2.25, unidadContenido: 'l', unidadesPorBulto: 8, costoUnitario: 1000 }),
      pres('c500', 'coca', '500 ml', { contenido: 500, unidadContenido: 'ml' }),
      pres('l1', 'leche', '1 L', { contenido: 1, unidadContenido: 'l', puntoDePedido: 10 }),
    ],
    proveedores: [{ id: 'v1', nombre: 'Distribuidora', diasDeVisita: [5] }], // viernes
    presentacionProveedor: [{ presentacionId: 'c225', proveedorId: 'v1' }, { presentacionId: 'c500', proveedorId: 'v1' }],
    conteos: [],
    recepciones: [],
    borradores: [],
    devoluciones: [],
    bajas: [],
    alias: [],
  };
}
const vistasVacias = (): Vistas => ({ stock: [], visitas: [], consumo: [], tieneTelefono: true });
const conteo = (id: string, p: string, cantidad: number, fechaHora: string, lotes?: { fechaVencimiento: string; cantidad: number }[]) =>
  ({ id, presentacionId: p, productoId: p.startsWith('c') ? 'coca' : 'leche', cantidad, fechaHora, tipo: null, stockRegistrado: null, ...(lotes ? { lotes } : {}) });

describe('stock por presentación y lotes', () => {
  it('no mezcla presentaciones del mismo producto', () => {
    const data = base();
    data.conteos = [conteo('a', 'c225', 10, d(-1)), conteo('b', 'c500', 3, d(-1))];
    expect(estadoInventario(data, 'c225').stock).toBe(10);
    expect(estadoInventario(data, 'c500').stock).toBe(3);
  });

  it('suma recepciones posteriores al conteo y resta devoluciones confirmadas y bajas, por lote', () => {
    const data = base();
    data.conteos = [conteo('a', 'l1', 12, d(-3), [{ fechaVencimiento: f(1), cantidad: 4 }, { fechaVencimiento: f(6), cantidad: 8 }])];
    data.recepciones = [{ id: 'r1', proveedorId: 'v1', fecha: f(-1), registradaEn: d(-1, 11), origen: 'manual', lineas: [{ presentacionId: 'l1', cantidad: 6, fechaVencimiento: f(10) }] }];
    data.devoluciones = [
      { id: 'dv1', numero: 1, proveedorId: 'v1', fecha: f(0), motivo: 'proximo_vencer', estado: 'confirmada', creadaEn: d(0, 8), confirmadaEn: d(0, 9), lineas: [{ presentacionId: 'l1', cantidad: 4, fechaVencimiento: f(1) }] },
      // Preparada: NO descuenta
      { id: 'dv2', numero: 2, proveedorId: 'v1', fecha: f(0), motivo: 'vencido', estado: 'preparada', creadaEn: d(0, 8), lineas: [{ presentacionId: 'l1', cantidad: 5, fechaVencimiento: f(6) }] },
    ];
    data.bajas = [{ id: 'b1', presentacionId: 'l1', cantidad: 2, fechaVencimiento: f(6), motivo: 'danado', registradaEn: d(0, 10) }];
    const e = estadoInventario(data, 'l1');
    expect(e.stock).toBe(12 + 6 - 4 - 2);
    expect(e.lotes.map((l) => [l.fechaVencimiento, l.cantidad])).toEqual([[f(6), 6], [f(10), 6]]);
  });

  it('ignora movimientos anteriores al último conteo (el conteo es la verdad física)', () => {
    const data = base();
    data.recepciones = [{ id: 'r0', proveedorId: 'v1', fecha: f(-5), registradaEn: d(-5), origen: 'manual', lineas: [{ presentacionId: 'c225', cantidad: 50 }] }];
    data.conteos = [conteo('a', 'c225', 7, d(-2))];
    expect(estadoInventario(data, 'c225').stock).toBe(7);
  });

  it('nombre: la presentación "Única" migrada muestra solo el producto', () => {
    expect(nombreItem({ id: 'x', nombre: 'Yerba 1 kg', perecedero: false, activo: true }, pres('u', 'x', 'Única'))).toBe('Yerba 1 kg');
  });
});

describe('consumo estimado y proyección', () => {
  const datosConHistorial = () => {
    const data = base();
    data.conteos = [conteo('a', 'c225', 30, d(-10)), conteo('b', 'c225', 20, d(0, 8))];
    const vistas = vistasVacias();
    vistas.consumo = [{ presentacionId: 'c225', desde: d(-10), hasta: d(0, 8), consumo: 10, dias: 10 }];
    return { data, vistas };
  };

  it('sin dos conteos no inventa un ritmo ni una fecha', () => {
    const data = base();
    data.conteos = [conteo('a', 'c500', 9, d(-1))];
    expect(ritmoConsumo([], 'c500')).toBeNull();
    const p = proyectar(data, vistasVacias(), data.presentaciones[1], AHORA, { horizonte: 14 });
    expect(p.puntos).toHaveLength(0);
    expect(p.fechaQuiebre).toBeNull();
    expect(p.faltante).toMatch(/dos conteos/);
  });

  it('descarta períodos con consumo negativo e informa la ventana usada', () => {
    const r = ritmoConsumo([
      { presentacionId: 'x', desde: 'a', hasta: 'b', consumo: 6, dias: 3 },
      { presentacionId: 'x', desde: 'b', hasta: 'c', consumo: -2, dias: 2 },
    ], 'x');
    expect(r?.porDia).toBe(2);
    expect(r?.descartados).toBe(1);
  });

  it('proyecta el quiebre con el ritmo real (1 por día, 20 en stock → día 19)', () => {
    const { data, vistas } = datosConHistorial();
    const p = proyectar(data, vistas, data.presentaciones[0], AHORA, { horizonte: 30 });
    expect(p.ritmo?.porDia).toBe(1);
    expect(p.stockHoy).toBe(20);
    expect(p.fechaQuiebre).toBe(f(19));
    expect(p.fechaPuntoPedido).toBe(f(14)); // queda 5 (= punto) al terminar el día 14
  });

  it('marca lo que vence sin salida (FEFO)', () => {
    const data = base();
    data.conteos = [conteo('a', 'l1', 20, d(-4)), conteo('b', 'l1', 16, d(0, 8), [{ fechaVencimiento: f(3), cantidad: 10 }, { fechaVencimiento: f(20), cantidad: 6 }])];
    const vistas = vistasVacias();
    vistas.consumo = [{ presentacionId: 'l1', desde: d(-4), hasta: d(0, 8), consumo: 4, dias: 4 }];
    const p = proyectar(data, vistas, data.presentaciones[2], AHORA, { horizonte: 7 });
    // 1 por día: el lote que vence el día 3 vende 4 (días 0 a 3) y le quedan 6 sin salida
    expect(p.lotesEnRiesgo.find((l) => l.fechaVencimiento === f(3))?.sinSalida).toBe(6);
  });
});

describe('pedido sugerido y mensaje', () => {
  it('con historial: cubre hasta la visita siguiente sin bajar del punto de pedido', () => {
    const data = base();
    data.conteos = [conteo('a', 'c225', 30, d(-10)), conteo('b', 'c225', 20, d(0, 8))];
    const vistas = vistasVacias();
    vistas.consumo = [{ presentacionId: 'c225', desde: d(-10), hasta: d(0, 8), consumo: 10, dias: 10 }];
    const v = ventanaDePedido(data.proveedores[0], hoy)!;
    expect(v.diasHastaVisita).toBe(3); // martes → viernes
    const s = sugerir(data, vistas, itemsActivos(data).find((x) => x.presentacion.id === 'c225')!, v, AHORA);
    // stock al llegar ≈ 20 − 3 = 17; necesario = 1×7 + 5 − 17 < 0 → 0
    expect(s.cantidad).toBe(0);
    expect(s.conHistorial).toBe(true);
  });

  it('sin historial: lleva al doble del punto de pedido y lo explica', () => {
    const data = base();
    data.conteos = [conteo('b', 'c500', 2, d(0, 8))];
    const v = ventanaDePedido(data.proveedores[0], hoy)!;
    const s = sugerir(data, vistasVacias(), itemsActivos(data).find((x) => x.presentacion.id === 'c500')!, v, AHORA);
    expect(s.cantidad).toBe(8);
    expect(s.prioridad).toBe('alta');
    expect(s.motivos.join(' ')).toMatch(/doble del punto de pedido/);
  });

  it('el mensaje lista cada presentación por separado, con bultos solo si están configurados', () => {
    const data = base();
    const [c225, c500] = data.presentaciones;
    const txt = mensajePedido(data.proveedores[0], addDays(hoy, 3), [
      { presentacion: c225, nombre: 'Coca-Cola 2,25 L', cantidad: 16 },
      { presentacion: c500, nombre: 'Coca-Cola 500 ml', cantidad: 5 },
      { presentacion: c500, nombre: 'Nada', cantidad: 0 },
    ]);
    expect(txt).toContain('• 16 × Coca-Cola 2,25 L (2 bultos de 8)');
    expect(txt).toContain('• 5 × Coca-Cola 500 ml\n');
    expect(txt).not.toContain('Nada');
    expect(txt).toMatch(/^Hola Distribuidora! Te paso el pedido para el viernes 23\/10:/);
    expect(aBultos(9, c225)).toBe(16);
    expect(aBultos(9, c500)).toBe(9);
  });
});

describe('reconocimiento de presentaciones en remitos', () => {
  const items = itemsActivos(base());
  it('distingue el tamaño', () => {
    expect(vincularLinea('COCA COLA 500 CC', items).presentacionId).toBe('c500');
    expect(vincularLinea('COCA COLA 2,25 LT', items).presentacionId).toBe('c225');
  });
  it('si el remito no dice el tamaño y hay varias presentaciones, queda para revisar', () => {
    const v = vincularLinea('COCA COLA', items);
    expect(v.confianza).toBeLessThan(0.75);
    expect(v.motivo).toMatch(/no indica el tamaño/);
  });
  it('no sugiere un producto distinto solo por una palabra en común si el tamaño no coincide', () => {
    const data = base();
    data.productos.push({ id: 'gn', nombre: 'Gaseosa Naranja', perecedero: false, activo: true });
    data.presentaciones.push(pres('gn15', 'gn', '1,5 L', { contenido: 1.5, unidadContenido: 'l' }));
    expect(vincularLinea('FANTA NARANJA 2,25 LT', itemsActivos(data)).presentacionId).toBeNull();
  });
  it('usa lo que la persona ya vinculó a mano', () => {
    const v = vincularLinea('GASEOSA COLA CHICA', items, new Set(), [{ texto: 'gaseosa cola chica', presentacionId: 'c500' }]);
    expect(v).toEqual({ presentacionId: 'c500', confianza: 1 });
  });
});
