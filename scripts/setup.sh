#!/bin/bash

echo "=== Secure Media Streaming Platform Setup ==="
echo

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "Warning: This setup script is optimized for macOS. Some commands may need adjustment for other platforms."
    echo
fi

# Make scripts executable
chmod +x scripts/*.sh

# Generate SSL certificate
echo "Step 1: Generating SSL certificate..."
./scripts/generate-ssl.sh
echo

# Generate encryption keys
echo "Step 2: Generating encryption keys..."
./scripts/generate-keys.sh
echo

# Create necessary directories
echo "Step 3: Creating directories..."
mkdir -p imports assets/{images,videos} logs temp
touch imports/.gitkeep assets/.gitkeep
echo "Directories created"
echo

# Check Docker installation
echo "Step 4: Checking Docker installation..."
if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Please install Docker Desktop for Mac from:"
    echo "https://www.docker.com/products/docker-desktop/"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "Docker is not running. Please start Docker Desktop."
    exit 1
fi

echo "Docker is installed and running"
echo

# Build Docker images
echo "Step 5: Building Docker images..."
docker-compose build
echo

# Initialize database
echo "Step 6: Starting database and initializing schema..."
docker-compose up -d postgres
echo "Waiting for PostgreSQL to start..."
sleep 10

# Check if database is ready
docker-compose exec postgres pg_isready -U postgres
if [ $? -eq 0 ]; then
    echo "Database is ready"
else
    echo "Database is not ready. Please check Docker logs."
    exit 1
fi

echo
echo "=== Setup Complete ==="
echo
echo "To start the application:"
echo "  docker-compose up -d"
echo
echo "To view logs:"
echo "  docker-compose logs -f"
echo
echo "Access the application at:"
echo "  https://127.0.0.1:1027"
echo
echo "Default admin credentials:"
echo "  Username: admin"
echo "  Password: password"
echo
echo "Note: VPN connection required for remote access"