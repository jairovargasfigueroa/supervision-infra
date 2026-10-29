-- Bases de cada servicio en el contenedor de PostgreSQL (perfil "bases"). Solo corre con el volumen vacío.
-- Cada servicio crea sus tablas con sus migraciones. reportes_db se agrega en la capa 4 (401).
CREATE DATABASE obras_db;
CREATE DATABASE finanzas_db;
