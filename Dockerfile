# Use the official Node.js 20.11.1 slim image as the base image
FROM node:20.11.1-slim

# Install Python, pip, and gettext for envsubst
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    gettext-base \
    python3-venv

# Set the working directory in the container
WORKDIR /app

# Create a virtual environment
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

# Copy frontend dependency files and install
COPY dashboard/package*.json ./
RUN npm install

# Install Python dependencies into the venv
RUN pip3 install "solace-ai-connector[llm]" lxml python-dotenv

# Copy the rest of the frontend application source code
COPY dashboard/ ./

# Build the Node.js frontend
RUN npm run build

# Copy the startup script and make it executable
COPY start.sh .
COPY solace-ai-connector-config.template.yaml .
RUN chmod +x ./start.sh

# Expose the frontend port and set the startup command
EXPOSE 5173
CMD ["./start.sh"] 