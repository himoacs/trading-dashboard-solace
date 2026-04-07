#!/bin/bash
set -e

# Define paths
CONFIG_TEMPLATE="/app/solace-ai-connector-config.template.yaml"
CONFIG_OUTPUT="/app/solace-ai-connector-config.yaml"

# Check for all required environment variables
: "${SOLACE_BROKER_URL:?SOLACE_BROKER_URL not set}"
: "${SOLACE_BROKER_USERNAME:?SOLACE_BROKER_USERNAME not set}"
: "${SOLACE_BROKER_PASSWORD:?SOLACE_BROKER_PASSWORD not set}"
: "${SOLACE_BROKER_VPN:?SOLACE_BROKER_VPN not set}"
: "${LLM_API_KEY:?LLM_API_KEY not set}"

# Use envsubst to replace variables in the template file
# The list of variables tells envsubst which ones to replace
echo "Generating configuration from template..."
envsubst '${SOLACE_BROKER_URL},${SOLACE_BROKER_USERNAME},${SOLACE_BROKER_PASSWORD},${SOLACE_BROKER_VPN},${LLM_API_KEY}' < "$CONFIG_TEMPLATE" > "$CONFIG_OUTPUT"

echo "Configuration file generated."

# Activate the Python virtual environment
echo "Activating Python virtual environment..."
source /app/venv/bin/activate

# Start the solace-ai-connector in the background
echo "Starting solace-ai-connector in the background..."
python3 -m solace_ai_connector.main "$CONFIG_OUTPUT" &

# Start the web server in the foreground
echo "Starting web server..."
npm start 