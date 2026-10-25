import { useState, type FormEvent } from 'react';
import { CLAVE_DEMO, USUARIOS_DEMO } from '../demo/usuarios';
import { useStore } from '../state/store';
import { Campo } from '../components/ui';
import { Icon } from '../components/Icon';

/** Inicio de sesión (Supabase Auth). Solo aparece si la base tiene usuarios (supabase/05). */
export function IngresoPage() {
  const { ingresar, sesion, perfil, salir } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (entrando) return;
    if (!email.trim() || !password) { setError('Completá el email y la contraseña.'); return; }
    setEntrando(true);
    setError(null);
    const r = await ingresar(email, password);
    setEntrando(false);
    if (r) setError(r.texto);
  };

  // Con sesión pero sin almacén asignado
  if (sesion && !perfil) {
    return (
      <main className="app app-ingreso">
        <header className="cabecera"><p className="cabecera-marca">Góndola</p><h1>Falta tu almacén</h1></header>
        <div className="tarjeta">
          <p>Ingresaste como <strong>{sesion.usuario.email}</strong>, pero tu usuario todavía no está asociado a ningún almacén.</p>
          <p className="texto-suave">Pedile al dueño que te agregue desde «Equipo».</p>
          <button type="button" className="btn btn-secundario btn-bloque boton-pedido" onClick={() => void salir()}>Salir</button>
        </div>
      </main>
    );
  }

  return (
    <main className="app app-ingreso">
      <header className="cabecera">
        <p className="cabecera-marca">Góndola</p>
        <h1>Ingresá a tu almacén</h1>
      </header>
      <form className="tarjeta" onSubmit={enviar} noValidate>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Campo etiqueta="Email" htmlFor="ing-email">
          <input id="ing-email" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Campo>
        <Campo etiqueta="Contraseña" htmlFor="ing-pass">
          <input id="ing-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Campo>
        <button type="submit" className="btn btn-primario btn-bloque btn-grande" disabled={entrando}>
          <Icon name="check" /> {entrando ? 'Ingresando…' : 'Ingresar'}
        </button>
        <p className="texto-suave nota-seccion">Los usuarios los crea el dueño del almacén. Si no tenés uno, pedíselo.</p>
      </form>
      {import.meta.env.VITE_DEMO === '1' && (
        <section className="tarjeta" aria-label="Usuarios de prueba">
          <h2 className="tarjeta-titulo">Usuarios de prueba (datos ficticios)</h2>
          <p className="texto-suave">Tocá uno para completar el ingreso. Todos usan la clave <strong>{CLAVE_DEMO}</strong>.</p>
          <ul className="lista-catalogo">
            {USUARIOS_DEMO.map((u) => (
              <li key={u.email}>
                <button type="button" className="item-catalogo" onClick={() => { setEmail(u.email); setPassword(CLAVE_DEMO); setError(null); }}>
                  <span><strong>{u.rol}</strong> · {u.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
