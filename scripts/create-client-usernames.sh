#!/bin/sh
# Provisions a client-username object on the default VPN so demo/demo exists as
# a real broker identity, not just accepted incidentally because the VPN's
# authenticationBasicType is currently "none" (which makes literally any
# username/password pair work). A real object means: it shows up distinctly in
# the broker's client-connection monitoring, and if basic auth is ever turned
# on for this VPN, it keeps working with no further changes.
#
#   demo/demo - the dashboard's own frontend Solace Connection panel default
#
# A fresh clientUsername inherits the "default" ACL/client profile
# automatically - no need to set clientProfileName/aclProfileName explicitly
# (verified against a live broker).
#
# Idempotent: safe to re-run on every `docker compose up`. A create on an
# already-existing username 400s with meta.error.status ALREADY_EXISTS; this
# is treated as success (and the password is patched in, in case it drifted).
set -eu

SEMP_BASE="http://broker:8080/SEMP/v2"
SEMP_AUTH="admin:admin"
VPN="${SOLACE_BROKER_VPN:-default}"

create_client_username() {
  username="$1"
  password="$2"
  response_file=$(mktemp)

  http_code=$(curl -s -o "$response_file" -w "%{http_code}" -u "$SEMP_AUTH" \
    -X POST -H "Content-Type: application/json" \
    -d "{\"clientUsername\": \"$username\", \"password\": \"$password\", \"enabled\": true}" \
    "$SEMP_BASE/config/msgVpns/$VPN/clientUsernames")

  if [ "$http_code" = "200" ]; then
    echo "Created client-username '$username'."
  elif [ "$http_code" = "400" ] && grep -q "ALREADY_EXISTS" "$response_file"; then
    echo "Client-username '$username' already exists - syncing password."
    curl -sf -u "$SEMP_AUTH" -X PATCH -H "Content-Type: application/json" \
      -d "{\"password\": \"$password\", \"enabled\": true}" \
      "$SEMP_BASE/config/msgVpns/$VPN/clientUsernames/$username" > /dev/null
  else
    echo "Unexpected SEMP response ($http_code) creating '$username':" >&2
    cat "$response_file" >&2
    rm -f "$response_file"
    exit 1
  fi

  rm -f "$response_file"
}

echo "Waiting for the default VPN to be up..."
i=0
until curl -sf -u "$SEMP_AUTH" "$SEMP_BASE/config/msgVpns/$VPN" > /dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "Default VPN never came up." >&2
    exit 1
  fi
  sleep 2
done

create_client_username "demo" "demo"

echo "Client username provisioned."
