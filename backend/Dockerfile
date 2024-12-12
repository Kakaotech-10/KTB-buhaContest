# Use the official Node.js image as a base image
FROM node:18

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production

# Copy the rest of the application files
COPY . .

# Expose the port the application runs on
EXPOSE 5000

# Define the command to run the application
CMD ["npm", "start"]

#-----


#     # 1단계: 빌드 단계
# FROM node:18-alpine AS build

# # 작업 디렉토리 설정
# WORKDIR /usr/src/app

# # package.json 및 package-lock.json 복사
# COPY package*.json ./

# # 모든 의존성 설치 (개발 및 프로덕션 의존성 포함)
# RUN npm install

# # 애플리케이션 파일 복사
# COPY . .

# # 2단계: 프로덕션 이미지
# FROM node:18-alpine AS production

# # 작업 디렉토리 설정
# WORKDIR /usr/src/app

# # package.json 및 package-lock.json 복사 (의존성만 포함)
# COPY --from=build /usr/src/app/package*.json ./

# # 프로덕션 의존성만 설치
# RUN npm install --only=production

# # 애플리케이션 파일 복사 (빌드 단계에서 복사된 파일만)
# COPY --from=build /usr/src/app ./

# # 포트 노출
# EXPOSE 5000

# # 애플리케이션 실행 명령
# CMD ["npm", "start"]
