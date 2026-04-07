#!/bin/bash
# Collection of curl commands to test the user flow

# Base URL
BASE_URL="http://localhost:3000"

# Test symbols
TEST_SYMBOL="AAPL"
TEST_INDEX="SPX"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}SolCapital User Flow Test Commands${NC}"
echo -e "${BLUE}=============================================${NC}"

echo -e "\n${GREEN}1. Connect to Solace Broker${NC}"
echo -e "curl -X POST \"$BASE_URL/api/solace/connect\" \\
  -H \"Content-Type: application/json\" \\
  -d '{
    \"url\": \"wss://mr-connection-xbwbdf9zk81.messaging.solace.cloud:443\",
    \"vpnName\": \"financial-data\", 
    \"userName\": \"test-user\", 
    \"password\": \"test-password\"
  }'"

echo -e "\n${GREEN}2. Get Available Stocks${NC}"
echo -e "curl -X GET \"$BASE_URL/api/stocks/available\""

echo -e "\n${GREEN}3. Start Simulation (Add Stock)${NC}"
echo -e "curl -X POST \"$BASE_URL/api/simulation/start\" \\
  -H \"Content-Type: application/json\" \\
  -d '{
    \"symbols\": [\"$TEST_SYMBOL\"],
    \"updateFrequencySeconds\": 5
  }'"

echo -e "\n${GREEN}4. Test Twitter Publishing for a Stock${NC}"
echo -e "curl -X POST \"$BASE_URL/api/test/twitter-publishing\" \\
  -H \"Content-Type: application/json\" \\
  -d '{
    \"symbol\": \"$TEST_SYMBOL\"
  }'"

echo -e "\n${GREEN}5. Send Test Market Data${NC}"
echo -e "curl -X POST \"$BASE_URL/api/test/market-data\" \\
  -H \"Content-Type: application/json\" \\
  -d '{
    \"symbol\": \"$TEST_SYMBOL\"
  }'"

echo -e "\n${GREEN}6. Send Test Signal/Output Message${NC}"
echo -e "curl -X POST \"$BASE_URL/api/test/signal\" \\
  -H \"Content-Type: application/json\" \\
  -d '{
    \"symbol\": \"$TEST_SYMBOL\",
    \"signal\": \"BUY\",
    \"confidence\": 0.95,
    \"tweetContent\": \"$TEST_SYMBOL showing strong momentum with new product announcements.\"
  }'"

echo -e "\n${GREEN}7. Test Market Indices - Send Test Data${NC}"
echo -e "curl -X POST \"$BASE_URL/api/test/market-data\" \\
  -H \"Content-Type: application/json\" \\
  -d '{
    \"symbol\": \"$TEST_INDEX\"
  }'"

echo -e "\n${GREEN}8. Run Comprehensive Solace Connection Test${NC}"
echo -e "curl -X POST \"$BASE_URL/api/test/solace-connection\" \\
  -H \"Content-Type: application/json\" \\
  -d '{
    \"symbol\": \"$TEST_SYMBOL\",
    \"enableTracing\": true,
    \"testLiveData\": true
  }'"

echo -e "\n${GREEN}9. Stop Simulation${NC}"
echo -e "curl -X POST \"$BASE_URL/api/simulation/stop\""

echo -e "\n${GREEN}10. Disconnect from Solace${NC}"
echo -e "curl -X POST \"$BASE_URL/api/solace/disconnect\""

echo -e "\n${BLUE}=============================================${NC}"
echo -e "${BLUE}Note: Copy and run these commands one by one${NC}"
echo -e "${BLUE}to test the complete user flow.${NC}"
echo -e "${BLUE}=============================================${NC}"