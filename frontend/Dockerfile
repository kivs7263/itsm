# ---- Stage 1: deps ----
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN npm install --ignore-scripts

# ---- Stage 2: builder ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* vars must be baked in at build time
ARG NEXT_PUBLIC_API_BASE=/api
ARG NEXT_PUBLIC_ITSM_URL=
ARG NEXT_PUBLIC_SA_URL=
ARG NEXT_PUBLIC_GW_URL=
ARG NEXT_PUBLIC_ADMIN_PORTAL_URL=

ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_ITSM_URL=$NEXT_PUBLIC_ITSM_URL
ENV NEXT_PUBLIC_SA_URL=$NEXT_PUBLIC_SA_URL
ENV NEXT_PUBLIC_GW_URL=$NEXT_PUBLIC_GW_URL
ENV NEXT_PUBLIC_ADMIN_PORTAL_URL=$NEXT_PUBLIC_ADMIN_PORTAL_URL

RUN npm run build

# ---- Stage 3: runner ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# standalone output: server.js + static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
