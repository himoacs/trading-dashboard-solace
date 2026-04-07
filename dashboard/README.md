# SolCapital Sentiment Dashboard

## Overview

SolCapital Sentiment Dashboard is a sophisticated financial intelligence platform that delivers real-time market data, social media sentiment analysis, and AI-generated trading signals through an interactive dashboard. The application showcases the power of event-driven architecture using Solace PubSub+ for efficient and reliable message streaming between components.

![Dashboard Screenshot](./attached_assets/Screenshot%202025-05-15%20at%209.19.10%20PM.png)

## Application Features

- **Live Market Intelligence**: Real-time stock pricing data with percentage change indicators
- **Social Media Sentiment**: AI-analyzed tweets related to selected financial instruments
- **Trading Signals**: Smart trading recommendations with confidence scores
- **Exchange & Country Filtering**: Filter stocks by exchanges (NASDAQ, NYSE, etc.) or countries (US, JP, UK, etc.)
- **Wildcard Topic Subscriptions**: Demonstrate Solace's powerful topic hierarchy and wildcard filtering capabilities
- **WebSocket Integration**: Real-time UI updates via WebSocket connections
- **User-Controlled Data Flow**: Toggle data feeds on/off with the Live Data switch

## Technical Architecture

The application follows a modern event-driven architecture:

```
┌───────────────────┐     ┌────────────────┐     ┌────────────────┐
│                   │     │                │     │                │
│    Frontend UI    │◄────┤  WebSocket     │◄────┤  Solace        │
│    React + Vite   │     │  Connection    │     │  PubSub+       │
│                   │     │                │     │  Message Broker│
└───────────────────┘     └────────────────┘     └────────────────┘
         ▲                                               ▲
         │                                               │
         │                                               │
         │                                               │
         │                                               │
         │                       ┌────────────────┐      │
         └───────────────────────┤  Backend       ├──────┘
                                 │  Services      │
                                 │  (Express)     │
                                 └────────────────┘
```

### Topic Structure

The application uses hierarchical topics for efficient message filtering:

- **Market Data**: `market-data/EQ/{COUNTRY}/{EXCHANGE}/{SYMBOL}`
- **Market Indices**: `market-data/{INDEX}` (e.g., `market-data/NDX`)
- **Signal/Output**: `signal/output` for tweet content and trading signals

## Getting Started (For New Interns)

### Prerequisites

Before you begin, make sure you have the following installed:
- Node.js (v18.0.0 or later)
- npm (v9.0.0 or later)
- Git

### Required API Keys

This application requires an API key to enable AI functionality:
- OpenAI API Key (for AI-based sentiment analysis)

### Local Deployment Steps

1. **Clone the Repository**

   ```bash
   git clone https://your-repo-url/solcapital-sentiment-dashboard.git
   cd solcapital-sentiment-dashboard
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Set Up Environment Variables**

   Create a `.env` file in the root directory:

   ```
   OPENAI_API_KEY=your_openai_api_key_here
   ```

4. **Start the Development Server**

   ```bash
   npm run dev
   ```

   This will start both the backend Express server and the frontend Vite dev server.

5. **Access the Dashboard**

   Open your browser and navigate to:
   ```
   http://localhost:5000
   ```

### Connecting to Solace

The application requires connection to a Solace PubSub+ message broker:

1. **Obtain Solace Credentials**
   
   You'll need the following information:
   - Host URL (e.g., `mr-connection-abcdef.messaging.solace.cloud`)
   - Message VPN (e.g., `solcapital-vpn`)
   - Username 
   - Password

2. **Configure Connection in the UI**

   - Click on the "Configure Solace Connection" button in the dashboard
   - Enter your Solace credentials
   - Click "Connect"

3. **Select Stocks & Activate Data**

   - Use the "Add Stocks" button to select financial instruments
   - Toggle "Live Data" to ON to start receiving real-time updates
   - Optionally select country/exchange filters to use wildcard subscriptions

## Working with the Codebase

### Project Structure

```
├── client/                  # Frontend React application
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── hooks/           # Custom React hooks
│   │   ├── lib/             # Utility functions
│   │   ├── pages/           # Page components
│   │   └── App.tsx          # Main application component
│   │
│   └── index.html           # HTML entry point
│
├── server/                   # Backend Express server
│   ├── services/            # Backend services
│   │   ├── marketDataService.ts       # Stock data simulation
│   │   ├── solaceService.ts           # Solace connection management
│   │   ├── twitterPublisherService.ts # Tweet simulation
│   │   └── publisherSolaceService.ts  # Publisher service
│   │
│   ├── routes.ts            # API routes
│   ├── storage.ts           # In-memory data storage
│   └── index.ts             # Server entry point
│
├── shared/                  # Shared code between frontend and backend
│   └── schema.ts            # TypeScript interfaces and types
│
└── README.md                # This documentation
```

### Key Development Workflows

1. **Adding New Components**
   - Create new components in `client/src/components/`
   - Import and use in pages

2. **Adding Backend Functionality**
   - Implement in relevant service under `server/services/`
   - Expose through API endpoints in `server/routes.ts`

3. **Adding New Data Types**
   - Define types in `shared/schema.ts`
   - Implement storage in `server/storage.ts`
   - Create API endpoints in `server/routes.ts`

### Common Tasks

1. **Debugging Connection Issues**:
   - Check browser console logs for WebSocket messages
   - Check server logs for connection status
   - Verify Solace credentials in the configuration panel

2. **Adding New Stock Symbols**:
   - Add entries to the stock registry in `server/services/marketDataService.ts`

3. **Modifying Tweet Generation**:
   - Update logic in `server/services/twitterPublisherService.ts`

## Troubleshooting

### Common Issues

1. **Connection Failed**
   - Verify Solace credentials are correct
   - Check network connectivity to Solace broker
   - Ensure VPN access is properly configured

2. **No Data Appearing**
   - Verify "Live Data" toggle is switched ON
   - Check that stocks have been added to the dashboard
   - Examine WebSocket connection status in browser console

3. **API Rate Limiting**
   - If OpenAI API responses are slow or failing, check rate limits
   - Consider implementing request throttling

## Additional Resources

- [Solace PubSub+ Documentation](https://docs.solace.com/)
- [React Documentation](https://reactjs.org/docs/getting-started.html)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [OpenAI API Documentation](https://platform.openai.com/docs/)