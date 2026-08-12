# Dashboard image: React frontend built by Vite, served by the Express backend.
#
# The AI side of this demo no longer lives here. It used to run a Python
# solace-ai-connector sidecar inside this container; that has been replaced by
# real Solace Agent Mesh agents, which run in their own service (see
# docker-compose.yaml and solace-agent-mesh/). This image is therefore plain
# Node with no Python runtime.
FROM node:20.11.1-slim

WORKDIR /app

# Install dependencies first so this layer caches independently of app source.
COPY dashboard/package*.json ./
RUN npm install

# Application source, then the production build.
COPY dashboard/ ./
RUN npm run build

COPY start.sh .
RUN chmod +x ./start.sh

# The Express server listens on 5000; docker-compose maps it to host 5173.
EXPOSE 5000
CMD ["./start.sh"]
