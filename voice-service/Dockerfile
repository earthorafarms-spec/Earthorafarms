# Voice service (Smartflo telephony bridge + browser voice) image.
#
# The build context is the REPOSITORY ROOT, not this directory: voice-service
# imports modules from ../../whatsapp-chatbot (prompt, product-card, provider,
# checkout-validation), so both trees have to be present when tsup bundles.
# The root .dockerignore is written for the API image and excludes exactly the
# directories this build needs, so BuildKit picks up Dockerfile.dockerignore
# next to this file instead.

FROM node:22-slim AS build
WORKDIR /app
COPY voice-service/package.json voice-service/package-lock.json voice-service/
RUN cd voice-service && npm ci --no-audit --no-fund
COPY voice-service voice-service
COPY whatsapp-chatbot whatsapp-chatbot
RUN cd voice-service && npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app/voice-service
COPY voice-service/package.json voice-service/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/voice-service/dist ./dist
# invoice-pdf.ts resolves Devanagari/Gujarati fonts from
# process.cwd()/assets/fonts at runtime, so they must ship with the image.
COPY voice-service/assets ./assets
# server.ts serves this directory with @fastify/static and warns at boot if it
# is absent. Dev-only test harnesses; they stay on loopback because nginx only
# proxies the telephony socket.
COPY voice-service/public ./public
EXPOSE 4200
CMD ["node", "dist/main.js"]
