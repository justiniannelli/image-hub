# Stage 1: build the React client
FROM node:22 AS client
WORKDIR /app/client
COPY client/package.json ./
RUN npm install
COPY client ./
RUN npm run build

# Stage 2: run the server
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 HOST=0.0.0.0
COPY package.json ./
RUN npm install --omit=dev
COPY server ./server
COPY --from=client /app/client/dist ./client/dist
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.js"]
