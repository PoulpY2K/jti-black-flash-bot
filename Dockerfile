## build runner
FROM --platform=linux/amd64 node:20-alpine as build-runner

# Set temp directory
WORKDIR /tmp/app

# Move source files
COPY package.json .
COPY prisma ./prisma/
COPY src ./src
COPY tsconfig.json .

# Install dependencies
RUN npm install

# Build project
RUN npm run build

## production runner
FROM --platform=linux/amd64 node:20-alpine as prod-runner

# Set work directory
WORKDIR /app

# Copy build files from build-runner
COPY --from=build-runner /tmp/app/package.json /app/package.json
COPY --from=build-runner /tmp/app/prisma/ /app/prisma/
COPY --from=build-runner /tmp/app/build /app/build

# Install production dependencies
RUN npm install --omit=dev

# Start bot and migrate database
CMD ["npm", "run", "start:migrate"]