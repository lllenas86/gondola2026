import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppData, Vistas } from '../types';
import { nuevoId } from '../lib/storage';
import { cargarTodo } from '../lib/datos';
import { mensajeError, type MensajeError } from '../lib/errores';

// Estado global. Supabase es la única fuente de datos: no hay copia en el navegador.
// Después de cada cambio se vuelve a leer la base, así todas las pantallas
// (por ejemplo, Hoy después de guardar un conteo) se actualizan sin recargar.

export type Conexion = 'cargando' | 'conectado' | 'sin_conexion';

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: MensajeError };

export interface Aviso {
  id: number;
  texto: string;
  tipo: 'ok' | 'error' | 'info';
}

interface Store {
  data: AppData;
  vistas: Vistas;
  conexion: Conexion;
  /** true cuando ya se leyó la base al menos una vez */
  cargado: boolean;
  /** Motivo del último error al leer la base (null si leyó bien) */
  errorCarga: string | null;
  recargar: () => Promise<boolean>;
  /** Ejecuta una escritura en la base, traduce los errores y, si sale bien, vuelve a leer los datos. */
  ejecutar: <T>(operacion: () => Promise<T>) => Promise<Resultado<T>>;
  avisar: (texto: string, tipo?: Aviso['tipo']) => void;
  avisos: Aviso[];
  nuevoId: typeof nuevoId;
}

const VACIO: AppData = { productos: [], proveedores: [], productoProveedor: [], conteos: [], recepciones: [], borradores: [] };
const VISTAS_VACIAS: Vistas = { stock: [], visitas: [], vencimientos: [], consumo: [], tieneTelefono: false };
/** Cada cuánto se vuelve a leer la base para ver cambios hechos desde otro celular. */
const REFRESCO_MS = 30_000;

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(VACIO);
  const [vistas, setVistas] = useState<Vistas>(VISTAS_VACIAS);
  const [conexion, setConexion] = useState<Conexion>('cargando');
  const [cargado, setCargado] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const contador = useRef(0);
  const lectura = useRef(0);

  const avisar = useCallback((texto: string, tipo: Aviso['tipo'] = 'ok') => {
    const id = ++contador.current;
    setAvisos((a) => [...a, { id, texto, tipo }]);
    window.setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === 'error' ? 6000 : 3500);
  }, []);

  const recargar = useCallback(async (): Promise<boolean> => {
    const n = ++lectura.current;
    try {
      const r = await cargarTodo();
      if (n !== lectura.current) return true; // llegó una lectura más nueva
      setData(r.data);
      setVistas(r.vistas);
      setConexion('conectado');
      setCargado(true);
      setErrorCarga(null);
      return true;
    } catch (e) {
      if (n !== lectura.current) return false;
      // Nunca se cae en silencio a datos locales: se muestra el aviso de sin conexión.
      setConexion('sin_conexion');
      setErrorCarga(mensajeError(e).texto);
      return false;
    }
  }, []);

  const ejecutar = useCallback(async <T,>(operacion: () => Promise<T>): Promise<Resultado<T>> => {
    try {
      const valor = await operacion();
      await recargar();
      return { ok: true, valor };
    } catch (e) {
      const error = mensajeError(e);
      if (error.sinConexion) setConexion('sin_conexion');
      else void recargar(); // la base rechazó: se relee por si quedó algo a medias
      return { ok: false, error };
    }
  }, [recargar]);

  useEffect(() => {
    void recargar();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void recargar();
    }, REFRESCO_MS);
    const alVolver = () => {
      if (document.visibilityState === 'visible') void recargar();
    };
    const sinRed = () => setConexion('sin_conexion');
    const conRed = () => void recargar();
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    window.addEventListener('offline', sinRed);
    window.addEventListener('online', conRed);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
      window.removeEventListener('offline', sinRed);
      window.removeEventListener('online', conRed);
    };
  }, [recargar]);

  const value = useMemo(
    () => ({ data, vistas, conexion, cargado, errorCarga, recargar, ejecutar, avisar, avisos, nuevoId }),
    [data, vistas, conexion, cargado, errorCarga, recargar, ejecutar, avisar, avisos],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore fuera de StoreProvider');
  return s;
}
