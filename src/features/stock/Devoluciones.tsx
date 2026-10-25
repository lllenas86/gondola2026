import { useStore } from '../../state/store';
import { formatFechaCorta } from '../../lib/dates';
import { ESTADOS_DEVOLUCION, MOTIVOS, numeroRemito } from '../../lib/vencimientos';
import { Vacio } from '../../components/ui';
import { Icon } from '../../components/Icon';
import type { Devolucion } from '../../types';

const ETIQUETA: Record<Devolucion['estado'], string> = {
  preparada: 'etiqueta-ambar',
  entregada: 'etiqueta-azul',
  resuelta: 'etiqueta-gris',
  cancelada: 'etiqueta-gris',
};

/** Devoluciones y cambios con el proveedor, agrupados por estado. */
export function Devoluciones({ onNueva, onVer }: { onNueva: () => void; onVer: (id: string) => void }) {
  const { data } = useStore();
  const grupos: { titulo: string; items: Devolucion[]; vacio?: string }[] = [
    { titulo: 'Preparadas · sin entregar', items: data.devoluciones.filter((d) => d.estado === 'preparada') },
    { titulo: 'Entregadas · esperando respuesta', items: data.devoluciones.filter((d) => d.estado === 'entregada') },
    { titulo: 'Cerradas', items: data.devoluciones.filter((d) => d.estado === 'resuelta' || d.estado === 'cancelada').slice(0, 20) },
  ];

  return (
    <>
      <button type="button" className="btn btn-primario btn-bloque" onClick={onNueva}>
        <Icon name="mas" /> Nueva devolución
      </button>
      {data.devoluciones.length === 0 && <Vacio titulo="Todavía no hay devoluciones." />}
      {grupos.filter((g) => g.items.length > 0).map((g) => (
        <section key={g.titulo} className="seccion">
          <h2 className="seccion-titulo">{g.titulo}</h2>
          <ul className="lista-catalogo">
            {g.items.map((d) => {
              const prov = data.proveedores.find((p) => p.id === d.proveedorId)?.nombre ?? 'Proveedor';
              const unidades = d.lineas.reduce((a, l) => a + l.cantidad, 0);
              return (
                <li key={d.id}>
                  <button type="button" className="item-catalogo" onClick={() => onVer(d.id)}>
                    <div>
                      <p className="item-titulo">N° {numeroRemito(d.numero)} · {prov}</p>
                      <p className="texto-suave">
                        {formatFechaCorta(d.fecha)} · {d.tipo === 'cambio' ? 'cambio' : 'devolución'} · {MOTIVOS[d.motivo].toLowerCase()} · {d.lineas.length} {d.lineas.length === 1 ? 'ítem' : 'ítems'} ({String(unidades).replace('.', ',')} u.)
                      </p>
                      <div className="etiquetas">
                        <span className={`etiqueta ${ETIQUETA[d.estado]}`}>{ESTADOS_DEVOLUCION[d.estado]}</span>
                        {d.estado === 'resuelta' && (
                          <span className={`etiqueta ${d.respuestaProveedor === 'aceptada' ? 'etiqueta-verde' : 'etiqueta-rojo'}`}>
                            {d.respuestaProveedor === 'aceptada' ? 'Aceptada' : 'Rechazada'}
                          </span>
                        )}
                      </div>
                    </div>
                    <Icon name="derecha" className="icono-suave" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
