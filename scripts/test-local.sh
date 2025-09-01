#!/bin/bash

set -e

echo "🔧 Building Docker image..."
docker build -t background-function-network-intelligence:test .

echo "🚀 Starting container..."
docker run --rm -d \
  --env-file .env.local \
  -p 3000:3000 \
  -p 3001:3001 \
  --name bg-function-test \
  background-function-network-intelligence:test

echo "⏳ Waiting for container to start..."
sleep 5

echo "🏥 Testing health endpoint..."
if curl -f http://localhost:3001/health; then
  echo "✅ Health check passed!"
else
  echo "❌ Health check failed!"
  docker logs bg-function-test
  docker stop bg-function-test
  exit 1
fi

echo "📋 Container logs:"
docker logs bg-function-test

echo "🛑 Stopping container..."
docker stop bg-function-test

echo "✅ Local test completed successfully!"
