FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci && npm run build
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data
RUN mkdir -p /data
VOLUME /data
EXPOSE 8080
CMD ["npm", "start"]
