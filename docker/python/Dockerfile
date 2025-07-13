FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libpq-dev \
    gcc \
    openssl \
    libwebp-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python dependencies
COPY python/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY python/ ./python/
COPY private/ ./private/

# Create necessary directories
RUN mkdir -p /app/imports /app/assets/images /app/assets/videos /app/temp

# Generate initial encryption key if not exists
RUN [ ! -f /app/private/encryption.key ] && openssl rand -hex 16 > /app/private/encryption.key || true

# Run the media processor
CMD ["python", "python/process_files.py"]