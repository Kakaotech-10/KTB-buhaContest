# Use Node.js official image as a base for building
FROM node:20 AS builder

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
FROM node:20 AS runner

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
