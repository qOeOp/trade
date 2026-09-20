#!/bin/sh
set -eu

: "${RD_OWNER_DATABASE_NAME:=rd_owner}"
: "${RD_FACT_WRITER_DB_PASSWORD:?set RD_FACT_WRITER_DB_PASSWORD}"
: "${REPLAY_POLICY_CATALOG_ADMIN_DB_PASSWORD:?set REPLAY_POLICY_CATALOG_ADMIN_DB_PASSWORD}"
: "${EXECUTION_WRITER_DB_PASSWORD:?set EXECUTION_WRITER_DB_PASSWORD}"
: "${PORTFOLIO_WRITER_DB_PASSWORD:?set PORTFOLIO_WRITER_DB_PASSWORD}"
: "${GOVERNANCE_WRITER_DB_PASSWORD:?set GOVERNANCE_WRITER_DB_PASSWORD}"
: "${RISK_WRITER_DB_PASSWORD:?set RISK_WRITER_DB_PASSWORD}"
: "${SCANNER_WRITER_DB_PASSWORD:?set SCANNER_WRITER_DB_PASSWORD}"

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=rd_owner_database_name="$RD_OWNER_DATABASE_NAME" \
  --set=rd_password="$RD_OWNER_DB_PASSWORD" \
  --set=fact_writer_password="$RD_FACT_WRITER_DB_PASSWORD" \
  --set=catalog_admin_password="$REPLAY_POLICY_CATALOG_ADMIN_DB_PASSWORD" \
  --set=issuer_password="$OPERATOR_AUTHORIZATION_DB_PASSWORD" \
  --set=edge_password="$PRODUCT_EDGE_DB_PASSWORD" \
  --set=qualification_password="$QUALIFICATION_OWNER_DB_PASSWORD" \
  --set=backtest_password="$BACKTEST_OWNER_DB_PASSWORD" \
  --set=execution_writer_password="$EXECUTION_WRITER_DB_PASSWORD" \
  --set=portfolio_writer_password="$PORTFOLIO_WRITER_DB_PASSWORD" \
  --set=governance_writer_password="$GOVERNANCE_WRITER_DB_PASSWORD" \
  --set=risk_writer_password="$RISK_WRITER_DB_PASSWORD" \
  --set=scanner_writer_password="$SCANNER_WRITER_DB_PASSWORD" << 'SQL'
CREATE ROLE rd_database_owner NOLOGIN;
CREATE ROLE replay_policy_catalog_owner NOLOGIN;
CREATE ROLE composer_owner NOLOGIN;
CREATE ROLE rd_exploratory_replay_api_owner NOLOGIN;
CREATE ROLE market_data_owner NOLOGIN;
CREATE ROLE market_data_reader NOLOGIN;
CREATE ROLE instrument_owner NOLOGIN;
CREATE ROLE rd_owner LOGIN PASSWORD :'rd_password';
-- The Rust materializer creates the replay API functions before the authority
-- migration transfers ownership and removes every cross-role membership.
GRANT rd_exploratory_replay_api_owner TO rd_owner;
CREATE ROLE rd_fact_writer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'fact_writer_password';
CREATE ROLE replay_policy_catalog_admin_writer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'catalog_admin_password';
CREATE DATABASE :"rd_owner_database_name" OWNER rd_owner;
-- Instrument Owner creates its own `instrument_owner_private` schema, so unlike every
-- other Owner writer it needs CREATE on the database. This grant is database-scoped and
-- therefore belongs here, which runs once against the Owner database: the authority
-- migration runs per database, including the ordered chain's clones, and that chain
-- asserts no listed role holds CREATE on a clone.
GRANT CREATE ON DATABASE :"rd_owner_database_name" TO instrument_owner;
CREATE ROLE operator_authorization_owner NOLOGIN;
CREATE ROLE operator_authorization_writer LOGIN PASSWORD :'issuer_password';
GRANT operator_authorization_owner TO operator_authorization_writer;
CREATE ROLE product_edge_owner LOGIN PASSWORD :'edge_password';
CREATE ROLE portfolio_owner NOLOGIN;
CREATE ROLE qualification_owner NOLOGIN;
CREATE ROLE qualification_writer LOGIN PASSWORD :'qualification_password';
CREATE ROLE backtest_owner LOGIN PASSWORD :'backtest_password';
-- Trading-side Owners: one NOLOGIN owner role holds each private schema; one LOGIN writer
-- inherits it. Portfolio reuses the pre-existing portfolio_owner role.
CREATE ROLE execution_owner NOLOGIN;
CREATE ROLE execution_writer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'execution_writer_password';
GRANT execution_owner TO execution_writer;
CREATE ROLE portfolio_writer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'portfolio_writer_password';
GRANT portfolio_owner TO portfolio_writer;
CREATE ROLE governance_owner NOLOGIN;
CREATE ROLE governance_writer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'governance_writer_password';
GRANT governance_owner TO governance_writer;
CREATE ROLE risk_owner NOLOGIN;
CREATE ROLE risk_writer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'risk_writer_password';
GRANT risk_owner TO risk_writer;
CREATE ROLE scanner_owner NOLOGIN;
CREATE ROLE scanner_writer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'scanner_writer_password';
GRANT scanner_owner TO scanner_writer;
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$RD_OWNER_DATABASE_NAME" << 'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO rd_owner;
GRANT USAGE, CREATE ON SCHEMA public TO rd_owner;
GRANT USAGE, CREATE ON SCHEMA public TO product_edge_owner;
CREATE SCHEMA product_edge_api AUTHORIZATION product_edge_owner;
REVOKE ALL ON SCHEMA product_edge_api FROM PUBLIC;
GRANT USAGE ON SCHEMA product_edge_api TO rd_owner;
CREATE SCHEMA rd_owner_api AUTHORIZATION rd_owner;
REVOKE ALL ON SCHEMA rd_owner_api FROM PUBLIC;
GRANT USAGE ON SCHEMA rd_owner_api TO product_edge_owner;
GRANT USAGE, CREATE ON SCHEMA rd_owner_api TO rd_exploratory_replay_api_owner;
-- The bounded Rust materializer runs before the custody cutover. Pre-create the
-- Market Data namespace under its temporary bootstrap owner; the idempotent
-- authority migration later transfers it to market_data_owner.
CREATE SCHEMA market_data_private AUTHORIZATION rd_owner;
REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC;
CREATE SCHEMA operator_authorization_private AUTHORIZATION operator_authorization_owner;
CREATE SCHEMA operator_authorization_api AUTHORIZATION operator_authorization_owner;
REVOKE ALL ON SCHEMA operator_authorization_private FROM PUBLIC, rd_owner, product_edge_owner;
REVOKE ALL ON SCHEMA operator_authorization_api FROM PUBLIC, rd_owner, product_edge_owner;
CREATE SCHEMA execution_private AUTHORIZATION execution_owner;
CREATE SCHEMA execution_api AUTHORIZATION execution_owner;
CREATE SCHEMA portfolio_private AUTHORIZATION portfolio_owner;
CREATE SCHEMA portfolio_api AUTHORIZATION portfolio_owner;
CREATE SCHEMA governance_private AUTHORIZATION governance_owner;
CREATE SCHEMA governance_api AUTHORIZATION governance_owner;
CREATE SCHEMA risk_private AUTHORIZATION risk_owner;
CREATE SCHEMA risk_api AUTHORIZATION risk_owner;
CREATE SCHEMA scanner_private AUTHORIZATION scanner_owner;
CREATE SCHEMA scanner_api AUTHORIZATION scanner_owner;
REVOKE ALL ON SCHEMA execution_private, execution_api, portfolio_private, portfolio_api, governance_private, governance_api FROM PUBLIC, rd_owner, product_edge_owner;
REVOKE ALL ON SCHEMA risk_private, risk_api, scanner_private, scanner_api FROM PUBLIC, rd_owner, product_edge_owner;
GRANT USAGE ON SCHEMA operator_authorization_api TO product_edge_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE product_edge_owner IN SCHEMA public
  REVOKE ALL ON TABLES FROM rd_owner;
SQL
