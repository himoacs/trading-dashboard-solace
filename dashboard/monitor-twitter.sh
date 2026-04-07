#!/bin/bash

# First configure AAPL with 10-second interval
echo "Setting AAPL tweet frequency to 10 seconds..."
curl -X POST http://localhost:3000/api/twitter-feed/manage \
  -H "Content-Type: application/json" \
  -d '{"action":"start","symbols":["AAPL"],"frequency":10}'

echo -e "\nStarting tweet monitoring. Press Ctrl+C to stop.\n"
echo "Time             | Message"
echo "-----------------|--------------------------------------------------"

# Monitor the logs for AAPL tweets
start_time=$(date +%s)
while true; do
  # Get current timestamp for display
  current_time=$(date +"%H:%M:%S")
  
  # Use journalctl to check for recent AAPL tweets
  new_tweets=$(grep "Generated tweet for AAPL\|Publishing tweet for AAPL" /tmp/app.log 2>/dev/null | tail -1)
  
  if [[ ! -z "$new_tweets" ]]; then
    elapsed=$(($(date +%s) - start_time))
    echo "$current_time ($elapsed s) | $new_tweets"
  fi
  
  # Sleep for a second before checking again
  sleep 1
done