-- Bases de cada servicio en el contenedor de PostgreSQL (perfil "bases"). Solo corre con el volumen vacío.
-- Cada servicio crea sus tablas con sus migraciones. reportes_db (401) y su usuario ia los crea init-reportes.sh.
CREATE DATABASE obras_db;
CREATE DATABASE finanzas_db;
