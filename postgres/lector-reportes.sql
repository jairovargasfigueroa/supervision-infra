-- 503 · Usuario de solo lectura del constructor de reportes del servicio de IA: rol ia_reportes_lector con LOGIN y
-- default_transaction_read_only = on. Idempotente: crea el rol si no existe y, si existe, le vuelve a poner la
-- contraseña y las opciones. Se ejecuta como superusuario (postgres) con la variable de psql "clave":
--   psql -v ON_ERROR_STOP=1 -v clave='<POSTGRES_IA_LECTOR_CLAVE>' -f lector-reportes.sql
-- Lo corre postgres/init-reportes.sh al crear el volumen; en una base que ya existe, el comando del README.
-- Los GRANT SELECT sobre rpt_obra_resumen, rpt_consumo_material, rpt_movimiento, rpt_cobro y rpt_planilla NO van
-- aquí: los aplica la migración 0002_lector_reportes del servicio de IA (después de crear las tablas), que falla si
-- este rol todavía no existe.
SELECT format('CREATE ROLE ia_reportes_lector LOGIN PASSWORD %L', :'clave')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ia_reportes_lector')
\gexec
SELECT format('ALTER ROLE ia_reportes_lector LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'clave')
\gexec
ALTER ROLE ia_reportes_lector SET default_transaction_read_only = on;
