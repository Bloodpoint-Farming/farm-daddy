# Use Node.js LTS as base image
FROM node:24 AS build-env
WORKDIR /app
COPY package*.json /app
ENV NODE_ENV=production
RUN npm ci --omit=dev

FROM gcr.io/distroless/nodejs24-debian12
WORKDIR /app
COPY --from=build-env /app /app
COPY dist/ ./dist/

VOLUME /data

ENV NODE_ENV=production
ENV DB_PATH=/data/farm.sqlite

# Start the bot
CMD [ "dist/index.js" ]
