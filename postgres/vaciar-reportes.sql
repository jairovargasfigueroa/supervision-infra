-- 401 · recargar: vacía el modelo de lectura de reportes_db (tablas rpt_*, evento_aplicado y carga_inicial) para
-- que la carga inicial lo vuelva a llenar con los datos de prueba nuevos. Nunca toca alembic_version (historial de
-- las migraciones). Lo corre semilla/recargar.* con el servicio psql-cli (usuario ia, dueño de las tablas).
DO $$
DECLARE
    tablas text;
BEGIN
    SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename)
      INTO tablas
      FROM pg_tables
     WHERE schemaname = 'public'
       AND (tablename LIKE 'rpt\_%' OR tablename IN ('evento_aplicado', 'carga_inicial'));
    IF tablas IS NULL THEN
        RAISE NOTICE 'reportes_db no tiene tablas del modelo de lectura todavía (faltan las migraciones de IA): nada que vaciar';
    ELSE
        EXECUTE 'TRUNCATE TABLE ' || tablas;
        RAISE NOTICE 'reportes_db vaciada: %', tablas;
    END IF;
END
$$;
