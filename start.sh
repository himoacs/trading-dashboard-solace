#!/bin/bash
#
# Dashboard container entrypoint.
#
# This used to also generate a solace-ai-connector config with envsubst and run
# a Python connector in the background. Trading signals now come from Solace
# Agent Mesh agents (see solace-agent-mesh/), so this only starts the web server.
set -e

# Broker connection for the backend publishers. The browser connects to the
# broker separately using the Solace Connection panel in the UI.
: "${SOLACE_BROKER_URL:?SOLACE_BROKER_URL not set}"
: "${SOLACE_BROKER_USERNAME:?SOLACE_BROKER_USERNAME not set}"
: "${SOLACE_BROKER_PASSWORD:?SOLACE_BROKER_PASSWORD not set}"
: "${SOLACE_BROKER_VPN:?SOLACE_BROKER_VPN not set}"

echo "Starting web server..."
exec npm start
