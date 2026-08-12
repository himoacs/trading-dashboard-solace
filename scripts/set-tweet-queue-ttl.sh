#!/bin/sh
# Bounds the tweet_to_signal queue's message TTL so a long-running demo can't
# quietly build an unbounded backlog if the agent ever falls behind the
# Traffic Generator (e.g. after an agent-mesh restart, or the tweet rate
# slider cranked up for a while) - each message is dropped after TTL_SECONDS
# instead of piling up and later firing a burst of LLM calls on posts that
# are no longer current.
#
# SAM auto-provisions this queue itself at entrypoint-deploy time with its
# own hardening properties (maxTtl: 0, respectTtlEnabled: false) - there is
# no field in the declarative entrypoint YAML to change that (checked the
# live schema: `sam config schema show entrypoint --type event_mesh` has
# nothing queue-related), so this patches it directly via SEMPv2 after
# sam-config has deployed the entrypoint and the queue exists.
#
# Idempotent: safe to re-run on every `docker compose up`.
set -eu

SEMP_BASE="http://broker:8080/SEMP/v2"
SEMP_AUTH="admin:admin"
VPN="${SOLACE_BROKER_VPN:-default}"
TTL_SECONDS="${TWEET_QUEUE_TTL_SECONDS:-300}"

echo "Waiting for the tweet_to_signal queue to be provisioned..."
QUEUE_NAME=""
i=0
while [ "$i" -lt 30 ]; do
  QUEUE_NAME=$(curl -sf -u "$SEMP_AUTH" \
      "$SEMP_BASE/monitor/msgVpns/$VPN/queues?select=queueName&count=100" \
    | grep -o '"queueName":"[^"]*tweet_to_signal"' | head -1 \
    | sed 's/"queueName":"//;s/"$//') || true
  if [ -n "$QUEUE_NAME" ]; then
    break
  fi
  i=$((i + 1))
  sleep 2
done

if [ -z "$QUEUE_NAME" ]; then
  echo "tweet_to_signal queue never appeared - is the market-events entrypoint deployed?" >&2
  exit 1
fi

echo "Found queue: $QUEUE_NAME - setting maxTtl=${TTL_SECONDS}s, respectTtlEnabled=true"
ENCODED=$(printf '%s' "$QUEUE_NAME" | sed 's/\//%2F/g')
curl -sf -u "$SEMP_AUTH" -X PATCH \
  -H "Content-Type: application/json" \
  -d "{\"maxTtl\": $TTL_SECONDS, \"respectTtlEnabled\": true}" \
  "$SEMP_BASE/config/msgVpns/$VPN/queues/$ENCODED" \
  > /dev/null
echo "Queue TTL set."
