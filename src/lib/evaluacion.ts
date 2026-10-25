// Cuentas de evaluación (trabajo académico): tres usuarios REALES de Supabase Auth, uno por rol,
// para que se puedan probar las tres vistas con un toque. La clave es pública a propósito y
// se muestra en la pantalla de ingreso. Los permisos los aplica la base (supabase/05 y 06):
// estas cuentas no tienen ningún privilegio extra. No hay claves de servicio en la app.
export const CUENTAS_EVALUACION = [
  { email: 'duena.gondola@example.com', rol: 'Dueña', detalle: 'Panel, vencimientos, proyección, pedidos, catálogo y equipo' },
  { email: 'encargado.gondola@example.com', rol: 'Encargado', detalle: 'Operación del día, pedidos, stock, recepción y devoluciones' },
  { email: 'empleado.gondola@example.com', rol: 'Empleado', detalle: 'Tareas, conteo de stock, recepción y vencimientos (consulta)' },
] as const;

export const CLAVE_EVALUACION = 'demo1234';
