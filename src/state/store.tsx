import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { AppData, Conteo, Producto, Proveedor, Recepcion } from '../types';
import { cargarDatos, guardarDatos, nuevoId } from '../lib/storage';
import { crearDatosDeEjemplo } from '../lib/seed';

type Accion =
  | { type: 'guardarProducto'; producto: Producto; proveedorIds?: string[] }
  | { type: 'guardarProveedor'; proveedor: Proveedor; productoIds: string[] }
  | { type: 'registrarConteos'; conteos: Conteo[] }
  | { type: 'registrarRecepcion'; recepcion: Recepcion }
  | { type: 'restablecer'; data: AppData };

function reducer(state: AppData, a: Accion): AppData {
  switch (a.type) {
    case 'guardarProducto': {
      const existe = state.productos.some((p) => p.id === a.producto.id);
      const productos = existe
        ? state.productos.map((p) => (p.id === a.producto.id ? a.producto : p))
        : [...state.productos, a.producto];
      let productoProveedor = state.productoProveedor;
      if (a.proveedorIds) {
        productoProveedor = [
          ...productoProveedor.filter((pp) => pp.productoId !== a.producto.id),
          ...a.proveedorIds.map((proveedorId) => ({ proveedorId, productoId: a.producto.id })),
        ];
      }
      return { ...state, productos, productoProveedor };
    }
    case 'guardarProveedor': {
      const existe = state.proveedores.some((p) => p.id === a.proveedor.id);
      const proveedores = existe
        ? state.proveedores.map((p) => (p.id === a.proveedor.id ? a.proveedor : p))
        : [...state.proveedores, a.proveedor];
      const productoProveedor = [
        ...state.productoProveedor.filter((pp) => pp.proveedorId !== a.proveedor.id),
        ...a.productoIds.map((productoId) => ({ proveedorId: a.proveedor.id, productoId })),
      ];
      return { ...state, proveedores, productoProveedor };
    }
    case 'registrarConteos':
      // Nunca se borra ni se reemplaza un conteo anterior: solo se agregan.
      return { ...state, conteos: [...state.conteos, ...a.conteos] };
    case 'registrarRecepcion':
      return { ...state, recepciones: [...state.recepciones, a.recepcion] };
    case 'restablecer':
      return a.data;
  }
}

export interface Aviso {
  id: number;
  texto: string;
  tipo: 'ok' | 'error' | 'info';
}

interface Store {
  data: AppData;
  dispatch: (a: Accion) => void;
  avisar: (texto: string, tipo?: Aviso['tipo']) => void;
  avisos: Aviso[];
  restablecer: () => void;
  nuevoId: typeof nuevoId;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(reducer, undefined, cargarDatos);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const contador = useRef(0);

  const avisar = useCallback((texto: string, tipo: Aviso['tipo'] = 'ok') => {
    const id = ++contador.current;
    setAvisos((a) => [...a, { id, texto, tipo }]);
    window.setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 3500);
  }, []);

  useEffect(() => {
    if (guardarDatos(data)) return;
    // Almacenamiento lleno (casi siempre por las fotos): se guardan los datos sin las fotos.
    const sinFotos: AppData = {
      ...data,
      recepciones: data.recepciones.map((r) => (r.imagen?.startsWith('data:') ? { ...r, imagen: undefined } : r)),
    };
    if (guardarDatos(sinFotos)) avisar('Se guardaron los datos, pero no las fotos: el navegador no tiene más espacio.', 'info');
    else avisar('No se pudieron guardar los cambios en este navegador.', 'error');
  }, [data, avisar]);

  const restablecer = useCallback(() => dispatch({ type: 'restablecer', data: crearDatosDeEjemplo() }), []);

  const value = useMemo(() => ({ data, dispatch, avisar, avisos, restablecer, nuevoId }), [data, avisar, avisos, restablecer]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore fuera de StoreProvider');
  return s;
}
