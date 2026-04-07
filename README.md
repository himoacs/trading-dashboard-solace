# Market Pulse Dashboard

A real-time trading dashboard powered by Solace event mesh and enhanced with AI-driven insights. Built with React, TypeScript, and TradingView charts, featuring browser-native Solace WebSocket connections for ultra-low latency data streaming.

## Features

### Core Functionality
- **Real-time Stock Ticker**: Live updates for selected stocks via Solace WebSocket
- **Market Overview Panel**: Dynamic display of major market symbols with price changes
- **Advanced Topic Filtering**: Subscribe to data by stock, exchange, or country using Solace wildcard topics
- **AI-Generated Insights**: Trading signals and sentiment analysis from tweets via LLM integration

### New Features

#### Real-time Charts (TradingView)
- Interactive stock price charts using TradingView lightweight-charts v5
- Multi-stock overlay on a single chart with color-coded lines
- Automatic data streaming from selected stocks
- Time-series visualization with crosshair and tooltips

#### Traffic Generator
- Browser-native Solace message publishing
- Configurable message frequency (10ms - 5000ms)
- Multiple delivery modes (DIRECT, PERSISTENT)
- Message eliding and DMQ eligibility options
- Real-time message rate monitoring

### Architecture
- **Frontend**: React + TypeScript + Vite + shadcn/ui
- **Backend**: Express.js with Solace AI Connector (Python)
- **Messaging**: Solace PubSub+ with browser WebSocket (solclientjs)
- **Charts**: TradingView lightweight-charts v5

## Quick Start

### Prerequisites
- Docker Desktop installed and running
- A Solace PubSub+ broker (local or cloud)
- LLM API key (OpenAI, Claude, etc.)

### Step 1: Configure Environment

Create a `.env` file in the root directory:

```env
# Solace Broker Connection (for AI Connector backend)
SOLACE_BROKER_URL=tcps://your-solace-broker-url.com:55443
SOLACE_BROKER_USERNAME=your-solace-username
SOLACE_BROKER_PASSWORD=your-solace-password
SOLACE_BROKER_VPN=your-solace-vpn-name

# LLM API Key
LLM_API_KEY=your-llm-key
```

### Step 2: Build and Run

```bash
docker-compose up --build
```

### Step 3: Access Dashboard

Open [http://localhost:5173](http://localhost:5173)

### Default Connection Settings

The dashboard comes pre-configured with default Solace connection settings for local development:

| Setting | Default Value |
|---------|---------------|
| Broker URL | `ws://localhost:8008` |
| Message VPN | `default` |
| Username | `demo` |
| Password | `demo` |

These can be changed in the Solace Connection panel.

## Components

### 1. Dashboard (Frontend)

Modern React application with:
- **Stock Data Tab**: Real-time ticker with filtering
- **Charts Tab**: TradingView-powered price charts
- **AI Insights**: Trading signals and tweet sentiment
- **Traffic Generator**: Message publishing controls

### 2. Solace AI Connector (Backend)

Python service that:
- Listens for stock ticks and news events
- Generates trading signals via LLM
- Publishes AI insights back to Solace

## Topic Structure

```
market-data/EQ/{COUNTRY}/{EXCHANGE}/{SYMBOL}   # Stock prices
market-data/{INDEX}                             # Market indices
signal/output                                   # AI trading signals
```

## Configuration Notes

### Twitter Feed Queue TTL

After starting the demo, configure the `twitter_feed` queue in your Solace broker:
- Enable "Respect TTL" 
- Set TTL to 60 seconds
- This prevents message buildup from old tweets

## Development

### Local Development (without Docker)

```bash
cd dashboard
npm install
npm run dev
```

### Rebuild Container

```bash
docker-compose down && docker-compose build --no-cache && docker-compose up
```