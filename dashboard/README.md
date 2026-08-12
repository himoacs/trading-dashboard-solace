# dashboard/

The React + Express app. For everything about running the full demo (Docker Compose, the broker,
Solace Agent Mesh, architecture diagrams, topics, ports), see the [root README](../README.md) —
this file only covers local development *inside* this subdirectory.

## Local dev (no Docker)

```bash
npm install
npm run dev
```

Starts the Express backend and the Vite dev server together on `http://localhost:5000`. You still
need the broker and Agent Mesh running — start those via `docker compose up broker agent-mesh
sam-config` from the repo root, then point this dev server's Solace connection at the
host-published SMF port (`tcp://localhost:47555`), not `broker:55555` (that hostname only resolves
inside the compose network).

Rebuilding the containerized dashboard after a change here:

```bash
cd .. && docker compose up --build dashboard
```

## Layout

```
client/src/
├── components/       Dashboard.tsx, ResearchPanel.tsx, TrafficGeneratorPanel.tsx, ConfigPanel.tsx, ...
├── contexts/         TrafficGeneratorContext.tsx — browser-native publisher state
├── hooks/            useSolaceConnection.ts — the direct browser<->broker connection (solclientjs)
└── lib/              agentPayload.ts (unwraps agent/workflow replies), topicSubscriptionManager.ts

server/
├── routes.ts          API routes
├── storage.ts         in-memory data storage
├── services/          market-data / news / economic-indicator simulation, Solace connection mgmt
└── index.ts           server entry point (defaults to port 5000, override with PORT)

shared/
└── schema.ts          types shared by client and server, incl. ResearchBriefing and topic constants
```

## Adding things

- **New component**: `client/src/components/`.
- **New backend behavior**: a service under `server/services/`, exposed via a route in
  `server/routes.ts`.
- **New shared type**: `shared/schema.ts`, then wire up storage (`server/storage.ts`) and routes as
  needed.
