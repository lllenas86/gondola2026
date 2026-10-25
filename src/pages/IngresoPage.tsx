import { useState, type FormEvent } from 'react';
import { CLAVE_EVALUACION, CUENTAS_EVALUACION } from '../lib/evaluacion';
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

  const entrar = async (mail: string, clave: string) => {
    if (entrando) return;
    if (!mail.trim() || !clave) { setError('Completá el email y la contraseña.'); return; }
    setEntrando(true);
    setError(null);
    const r = await ingresar(mail, clave);
    setEntrando(false);
    if (r) setError(r.texto);
  };

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    void entrar(email, password);
  };

  /** Acceso rápido: completa los datos de la cuenta de evaluación y entra. */
  const accesoRapido = (mail: string) => {
    setEmail(mail);
    setPassword(CLAVE_EVALUACION);
    void entrar(mail, CLAVE_EVALUACION);
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
      <section className="tarjeta" aria-label="Acceso rápido para evaluación">
        <h2 className="tarjeta-titulo">Acceso rápido para evaluación</h2>
        <p className="texto-suave">Elegí un perfil para entrar con su cuenta de prueba (clave <strong>{CLAVE_EVALUACION}</strong>). Cada perfil ve y puede hacer cosas distintas.</p>
        <ul className="lista-catalogo">
          {CUENTAS_EVALUACION.map((u) => (
            <li key={u.email}>
              <button type="button" className="item-catalogo" disabled={entrando} onClick={() => accesoRapido(u.email)}>
                <span><strong>{u.rol}</strong> · {u.email}<br /><span className="texto-suave">{u.detalle}</span></span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
