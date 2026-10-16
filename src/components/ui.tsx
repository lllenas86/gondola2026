import { useEffect, type ReactNode } from 'react';
import type { DiaSemana } from '../types';
import { DIAS_CORTOS, ORDEN_SEMANA } from '../lib/dates';
import { Icon } from './Icon';
import { useStore } from '../state/store';

export function Hoja({ titulo, onCerrar, children, pie }: { titulo: string; onCerrar: () => void; children: ReactNode; pie?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('sin-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('sin-scroll');
    };
  }, [onCerrar]);

  return (
    <div className="hoja-fondo" onClick={onCerrar}>
      <div className="hoja" role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()}>
        <div className="hoja-cabecera">
          <h2>{titulo}</h2>
          <button type="button" className="btn-icono" onClick={onCerrar} aria-label="Cerrar">
            <Icon name="cerrar" />
          </button>
        </div>
        <div className="hoja-cuerpo">{children}</div>
        {pie && <div className="hoja-pie">{pie}</div>}
      </div>
    </div>
  );
}

export function Campo({ etiqueta, error, children, ayuda, htmlFor }: { etiqueta: string; error?: string; ayuda?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className={`campo${error ? ' campo-error' : ''}`}>
      <label htmlFor={htmlFor}>{etiqueta}</label>
      {children}
      {ayuda && !error && <p className="campo-ayuda">{ayuda}</p>}
      {error && <p className="campo-msg" role="alert">{error}</p>}
    </div>
  );
}

export function SelectorDias({ valor, onChange }: { valor: DiaSemana[]; onChange: (d: DiaSemana[]) => void }) {
  return (
    <div className="dias" role="group" aria-label="Días de visita">
      {ORDEN_SEMANA.map((d) => {
        const activo = valor.includes(d);
        return (
          <button
            key={d}
            type="button"
            className={`dia${activo ? ' activo' : ''}`}
            aria-pressed={activo}
            onClick={() => onChange(activo ? valor.filter((x) => x !== d) : [...valor, d])}
          >
            {DIAS_CORTOS[d]}
          </button>
        );
      })}
    </div>
  );
}

export function Avisos() {
  const { avisos } = useStore();
  return (
    <div className="avisos" aria-live="polite">
      {avisos.map((a) => (
        <div key={a.id} className={`aviso aviso-${a.tipo}`}>
          <Icon name={a.tipo === 'error' ? 'alerta' : 'check'} size={18} />
          <span>{a.texto}</span>
        </div>
      ))}
    </div>
  );
}

export function Vacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="vacio">
      <p className="vacio-titulo">{titulo}</p>
      {children}
    </div>
  );
}
