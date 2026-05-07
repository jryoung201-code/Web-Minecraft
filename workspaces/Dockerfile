# ─── Minecraft EasyProxi — Docker Image ───────────────────────────────────────
FROM node:20-alpine

# Labels
LABEL maintainer="EasyProxi Team"
LABEL description="Minecraft EasyProxi Cloud Gaming Backend"
LABEL version="1.0.0"

# Set working directory
WORKDIR /app

# Install dependencies first (layer caching)
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production

# Copy backend source
COPY backend/ ./backend/

# Copy frontend static files
COPY frontend/ ./frontend/

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV FRONTEND_URL=https://minecraft.easyproxi.online

# Start server
CMD ["node", "backend/server.js"]
