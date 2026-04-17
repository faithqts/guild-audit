FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production \
	ENABLE_INTERNAL_REFRESH_JOBS=true \
	REFRESH_AUDIT_INTERVAL_MINUTES=15 \
	REFRESH_PLAYERS_INTERVAL_MINUTES=5 \
	REFRESH_JOBS_RUN_ON_START=false

EXPOSE 3000

CMD ["node", "main.js"]