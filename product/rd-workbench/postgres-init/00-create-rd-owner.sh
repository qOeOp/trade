#!/bin/sh
set -eu

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=rd_password="$RD_OWNER_DB_PASSWORD" \
  --set=issuer_password="$OPERATOR_AUTHORIZATION_DB_PASSWORD" \
  --set=edge_password="$PRODUCT_EDGE_DB_PASSWORD" << 'SQL'
CREATE ROLE rd_owner LOGIN PASSWORD :'rd_password';
CREATE DATABASE rd_owner OWNER rd_owner;
CREATE ROLE operator_authorization_owner NOLOGIN;
CREATE ROLE operator_authorization_writer LOGIN PASSWORD :'issuer_password';
GRANT operator_authorization_owner TO operator_authorization_writer;
CREATE ROLE product_edge_owner LOGIN PASSWORD :'edge_password';
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname rd_owner << 'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO rd_owner, product_edge_owner;
CREATE SCHEMA product_edge_api AUTHORIZATION product_edge_owner;
REVOKE ALL ON SCHEMA product_edge_api FROM PUBLIC;
GRANT USAGE ON SCHEMA product_edge_api TO rd_owner;
CREATE SCHEMA rd_owner_api AUTHORIZATION rd_owner;
REVOKE ALL ON SCHEMA rd_owner_api FROM PUBLIC;
GRANT USAGE ON SCHEMA rd_owner_api TO product_edge_owner;
CREATE SCHEMA operator_authorization_private AUTHORIZATION operator_authorization_owner;
CREATE SCHEMA operator_authorization_api AUTHORIZATION operator_authorization_owner;
REVOKE ALL ON SCHEMA operator_authorization_private FROM PUBLIC, rd_owner, product_edge_owner;
REVOKE ALL ON SCHEMA operator_authorization_api FROM PUBLIC, rd_owner, product_edge_owner;
GRANT USAGE ON SCHEMA operator_authorization_api TO product_edge_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE product_edge_owner IN SCHEMA public
  REVOKE ALL ON TABLES FROM rd_owner;
SQL
