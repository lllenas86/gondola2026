insert into auth.users (email, password_prueba) values
  ('duena@prueba.ar','clave123'),('encargado@prueba.ar','clave123'),('empleado@prueba.ar','clave123'),('otro@prueba.ar','clave123');
select gondola_asignar_primer_dueno('duena@prueba.ar');
insert into almacenes (nombre) values ('Otro almacén');
insert into miembros (user_id, almacen_id, rol, email) select id, (select id from almacenes where nombre='Otro almacén'), 'dueno', email from auth.users where email='otro@prueba.ar';
-- Encargado y empleado en el almacén de la dueña (las pruebas R4–R9 los necesitan desde el inicio)
insert into miembros (user_id, almacen_id, rol, email)
select u.id, (select almacen_id from miembros where email = 'duena@prueba.ar'), r.rol, u.email
from auth.users u join (values ('encargado@prueba.ar','encargado'), ('empleado@prueba.ar','empleado')) r(email, rol) on r.email = u.email
on conflict do nothing;
