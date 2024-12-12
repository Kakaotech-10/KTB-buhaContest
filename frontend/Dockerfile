# Use Node.js official image as a base for building
FROM node:20-alpine AS builder

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to install dependencies
COPY package*.json ./
COPY .npmrc ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the application
RUN npm run build

# Production image
FROM node:20-alpine AS runner

# Set the working directory
WORKDIR /usr/src/app

# Copy only the built files and necessary dependencies from the builder
COPY --from=builder /usr/src/app/.next ./.next
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package.json ./package.json
COPY --from=builder /usr/src/app/public ./public

# Expose the default Next.js port
EXPOSE 3000

# Define the command to start the application
CMD ["npm", "start"]

#-----
#     # 1단계: 빌드 단계
# FROM node:20-alpine AS builder

# # 작업 디렉토리 설정
# WORKDIR /usr/src/app

# # package.json, package-lock.json 및 .npmrc 파일 복사
# COPY package*.json ./
# COPY .npmrc ./

# # 모든 의존성 설치 (개발 및 프로덕션 의존성 포함)
# RUN npm install

# # 애플리케이션 코드 복사
# COPY . .

# # 애플리케이션 빌드
# RUN npm run build

# # 2단계: 프로덕션 이미지
# FROM node:20-alpine AS runner

# # 작업 디렉토리 설정
# WORKDIR /usr/src/app

# # 빌드 단계에서 필요한 파일만 복사
# COPY --from=builder /usr/src/app/.next ./.next
# COPY --from=builder /usr/src/app/node_modules ./node_modules
# COPY --from=builder /usr/src/app/package.json ./package.json
# COPY --from=builder /usr/src/app/public ./public

# # 프로덕션에 필요한 환경 설정 파일만 복사 (선택사항)
# # COPY --from=builder /usr/src/app/.env ./.env

# # 불필요한 개발 파일들은 제외

# # 기본 포트 노출
# EXPOSE 3000

# # 애플리케이션 실행 명령
# CMD ["npm", "start"]
