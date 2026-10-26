import { describe, expect, it } from 'vitest';
import type { AppData, Presentacion } from '../types';
import { itemsActivos } from './inventario';
import { medidaDe, mismaIdentidad, sinMedida, vincularLinea } from './match';
import { validarRecepcion, type LineaBorrador } from './validation';

const pres = (id: string, productoId: string, nombre: string, extra: Partial<Presentacion> = {}): Presentacion => ({
  id, productoId, nombre, unidadStock: 'unidad', puntoDePedido: 5, activa: true, migrada: false, ...extra,
});

/** Catálogo con la ficha «Manteca Pepito» y su presentación de 200 g. */
function catalogo(extra: (d: AppData) => void = () => {}): AppData {
  const d: AppData = {
    productos: [
      { id: 'mp', nombre: 'Manteca Pepito', perecedero: true, activo: true },
      { id: 'leche', nombre: 'Leche entera', perecedero: true, activo: true },
    ],
    presentaciones: [
      pres('mp200', 'mp', '200 g', { contenido: 200, unidadContenido: 'g' }),
      pres('l1', 'leche', '1 L', { contenido: 1, unidadContenido: 'l' }),
    ],
    proveedores: [], presentacionProveedor: [], conteos: [], recepciones: [], borradores: [], devoluciones: [], bajas: [], alias: [],
  };
  extra(d);
  return d;
}

describe('normalización de unidades', () => {
  it('200 gr = 200 g = 200 gramos = 200grs = 0,2 kg', () => {
    for (const t of ['200 gr', '200 g', '200 gramos', 'x200grs', '200 GRS.', '0,2 kg', '200 Gramo']) expect(medidaDe(`Manteca ${t}`)).toBe('200 g');
  });
  it('no confunde tamaños distintos', () => {
    expect(medidaDe('Manteca 100 gr')).toBe('100 g');
    expect(medidaDe('Manteca 500 gramos')).toBe('500 g');
    expect(medidaDe('Yerba 1 kilo')).toBe('1 kg');
    expect(medidaDe('Yerba 1000 g')).toBe('1 kg');
  });
  it('volúmenes: 500 cc = 500 ml = 0,5 l; 1 litro = 1 l', () => {
    for (const t of ['500 cc', '500 ml', '0,5 lt', '500 mililitros']) expect(medidaDe(`Coca ${t}`)).toBe('0_5 l');
    expect(medidaDe('Leche 1 litro')).toBe('1 l');
  });
  it('separa el nombre del tamaño', () => {
    expect(sinMedida('MANTECA PEPITO X 200 GR')).toBe('MANTECA PEPITO');
    expect(sinMedida('Manteca Pepito 200 gramos')).toBe('Manteca Pepito');
    expect(mismaIdentidad('Manteca Pepito 200 gr', 'Manteca Pepito')).toBe(true);
    expect(mismaIdentidad('Manteca', 'Manteca Pepito')).toBe(false);
  });
});

describe('reconocimiento de producto y presentación (Manteca Pepito 200 g)', () => {
  it('1. «Manteca Pepito 200 gr» → la presentación 200 g de la ficha existente, sin dudas', () => {
    const v = vincularLinea('MANTECA PEPITO 200 GR', itemsActivos(catalogo()));
    expect(v.presentacionId).toBe('mp200');
    expect(v.confianza).toBeGreaterThanOrEqual(0.75);
    expect(v.motivo).toBeUndefined();
  });
  it('2. «Manteca Pepito 200 gramos» → la misma presentación', () => {
    expect(vincularLinea('Manteca Pepito 200 gramos', itemsActivos(catalogo())).presentacionId).toBe('mp200');
    expect(vincularLinea('MANTECA PEPITO X 200GRS', itemsActivos(catalogo())).presentacionId).toBe('mp200');
  });
  it('3. presentación distinta (500 g) → no se vincula con la de 200 g: se sugiere agregarla a la ficha', () => {
    const v = vincularLinea('MANTECA PEPITO 500 GR', itemsActivos(catalogo()));
    expect(v.presentacionId).toBeNull();
    expect(v.productoSugeridoId).toBe('mp');
    expect(v.medida).toBe('500 g');
  });
  it('4. otra marca («Manteca La Serenísima 200 g») → no se asocia a Manteca Pepito', () => {
    const v = vincularLinea('MANTECA LA SERENISIMA 200 GR', itemsActivos(catalogo()));
    expect(v.presentacionId).toBeNull();
    expect(v.productoSugeridoId).toBeUndefined();
    expect(v.opciones).toBeUndefined();
  });
  it('4b. con las dos marcas en el catálogo, cada remito va a la suya', () => {
    const d = catalogo((x) => {
      x.productos.push({ id: 'ms', nombre: 'Manteca La Serenísima', perecedero: true, activo: true });
      x.presentaciones.push(pres('ms200', 'ms', '200 g', { contenido: 200, unidadContenido: 'g' }));
    });
    expect(vincularLinea('MANTECA LA SERENISIMA 200 GR', itemsActivos(d)).presentacionId).toBe('ms200');
    expect(vincularLinea('MANTECA PEPITO 200 GR', itemsActivos(d)).presentacionId).toBe('mp200');
  });
  it('5. no se puede determinar (sin marca y hay dos mantecas de 200 g) → opciones y hay que elegir', () => {
    const d = catalogo((x) => {
      x.productos.push({ id: 'ms', nombre: 'Manteca La Serenísima', perecedero: true, activo: true });
      x.presentaciones.push(pres('ms200', 'ms', '200 g', { contenido: 200, unidadContenido: 'g' }));
    });
    const v = vincularLinea('MANTECA 200 GR', itemsActivos(d));
    expect(v.presentacionId).toBeNull();
    expect(new Set(v.opciones)).toEqual(new Set(['mp200', 'ms200']));
  });
  it('5b. sin tamaño y la ficha tiene dos presentaciones → opciones', () => {
    const d = catalogo((x) => x.presentaciones.push(pres('mp500', 'mp', '500 g', { contenido: 500, unidadContenido: 'g' })));
    const v = vincularLinea('MANTECA PEPITO', itemsActivos(d));
    expect(v.presentacionId).toBeNull();
    expect(new Set(v.opciones)).toEqual(new Set(['mp200', 'mp500']));
  });
  it('remito sin marca y una sola manteca → se propone, pero hay que confirmarla', () => {
    const v = vincularLinea('MANTECA 200 GR', itemsActivos(catalogo()));
    expect(v.presentacionId).toBe('mp200');
    expect(v.confianza).toBeLessThan(0.75);
    expect(v.motivo).toMatch(/pepito/);
  });
  it('producto realmente desconocido → sin vínculo', () => {
    expect(vincularLinea('QUESO RALLADO 150 G', itemsActivos(catalogo())).presentacionId).toBeNull();
  });
  it('producto cargado con el tamaño en el nombre («Manteca x 200 g» · Única) también se reconoce', () => {
    const d = catalogo((x) => {
      x.productos = [{ id: 'mx', nombre: 'Manteca x 200 g', perecedero: true, activo: true }];
      x.presentaciones = [pres('u', 'mx', 'Única'), pres('m100', 'mx', '100 gr', { contenido: 100, unidadContenido: 'g' })];
    });
    expect(vincularLinea('MANTECA 200 GRAMOS', itemsActivos(d)).presentacionId).toBe('u');
    expect(vincularLinea('MANTECA 100 GR', itemsActivos(d)).presentacionId).toBe('m100');
  });
});

describe('revisión humana antes de confirmar', () => {
  const linea = (x: Partial<LineaBorrador>): LineaBorrador => ({ key: 'a', descripcion: 'x', presentacionId: 'mp200', cantidad: '10', fechaVencimiento: '', revisar: false, ignorada: false, ...x });
  it('una línea marcada para revisar no se puede confirmar sin confirmarla', () => {
    const r = validarRecepcion('p', '2026-10-26', [linea({ revisar: true })], '2026-10-26');
    expect(r.errorGeneral).toMatch(/revisar/);
  });
  it('6. corregida a mano (revisar=false) se confirma con la presentación elegida', () => {
    const r = validarRecepcion('p', '2026-10-26', [linea({ presentacionId: 'mp500', revisar: false })], '2026-10-26');
    expect(r.errorGeneral).toBeNull();
    expect(r.lineas).toEqual([{ presentacionId: 'mp500', cantidad: 10, fechaVencimiento: undefined }]);
  });
  it('sin fecha no se confirma', () => {
    expect(validarRecepcion('p', '', [linea({})], '2026-10-26').errores.fecha).toBe('Indicá la fecha.');
  });
});
