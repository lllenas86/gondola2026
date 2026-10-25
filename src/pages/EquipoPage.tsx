import { useEffect, useState, type FormEvent } from 'react';
import { useStore } from '../state/store';
import { guardarMiembro, listarEquipo, quitarMiembro, type Miembro } from '../lib/datos';
import { NOMBRE_ROL, type Rol } from '../lib/auth';
import { mensajeError } from '../lib/errores';
import { Campo } from '../components/ui';
import { EstadoConexion } from '../components/ui';

// Equipo del almacén (solo el dueño). La base verifica el permiso en cada operación.
export function EquipoPage() {
  const { perfil, sesion, ejecutar, avisar } = useStore();
  const [equipo, setEquipo] = useState<Miembro[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<Rol>('empleado');
  const [guardando, setGuardando] = useState(false);

  const cargar = async () => {
    try {
      setEquipo(await listarEquipo());
    } catch (e) {
      setError(mensajeError(e).texto);
    }
  };
  useEffect(() => { void cargar(); }, []);

  const agregar = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Escribí el email.'); return; }
    setGuardando(true);
    const r = await ejecutar(() => guardarMiembro(email, rol));
    setGuardando(false);
    if (!r.ok) { setError(r.error.texto); return; }
    setError(null);
    setEmail('');
    avisar('Equipo actualizado.');
    void cargar();
  };
  const cambiar = async (m: Miembro, nuevo: Rol) => {
    const r = await ejecutar(() => guardarMiembro(m.email, nuevo));
    if (!r.ok) setError(r.error.texto); else { setError(null); void cargar(); }
  };
  const quitar = async (m: Miembro) => {
    if (!window.confirm(`¿Quitar a ${m.email} del almacén?`)) return;
    const r = await ejecutar(() => quitarMiembro(m.userId));
    if (!r.ok) setError(r.error.texto); else { setError(null); void cargar(); }
  };

  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Equipo · {perfil?.almacen}</p>
        <h1>Usuarios y roles</h1>
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}
      <ul className="lista-catalogo">
        {(equipo ?? []).map((m) => (
          <li key={m.userId} className="item-catalogo item-equipo">
            <div>
              <p className="item-titulo">{m.email}{m.userId === sesion?.usuario.id ? ' (vos)' : ''}</p>
              <select aria-label={`Rol de ${m.email}`} value={m.rol} onChange={(e) => void cambiar(m, e.target.value as Rol)}>
                {(Object.keys(NOMBRE_ROL) as Rol[]).map((r) => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}
              </select>
            </div>
            {m.userId !== sesion?.usuario.id && <button type="button" className="btn btn-fantasma btn-chico" onClick={() => void quitar(m)}>Quitar</button>}
          </li>
        ))}
      </ul>
      <form className="tarjeta lista-con-margen" onSubmit={agregar} noValidate>
        <h3 className="tarjeta-titulo">Agregar a alguien</h3>
        <p className="texto-suave">Primero creá su usuario en Supabase → Authentication → Users (email y contraseña). Después agregalo acá con su rol.</p>
        <Campo etiqueta="Email" htmlFor="eq-email"><input id="eq-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Campo>
        <Campo etiqueta="Rol" htmlFor="eq-rol">
          <select id="eq-rol" value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
            {(Object.keys(NOMBRE_ROL) as Rol[]).map((r) => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}
          </select>
        </Campo>
        <button type="submit" className="btn btn-primario btn-bloque" disabled={guardando}>{guardando ? 'Guardando…' : 'Agregar al equipo'}</button>
      </form>
      <div className="tarjeta">
        <h3 className="tarjeta-titulo">Qué puede hacer cada rol</h3>
        <ul className="motivos">
          <li><strong>Empleado / repositor:</strong> recibir mercadería, leer y revisar remitos, contar el stock, crear un producto que llegó y no estaba, consultar vencimientos.</li>
          <li><strong>Encargado:</strong> además, catálogo y proveedores, pedidos, devoluciones, bajas y proyección.</li>
          <li><strong>Dueño:</strong> además, panel general, equipo y restablecer la demo.</li>
        </ul>
      </div>
    </>
  );
}
