# SolCapital Sentiment Dashboard - Testing Guide

This guide explains how to test the complete user flow for the SolCapital Sentiment Dashboard.

## User Flow to Test

1. User connects to Solace broker by providing Solace credentials
2. User adds stocks to Selected Stocks list which triggers Twitter feed publishing
3. Live Market Intelligence shows market data from Solace for selected stocks
4. User toggles "Live Data" for market indices and sees live data from Solace

## Testing Options

### Option 1: Automated Test Script

We provide a Node.js test script that automates the testing of the complete user flow:

```bash
# Install dependencies if not already installed
npm install node-fetch

# Run the test script
node server/tests/test-user-flow.js
```

The script will:
- Connect to Solace using test credentials
- Add test stocks and verify Twitter feed publishing
- Test Live Market Intelligence data flow
- Test Live Data toggle for market indices

### Option 2: Manual Testing with curl Commands

For manual testing, we provide a collection of curl commands in `curl-test-commands.sh`:

```bash
# View the commands
cat server/tests/curl-test-commands.sh

# Make the file executable
chmod +x server/tests/curl-test-commands.sh

# View the commands in a formatted way
./server/tests/curl-test-commands.sh
```

Copy and run each command one by one to test the different steps of the user flow.

### Option 3: UI Testing

For a complete end-to-end test:

1. Open the web application in your browser
2. Navigate to the Solace Connection page
3. Enter valid Solace broker credentials and connect
4. Go to the Dashboard
5. Add stocks to the Selected Stocks list
6. Verify that Live Market Intelligence panel shows data for selected stocks
7. Toggle "Live Data" for market indices and verify that data appears

## Troubleshooting

- If "Cannot update market data: Not connected to Solace" appears in the logs, make sure to connect to Solace first
- Verify WebSocket connectivity by checking the browser console for any connection errors
- Use the test endpoints to trigger specific actions without going through the UI

## Test Data

- For stock symbols, use common ones like "AAPL", "MSFT", "GOOGL"
- For market indices, use "SPX", "DJI", "NDX"
- For Solace credentials, use the provided test credentials or contact your Solace administrator