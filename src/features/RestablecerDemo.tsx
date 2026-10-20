import { useState } from 'react';
import { useStore } from '../state/store';
import { Hoja } from '../components/ui';
import { Icon } from '../components/Icon';
import { restablecerDemo } from '../lib/datos';

// Vuelve la base a los datos de ejemplo, con los dos remitos de ejemplo otra vez en borrador.
// Llama a la función gondola_restablecer_demo() de supabase/03_pedido_y_demo.sql.

export function BotonRestablecerDemo({ variante = 'tarjeta' }: { variante?: 'tarjeta' | 'boton' }) {
  const { ejecutar, avisar } = useStore();
  const [confirmando, setConfirmando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restablecer = async () => {
    setTrabajando(true);
    setError(null);
    const r = await ejecutar(restablecerDemo);
    setTrabajando(false);
    if (!r.ok) {
      setError(r.error.texto);
      return;
    }
    setConfirmando(false);
    avisar('Demo restablecida: volvieron los datos y los remitos de ejemplo.');
  };

  const boton = (
    <button type="button" className="btn btn-secundario btn-bloque" onClick={() => setConfirmando(true)}>
      <Icon name="reiniciar" /> Restablecer demo
    </button>
  );

  return (
    <>
      {variante === 'boton' ? (
        boton
      ) : (
        <section className="tarjeta tarjeta-reset">
          <h3 className="tarjeta-titulo"><Icon name="reiniciar" /> Restablecer demo</h3>
          <p className="texto-suave">
            Borra lo que se cargó y vuelve a los datos de ejemplo, con los dos remitos de ejemplo listos para revisar. Afecta a todos los que usan este link.
          </p>
          {boton}
        </section>
      )}

      {confirmando && (
        <Hoja
          titulo="¿Restablecer la demo?"
          onCerrar={() => !trabajando && setConfirmando(false)}
          pie={
            <div className="acciones-2 sin-margen-arriba">
              <button type="button" className="btn btn-fantasma" onClick={() => setConfirmando(false)} disabled={trabajando}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primario" onClick={() => void restablecer()} disabled={trabajando}>
                {trabajando ? 'Restableciendo…' : 'Sí, restablecer'}
              </button>
            </div>
          }
        >
          {error && <p className="form-error" role="alert">{error}</p>}
          <p>Se borran todos los conteos, recepciones, productos y proveedores, y se cargan de nuevo los datos de ejemplo.</p>
          <p className="texto-suave">Lo ven todas las personas que tengan abierto el link. No se puede deshacer.</p>
        </Hoja>
      )}
    </>
  );
}
