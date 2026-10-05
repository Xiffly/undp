FROM node:22-alpine AS build

WORKDIR /repo/apps/frontend
COPY apps/frontend/package*.json ./
RUN npm ci

WORKDIR /repo
COPY shared ./shared
COPY apps/frontend ./apps/frontend

WORKDIR /repo/apps/frontend
ARG VITE_API_URL=""
ARG VITE_SITE_URL="https://crisis-platform.com"
ARG VITE_SITE_NAME="UNDP Crisis Reporter"
ARG VITE_SITE_DESCRIPTION="Report crisis damage in your community. Help response teams act faster with verified field information."
ARG VITE_SEO_ALLOW_INDEXING="false"
ARG VITE_SEO_BLOCK_AI="true"
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SITE_URL=$VITE_SITE_URL
ENV VITE_SITE_NAME=$VITE_SITE_NAME
ENV VITE_SITE_DESCRIPTION=$VITE_SITE_DESCRIPTION
ENV VITE_SEO_ALLOW_INDEXING=$VITE_SEO_ALLOW_INDEXING
ENV VITE_SEO_BLOCK_AI=$VITE_SEO_BLOCK_AI
RUN npm run build

FROM nginx:alpine
COPY --from=build /repo/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
