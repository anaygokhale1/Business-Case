# Single-image build for the template. Builds the Next.js shell and serves it.
# The SQLite database is created and seeded at build time so the container runs
# with data out of the box.
FROM node:20-bookworm-slim

# Prisma needs OpenSSL at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Absolute DB path inside the image.
ENV DATABASE_URL="file:/app/dev.db"
ENV NODE_ENV=production

COPY . .

RUN npm install \
  && npm run generate -w @ssa/db \
  && npm run migrate -w @ssa/db \
  && npm run prisma:seed -w @ssa/shell \
  && npm run build -w @ssa/shell

EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@ssa/shell"]
