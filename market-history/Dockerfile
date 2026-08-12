# market-history: records broker traffic (prices, tweets, signals) into Postgres.
#
# Self-contained build context (./market-history), unlike the dashboard image at
# the repo root whose COPY paths are relative to the repo root for historical
# reasons. Nothing here needs anything outside this directory.
FROM node:20.11.1-slim

WORKDIR /app

# Dependencies first so this layer caches independently of source changes.
COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop root: this service opens a broker connection and a DB connection and has
# no reason to run privileged. Safe here because it writes nothing to disk - all
# state lives in Postgres, so there's no mounted volume whose ownership could
# mismatch (the trap documented for sam-data in docker-compose.yaml).
USER node

# No EXPOSE and no ports: this is a write-only recorder with no HTTP surface.
# Agent Mesh reads the data from Postgres directly via its sql connector, so
# this process never needs to be reachable.
CMD ["npm", "start"]
