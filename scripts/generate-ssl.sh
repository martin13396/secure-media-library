#!/bin/bash

# Generate self-signed SSL certificate
echo "Generating self-signed SSL certificate..."

# Create private directory if it doesn't exist
mkdir -p private

# Generate SSL certificate
openssl req -x509 -newkey rsa:2048 -keyout private/server.pem \
  -out private/server.pem -days 365 -nodes \
  -subj "/CN=media-server" \
  -addext "subjectAltName = DNS:localhost,DNS:media-server,IP:127.0.0.1"

echo "SSL certificate generated at: private/server.pem"

# Set appropriate permissions
chmod 600 private/server.pem
echo "Permissions set for SSL certificate"