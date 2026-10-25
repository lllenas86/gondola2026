import { useState } from 'react';
import { useStore } from '../state/store';
import { irA } from '../lib/router';
import { EstadoConexion } from '../components/ui';
import { ConteoStock } from '../features/stock/ConteoStock';
import { Vencimientos } from '../features/stock/Vencimientos';
import { Devoluciones } from '../features/stock/Devoluciones';
import { HistorialStock } from '../features/stock/HistorialStock';
import { DevolucionForm, type LineaInicial } from '../features/stock/DevolucionForm';
import { DevolucionDetalle } from '../features/stock/DevolucionDetalle';
import { BajaForm } from '../features/stock/BajaForm';
import type { Lote } from '../types';

type Pestana = 'conteo' | 'vencimientos' | 'devoluciones' | 'historial';
const PESTANAS: { id: Pestana; label: string }[] = [
  { id: 'conteo', label: 'Conteo de stock' },
  { id: 'vencimientos', label: 'Vencimientos' },
  { id: 'devoluciones', label: 'Devoluciones' },
  { id: 'historial', label: 'Historial' },
];

/**
 * Stock: todo lo que pasa con la mercadería que ya está en el almacén, sin depender del proveedor.
 * El proveedor solo aparece donde corresponde: devoluciones (y, en otras secciones, recepciones y pedidos).
 */
export function StockPage({ params }: { params: URLSearchParams }) {
  const { data, vistas } = useStore();
  const p = params.get('pestana');
  const pestana: Pestana = PESTANAS.some((x) => x.id === p) ? (p as Pestana) : 'conteo';
  const [nuevaDevolucion, setNuevaDevolucion] = useState<LineaInicial | 'vacia' | null>(null);
  const [verDevolucion, setVerDevolucion] = useState<string | null>(null);
  const [baja, setBaja] = useState<Lote | null>(null);

  const ir = (id: Pestana) => irA('stock', id === 'conteo' ? undefined : { pestana: id });
  const vencidos = vistas.lotes.filter((l) => l.estado === 'vencido').length;
  const abiertas = data.devoluciones.filter((d) => d.estado === 'preparada' || d.estado === 'entregada').length;
  const contador: Partial<Record<Pestana, number>> = { vencimientos: vencidos, devoluciones: abiertas };

  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Stock</p>
        <h1>{PESTANAS.find((x) => x.id === pestana)?.label}</h1>
      </header>

      <div className="pestanas pestanas-4" role="tablist" aria-label="Stock">
        {PESTANAS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={pestana === x.id} className={pestana === x.id ? 'activo' : ''} onClick={() => ir(x.id)}>
            {x.label.replace(' de stock', '')}
            {contador[x.id] ? <span className="contador-pestana">{contador[x.id]}</span> : null}
          </button>
        ))}
      </div>

      {pestana === 'conteo' && <ConteoStock key={params.get('proveedor') ?? ''} proveedorInicial={params.get('proveedor')} onGuardado={() => ir('historial')} />}
      {pestana === 'vencimientos' && (
        <Vencimientos
          onDevolver={(l) => setNuevaDevolucion({ productoId: l.productoId, fechaVencimiento: l.fechaVencimiento })}
          onBaja={setBaja}
          onVerDevolucion={setVerDevolucion}
          onIrDevoluciones={() => ir('devoluciones')}
        />
      )}
      {pestana === 'devoluciones' && <Devoluciones onNueva={() => setNuevaDevolucion('vacia')} onVer={setVerDevolucion} />}
      {pestana === 'historial' && <HistorialStock />}

      {nuevaDevolucion && (
        <DevolucionForm
          inicial={nuevaDevolucion === 'vacia' ? undefined : nuevaDevolucion}
          onCerrar={() => setNuevaDevolucion(null)}
          onPreparada={(id) => {
            setNuevaDevolucion(null);
            setVerDevolucion(id);
          }}
        />
      )}
      {verDevolucion && <DevolucionDetalle id={verDevolucion} onCerrar={() => setVerDevolucion(null)} />}
      {baja && <BajaForm lote={baja} onCerrar={() => setBaja(null)} />}
    </>
  );
}
