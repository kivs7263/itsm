# ---- Stage 1: deps ----
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# 모노레포 file: 의존성 해결
# package.json 의 "@total/ui-shell": "file:../../total/packages/ui-shell"
# 경로를 보존하기 위해 /total/packages/<pkg> 위치로 소스 풀기
# (WORKDIR=/app 기준 ../../ = / 이므로 /total/packages/<pkg> 가 file: 경로 타겟).
# COPY --from=<name> 는 docker buildx additional_contexts 로 주입된 named context.
COPY --from=total_tokens package.json /total/packages/tokens/package.json
COPY --from=total_tokens index.js /total/packages/tokens/index.js
COPY --from=total_tokens index.d.ts /total/packages/tokens/index.d.ts
COPY --from=total_tokens tailwind.js /total/packages/tokens/tailwind.js
COPY --from=total_tokens tokens.css /total/packages/tokens/tokens.css

COPY --from=total_ui_shell package.json /total/packages/ui-shell/package.json
COPY --from=total_ui_shell tsconfig.json /total/packages/ui-shell/tsconfig.json
COPY --from=total_ui_shell src /total/packages/ui-shell/src

COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN npm install --ignore-scripts

# ui-shell 은 react/react-dom 을 peerDependency 로만 선언 — Next.js(preserveSymlinks=false)는
# /total/packages/ui-shell/src/*.tsx 의 realpath 기준으로 위로 node_modules 탐색하므로
# /app/node_modules 에 도달하지 못함. ui-shell 디렉토리 안에 peer 의존성 심볼릭 링크 추가하여
# tsc/webpack 양쪽 resolution 모두 통과시킴.
RUN mkdir -p /total/packages/ui-shell/node_modules/@types \
 && ln -s /app/node_modules/react           /total/packages/ui-shell/node_modules/react \
 && ln -s /app/node_modules/react-dom       /total/packages/ui-shell/node_modules/react-dom \
 && ln -s /app/node_modules/lucide-react    /total/packages/ui-shell/node_modules/lucide-react \
 && ln -s /app/node_modules/@types/react    /total/packages/ui-shell/node_modules/@types/react \
 && ln -s /app/node_modules/@types/react-dom /total/packages/ui-shell/node_modules/@types/react-dom

# ---- Stage 2: builder ----
FROM node:20-alpine AS builder
WORKDIR /app

# deps 에서 풀어둔 모노레포 소스 그대로 전달 (next build 가 file: link 따라 트랜스파일)
COPY --from=deps /total /total
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* vars must be baked in at build time
ARG NEXT_PUBLIC_API_BASE=/api
ARG NEXT_PUBLIC_ITSM_URL=
ARG NEXT_PUBLIC_SA_URL=
ARG NEXT_PUBLIC_GW_URL=
ARG NEXT_PUBLIC_ADMIN_PORTAL_URL=
ARG NEXT_PUBLIC_COOKIE_DOMAIN=

ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_ITSM_URL=$NEXT_PUBLIC_ITSM_URL
ENV NEXT_PUBLIC_SA_URL=$NEXT_PUBLIC_SA_URL
ENV NEXT_PUBLIC_GW_URL=$NEXT_PUBLIC_GW_URL
ENV NEXT_PUBLIC_ADMIN_PORTAL_URL=$NEXT_PUBLIC_ADMIN_PORTAL_URL
ENV NEXT_PUBLIC_COOKIE_DOMAIN=$NEXT_PUBLIC_COOKIE_DOMAIN

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
