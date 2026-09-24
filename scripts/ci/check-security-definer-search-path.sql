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
    ('execution_api.read_current_paper_adapter_binding_v1', 'pg_catalog, execution_private'),
    ('execution_api.read_paper_account_opening_fact_v1', 'pg_catalog, execution_private'),
    ('governance_api.read_current_execution_scope_v1', 'pg_catalog, governance_private'),
    ('operator_authorization_api.lock_current_authorization_v1', 'pg_catalog, operator_authorization_private'),
    ('operator_authorization_api.lock_current_autonomous_policy_authorization_v1', 'pg_catalog, operator_authorization_private'),
    ('operator_authorization_api.lock_current_portfolio_resource_grant_v1', 'pg_catalog, operator_authorization_private'),
    ('operator_authorization_api.resolve_authorization_snapshot_v1', 'pg_catalog, operator_authorization_private'),
    ('portfolio_api.capacity_view_expired_at_v1', 'pg_catalog, portfolio_private'),
    ('portfolio_api.read_bound_capacity_scope_v1', 'pg_catalog, portfolio_private'),
    ('portfolio_api.read_current_capacity_view_v1', 'pg_catalog, portfolio_private'),
    ('product_edge_api.lock_downstream_admission_v1', 'pg_catalog'),
    ('product_edge_api.lock_legacy_prepared_attempt_drain_effects_v1', 'pg_catalog'),
    ('product_edge_api.lock_portfolio_read_policy_v1', 'pg_catalog'),
    ('product_edge_api.lock_source_invocation_claim_v1', 'pg_catalog'),
    ('product_edge_api.lock_source_invocation_started_v1', 'pg_catalog'),
    ('product_edge_api.lock_source_invocation_state_v1', 'pg_catalog'),
    ('product_edge_api.read_legacy_prepared_attempt_absence_v1', 'pg_catalog'),
    ('product_edge_api.resolve_historical_downstream_admission_snapshot_v1', 'pg_catalog'),
    ('qualification_api.canonical_bytes_storage_digest_v1', 'pg_catalog'),
    ('qualification_api.canonical_json_digest_v1', 'pg_catalog'),
    ('qualification_api.canonical_json_text_v1', 'pg_catalog'),
    ('qualification_api.canonical_ordered_json_digest_v1', 'pg_catalog'),
    ('qualification_api.lock_projection_for_basis_v1', 'pg_catalog'),
    ('qualification_api.lock_protected_replay_request_set_v1', 'pg_catalog'),
    ('qualification_api.lock_protected_replay_request_v1', 'pg_catalog'),
    ('qualification_api.protected_replay_request_semantic_digest_is_valid_v1', 'pg_catalog'),
    ('qualification_api.protected_replay_request_set_is_custodied_v1', 'pg_catalog'),
    ('qualification_api.public_status_expected_fact_digest_v1', 'pg_catalog'),
    ('qualification_api.public_status_expected_opaque_reference_v1', 'pg_catalog'),
    ('qualification_api.public_status_native_source_is_custodied_v1', 'pg_catalog'),
    ('qualification_api.read_public_status_v1', 'pg_catalog'),
    ('scanner_api.read_terminal_receipt_v1', 'pg_catalog')
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
