FROM node:20-alpine

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install all dependencies (including devDependencies required for vite build)
RUN npm install

# Copy source files
COPY . .

# Build the frontend single-page application into dist/
RUN npm run build

# Set production environment and default port
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Start Express backend server (which also serves dist/ frontend)
CMD ["node", "server/index.js"]
