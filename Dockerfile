FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV HOST=0.0.0.0 PORT=4173 NODE_ENV=production
USER node
EXPOSE 4173
CMD ["node", "server.js"]
