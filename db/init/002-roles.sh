#!/bin/bash
# Creates the two database roles that enforce the write/read split.
#
# THIS IS WHERE "SAM NEVER WRITES TO THE DATABASE" IS ACTUALLY ENFORCED.
#
# Solace Agent Mesh's sql/postgres connector hands the agent a general-purpose
# SQL tool, and SAM's own connector documentation is explicit that the platform
# cannot police it:
#
#   "All agents using this connector will have the same database access. Agent
#    Mesh cannot restrict what queries agents execute - access control must be
#    configured at the database level. For security, use credentials with
#    minimal necessary permissions (e.g., read-only, limited to specific
#    schemas)."
#
# So the guarantee lives in Postgres grants, not in prompt wording and not in
# application code. Even if the agent emits a DELETE, the database refuses it.
#
#   history_writer  INSERT + SELECT   -> used only by the market-history service
#   history_reader  SELECT only       -> used only by the SAM connector
#
# A .sh (not .sql) file because it needs the passwords from the environment, and
# the postgres image's initdb runner executes .sh files with them in scope while
# giving .sql files no way to read them. Runs once, on a fresh data directory
# only, in filename order after 001-schema.sql.
set -euo pipefail

: "${MARKET_HISTORY_WRITER_PASSWORD:?MARKET_HISTORY_WRITER_PASSWORD not set}"
: "${MARKET_HISTORY_READER_PASSWORD:?MARKET_HISTORY_READER_PASSWORD not set}"

# --username/--dbname come from the image's own POSTGRES_USER/POSTGRES_DB, which
# the entrypoint has already created by the time this runs.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Roles are created with LOGIN but no other attributes: no SUPERUSER, no
    -- CREATEDB, no CREATEROLE, no BYPASSRLS.
    CREATE ROLE history_writer LOGIN PASSWORD '${MARKET_HISTORY_WRITER_PASSWORD}';
    CREATE ROLE history_reader LOGIN PASSWORD '${MARKET_HISTORY_READER_PASSWORD}';

    GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO history_writer, history_reader;
    GRANT USAGE ON SCHEMA public TO history_writer, history_reader;

    -- The writer: append and read back. Deliberately no UPDATE and no DELETE -
    -- this is an append-only event log, so even the writer cannot rewrite
    -- history. Needs USAGE on the identity sequences behind the IDENTITY
    -- primary keys to insert at all.
    GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO history_writer;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO history_writer;

    -- The reader (SAM): SELECT and nothing else.
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO history_reader;

    -- Without this, either role could CREATE its own tables in public (Postgres
    -- grants CREATE on public to PUBLIC by default in versions before 15; this
    -- image is 16, where it's already revoked, but being explicit keeps the
    -- guarantee true if the image is ever pinned back).
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    REVOKE CREATE ON SCHEMA public FROM history_writer, history_reader;

    -- Make the grants above apply to tables created later too, so a future
    -- migration can't silently hand the reader write access (or forget to give
    -- the writer INSERT). Scoped to objects created by $POSTGRES_USER, which is
    -- who runs the init scripts and any future migration.
    ALTER DEFAULT PRIVILEGES FOR ROLE "$POSTGRES_USER" IN SCHEMA public
      GRANT SELECT, INSERT ON TABLES TO history_writer;
    ALTER DEFAULT PRIVILEGES FOR ROLE "$POSTGRES_USER" IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO history_writer;
    ALTER DEFAULT PRIVILEGES FOR ROLE "$POSTGRES_USER" IN SCHEMA public
      GRANT SELECT ON TABLES TO history_reader;
EOSQL

echo "Roles history_writer (INSERT+SELECT) and history_reader (SELECT only) created."
