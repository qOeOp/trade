-- Every SECURITY DEFINER routine in this database runs as its owner, so an unqualified relation or
-- type name in its body resolves through its search_path. PostgreSQL searches pg_temp first when the
-- path does not name it, and measured on PostgreSQL 16 an unqualified `jsonb` then resolves to a
-- domain the caller created in pg_temp. So the path must end in pg_temp, and every schema before it
-- other than pg_catalog must be one no role but the routine's owner can create objects in.
--
-- The exceptions below are the routines that did not meet this when the guard was introduced, each
-- with the search_path it had then. The list only shrinks: a routine outside it that breaks the rule
-- fails, a listed routine whose search_path changed to anything else fails, a listed routine that
-- now meets the rule fails until its entry is removed, and a listed name that matches more than one
-- routine in a database fails. The fix for each Owner removes its own entries.
DO $security_definer_search_path$
DECLARE
  violations text;
BEGIN
  WITH exception_list(routine_name, search_path) AS (VALUES
    (NULL::text, NULL::text)
  ), routines AS (
    SELECT procedure.oid,
           procedure.proowner,
           namespace.nspname || '.' || procedure.proname AS routine_name,
           (SELECT pg_catalog.substr(setting, 13)
              FROM pg_catalog.unnest(procedure.proconfig) setting
             WHERE setting LIKE 'search_path=%') AS search_path
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
     WHERE procedure.prosecdef
       AND namespace.nspname NOT IN ('pg_catalog','information_schema')
  ), path_items AS (
    SELECT routines.oid,
           pg_catalog.btrim(item.value) AS schema_name,
           item.position,
           pg_catalog.count(*) OVER (PARTITION BY routines.oid) AS item_count
      FROM routines
      CROSS JOIN LATERAL pg_catalog.unnest(pg_catalog.string_to_array(routines.search_path, ','))
        WITH ORDINALITY AS item(value, position)
  ), creatable_items AS (
    SELECT path_items.oid,
           path_items.schema_name,
           CASE WHEN namespace.oid IS NULL THEN 'does not exist'
                ELSE 'creatable by ' || pg_catalog.string_agg(DISTINCT login_role.rolname, ', ' ORDER BY login_role.rolname)
           END AS reason
      FROM path_items
      JOIN routines ON routines.oid=path_items.oid
      LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.nspname=path_items.schema_name
      LEFT JOIN pg_catalog.pg_roles login_role
        ON namespace.oid IS NOT NULL
       AND login_role.rolcanlogin
       AND NOT login_role.rolsuper
       AND EXISTS (
         SELECT 1
           FROM pg_catalog.pg_roles reachable
          WHERE pg_catalog.pg_has_role(login_role.oid, reachable.oid, 'SET')
            AND reachable.oid<>routines.proowner
            AND pg_catalog.has_schema_privilege(reachable.oid, namespace.oid, 'CREATE'))
     WHERE path_items.schema_name NOT IN ('pg_catalog','pg_temp')
     GROUP BY path_items.oid, path_items.schema_name, namespace.oid
    HAVING namespace.oid IS NULL OR pg_catalog.count(login_role.oid)>0
  ), assessed AS (
    SELECT routines.routine_name,
           routines.search_path,
           CASE
             WHEN routines.search_path IS NULL THEN 'sets no search_path'
             WHEN NOT EXISTS (SELECT 1 FROM path_items
                               WHERE path_items.oid=routines.oid
                                 AND path_items.position=path_items.item_count
                                 AND path_items.schema_name='pg_temp') THEN 'search_path does not end in pg_temp'
             WHEN EXISTS (SELECT 1 FROM creatable_items WHERE creatable_items.oid=routines.oid)
               THEN 'search_path names a schema a role other than the owner can create in, or one that does not exist: '
                 || (SELECT pg_catalog.string_agg(creatable_items.schema_name || ' (' || creatable_items.reason || ')', '; ' ORDER BY creatable_items.schema_name)
                       FROM creatable_items WHERE creatable_items.oid=routines.oid)
           END AS failure,
           pg_catalog.count(*) OVER (PARTITION BY routines.routine_name) AS same_name_count
      FROM routines
  ), findings AS (
    SELECT assessed.routine_name || ': ' || assessed.failure AS finding
      FROM assessed
     WHERE assessed.failure IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM exception_list
                        WHERE exception_list.routine_name=assessed.routine_name
                          AND exception_list.search_path=assessed.search_path)
    UNION ALL
    SELECT assessed.routine_name || ': listed as an exception but now meets the rule; remove its entry'
      FROM assessed
      JOIN exception_list ON exception_list.routine_name=assessed.routine_name
     WHERE assessed.failure IS NULL
    UNION ALL
    SELECT DISTINCT assessed.routine_name || ': listed as an exception but names more than one routine'
      FROM assessed
      JOIN exception_list ON exception_list.routine_name=assessed.routine_name
     WHERE assessed.same_name_count>1
  )
  SELECT pg_catalog.string_agg(finding, E'\n' ORDER BY finding) INTO violations FROM findings;

  IF violations IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER search_path guard failed in database %:%', pg_catalog.current_database(), E'\n' || violations;
  END IF;
END
$security_definer_search_path$;
