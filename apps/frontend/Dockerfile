# Base Dockerfile for all Node.js services
FROM node:20-alpine AS base

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY .eslintrc.cjs .prettierrc ./

# Copy all packages and apps
COPY packages ./packages
COPY apps ./apps

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build shared packages
RUN pnpm --filter @orions-frontier/types build
RUN pnpm --filter @orions-frontier/shared build
RUN pnpm --filter @orions-frontier/game-config build

# This is a base image - actual build happens in docker-compose with volume mounts
