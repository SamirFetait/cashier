# whatsapp-web.js drives a real Chromium via Puppeteer.
FROM ghcr.io/puppeteer/puppeteer:23.10.4

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src

EXPOSE 3001
CMD ["node", "src/index.js"]
