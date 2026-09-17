# Node 24 is required for the built-in node:sqlite module used by this app.
FROM node:24-slim

WORKDIR /app

# Install dependencies first so Docker can cache this layer between builds.
COPY package.json package-lock.json ./
RUN npm ci

# Now copy the rest of the source.
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV AI_PROVIDER=disabled
ENV DATABASE_PATH=/app/data/marketplace.sqlite

# Builds the production Next.js app (also runs the contract-drift check, same as `npm run build` locally).
RUN npm run build

EXPOSE 3000

# Reset/seed the demo database fresh on every container start, then serve on
# whatever port the platform assigns (Render sets $PORT; defaults to 3000 locally).
CMD npm run db:reset && npx next start -p ${PORT:-3000}
