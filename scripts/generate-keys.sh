#!/bin/bash

# Generate encryption keys
echo "Generating encryption keys..."

# Create private directory if it doesn't exist
mkdir -p private

# Generate HLS encryption key (16 bytes binary for FFmpeg)
openssl rand 16 > private/encryption.key
echo "HLS encryption key generated at: private/encryption.key (16 bytes binary)"

# Generate JWT secrets
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
MASTER_ENCRYPTION_KEY=$(openssl rand -hex 32)

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo ".env file created from .env.example"
fi

# Update .env file with generated secrets
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/JWT_ACCESS_SECRET=.*/JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET/" .env
    sed -i '' "s/JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET/" .env
    sed -i '' "s/MASTER_ENCRYPTION_KEY=.*/MASTER_ENCRYPTION_KEY=$MASTER_ENCRYPTION_KEY/" .env
else
    # Linux
    sed -i "s/JWT_ACCESS_SECRET=.*/JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET/" .env
    sed -i "s/JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET/" .env
    sed -i "s/MASTER_ENCRYPTION_KEY=.*/MASTER_ENCRYPTION_KEY=$MASTER_ENCRYPTION_KEY/" .env
fi

echo "JWT and master encryption keys generated and saved to .env"

# Set appropriate permissions
chmod 600 private/encryption.key
chmod 600 .env
echo "Permissions set for encryption keys"