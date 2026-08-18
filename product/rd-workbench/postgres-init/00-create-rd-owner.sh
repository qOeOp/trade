#!/bin/sh
set -eu

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=rd_password="$RD_OWNER_DB_PASSWORD" << 'SQL'
CREATE ROLE rd_owner LOGIN PASSWORD :'rd_password';
CREATE DATABASE rd_owner OWNER rd_owner;
SQL
