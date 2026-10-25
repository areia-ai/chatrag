FROM node:20-slim

WORKDIR /app

# CRITICAL: Install CA certificates for outbound HTTPS connections
# Without this, LiveKit SDK cannot reach LiveKit Cloud's signaling server
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Remove devDependencies to save space
RUN npm prune --production

# Start the agent
CMD ["npm", "start"]
