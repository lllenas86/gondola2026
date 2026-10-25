import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppData, Vistas } from '../types';
import { nuevoId } from '../lib/storage';
import { cargarTodo } from '../lib/datos';
import { mensajeError, type MensajeError } from '../lib/errores';
import {
  cargarPerfil, hayRoles, ingresar as ingresarAuth, onSesion, restaurarSesion, salir as salirAuth,
  type Perfil, type Rol, type Sesion,
} from '../lib/auth';
import { puede as puedeRol, type Accion } from '../lib/permisos';

// Estado global. Supabase es la única fuente de datos: no hay copia en el navegador.
// Después de cada cambio se vuelve a leer la base, así todas las pantallas
// (por ejemplo, Hoy después de guardar un conteo) se actualizan sin recargar.

export type Conexion = 'cargando' | 'conectado' | 'sin_conexion';

/**
 * abierto: la base no tiene usuarios (sin supabase/05) → la app funciona como antes, sin login.
 * seguro:  la base exige sesión y aplica permisos por almacén y rol.
 */
export type Modo = 'detectando' | 'abierto' | 'seguro';

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
  modo: Modo;
  sesion: Sesion | null;
  perfil: Perfil | null;
  /** null en modo abierto */
  rol: Rol | null;
  puede: (a: Accion) => boolean;
  ingresar: (email: string, password: string) => Promise<MensajeError | null>;
  salir: () => Promise<void>;
}

const VACIO: AppData = {
  productos: [], presentaciones: [], proveedores: [], presentacionProveedor: [], conteos: [], recepciones: [],
  borradores: [], devoluciones: [], bajas: [], alias: [],
};
const VISTAS_VACIAS: Vistas = { stock: [], visitas: [], consumo: [], tieneTelefono: false };
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
  const [modo, setModo] = useState<Modo>('detectando');
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const contador = useRef(0);
  const lectura = useRef(0);
  const habilitado = useRef(false);

  const avisar = useCallback((texto: string, tipo: Aviso['tipo'] = 'ok') => {
    const id = ++contador.current;
    setAvisos((a) => [...a, { id, texto, tipo }]);
    window.setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === 'error' ? 6000 : 3500);
  }, []);

  const recargar = useCallback(async (): Promise<boolean> => {
    if (!habilitado.current) return false;
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

  /** Con sesión iniciada: busca el almacén y el rol, y recién ahí lee los datos. */
  const prepararSesion = useCallback(async (): Promise<MensajeError | null> => {
    try {
      const p = await cargarPerfil();
      setPerfil(p);
      if (!p) {
        habilitado.current = false;
        setConexion('conectado');
        return { texto: 'Tu usuario todavía no está asociado a ningún almacén. Pedile al dueño que te agregue.' };
      }
      habilitado.current = true;
      await recargar();
      return null;
    } catch (e) {
      setConexion('sin_conexion');
      return mensajeError(e);
    }
  }, [recargar]);

  useEffect(() => {
    let vivo = true;
    const off = onSesion((s) => {
      setSesion(s);
      if (!s && vivo) {
        // Se cerró la sesión (o venció): no queda ningún dato en pantalla
        habilitado.current = false;
        setPerfil(null);
        setData(VACIO);
        setVistas(VISTAS_VACIAS);
        setCargado(false);
      }
    });
    (async () => {
      try {
        const conRoles = await hayRoles();
        if (!vivo) return;
        if (!conRoles) {
          setModo('abierto');
          habilitado.current = true;
          await recargar();
          return;
        }
        setModo('seguro');
        const s = await restaurarSesion();
        if (!vivo) return;
        setSesion(s);
        if (s) await prepararSesion();
        else setConexion('conectado');
      } catch (e) {
        if (!vivo) return;
        setConexion('sin_conexion');
        setErrorCarga(mensajeError(e).texto);
      }
    })();
    return () => {
      vivo = false;
      off();
    };
  }, [recargar, prepararSesion]);

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

  const ingresar = useCallback(async (email: string, password: string): Promise<MensajeError | null> => {
    try {
      await ingresarAuth(email, password);
    } catch (e) {
      return mensajeError(e);
    }
    return prepararSesion();
  }, [prepararSesion]);

  const salir = useCallback(async () => {
    await salirAuth();
  }, []);

  useEffect(() => {
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

  const rol = modo === 'abierto' ? null : perfil?.rol ?? null;
  const puede = useCallback((a: Accion) => (modo === 'seguro' && !perfil ? false : puedeRol(rol, a)), [modo, perfil, rol]);

  const value = useMemo(
    () => ({ data, vistas, conexion, cargado, errorCarga, recargar, ejecutar, avisar, avisos, nuevoId, modo, sesion, perfil, rol, puede, ingresar, salir }),
    [data, vistas, conexion, cargado, errorCarga, recargar, ejecutar, avisar, avisos, modo, sesion, perfil, rol, puede, ingresar, salir],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore fuera de StoreProvider');
  return s;
}
