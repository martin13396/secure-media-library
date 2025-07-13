-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create custom types
CREATE TYPE user_role AS ENUM ('admin', 'user');
CREATE TYPE processing_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE media_type AS ENUM ('image', 'video');
CREATE TYPE queue_status AS ENUM ('queued', 'processing', 'completed', 'failed');

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role user_role DEFAULT 'user',
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$')
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_active ON users(is_active);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    device_id VARCHAR(255) NOT NULL,
    device_name VARCHAR(100),
    device_type VARCHAR(50),
    ip_address INET NOT NULL,
    user_agent TEXT,
    refresh_token_hash VARCHAR(255) UNIQUE NOT NULL,
    last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT unique_user_device UNIQUE(user_id, device_id)
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(refresh_token_hash);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX idx_sessions_activity ON sessions(last_activity_at);

-- Encryption keys table
CREATE TABLE IF NOT EXISTS encryption_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key_value VARCHAR(512) NOT NULL, -- Encrypted with master key
    iv_value VARCHAR(256) NOT NULL,
    algorithm VARCHAR(50) DEFAULT 'AES-128-CBC',
    is_active BOOLEAN DEFAULT true,
    rotation_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expired_at TIMESTAMP
);

CREATE INDEX idx_keys_active ON encryption_keys(is_active);
CREATE INDEX idx_keys_rotation ON encryption_keys(rotation_date);

-- Media files table
CREATE TABLE IF NOT EXISTS media_files (
    id VARCHAR(16) PRIMARY KEY, -- Using custom generated ID
    original_name VARCHAR(255) NOT NULL,
    file_hash VARCHAR(64), -- SHA-256 hash for duplicate detection
    file_type media_type NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    width INT,
    height INT,
    duration_seconds DECIMAL(10,2),
    favorite BOOLEAN NOT NULL DEFAULT false,
    storage_path VARCHAR(500) NOT NULL,
    thumbnail_path VARCHAR(500),
    preview_path VARCHAR(500),  -- Animated WebP preview
    encryption_key_id UUID NOT NULL,
    processing_status processing_status DEFAULT 'pending',
    processing_started_at TIMESTAMP,
    processing_completed_at TIMESTAMP,
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (encryption_key_id) REFERENCES encryption_keys(id),
    CONSTRAINT unique_file_hash UNIQUE (file_hash)
);

CREATE INDEX idx_media_type ON media_files(file_type);
CREATE INDEX idx_media_favorite ON media_files(favorite);
CREATE INDEX idx_media_status ON media_files(processing_status);
CREATE INDEX idx_media_created ON media_files(created_at);
CREATE INDEX idx_media_file_hash ON media_files(file_hash);

-- Access logs table
CREATE TABLE IF NOT EXISTS access_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    session_id UUID NOT NULL,
    media_file_id VARCHAR(16) NOT NULL,
    action VARCHAR(50) NOT NULL, -- 'view', 'download', 'stream'
    ip_address INET NOT NULL,
    vpn_client_ip INET NOT NULL, -- VPN assigned IP (10.8.0.x)
    user_agent TEXT,
    response_time_ms INT,
    bytes_transferred BIGINT,
    status_code INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (media_file_id) REFERENCES media_files(id),
    CONSTRAINT chk_vpn_subnet CHECK (vpn_client_ip << inet '10.8.0.0/24')
);

CREATE INDEX idx_logs_user ON access_logs(user_id);
CREATE INDEX idx_logs_media ON access_logs(media_file_id);
CREATE INDEX idx_logs_created ON access_logs(created_at);
CREATE INDEX idx_logs_session ON access_logs(session_id);
CREATE INDEX idx_logs_vpn_ip ON access_logs(vpn_client_ip);

-- Processing queue table
CREATE TABLE IF NOT EXISTS processing_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_path VARCHAR(500) NOT NULL,
    file_type VARCHAR(50) NOT NULL,
    priority INT DEFAULT 5,
    status queue_status DEFAULT 'queued',
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    error_message TEXT,
    worker_id VARCHAR(100),
    queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    CONSTRAINT unique_file_path UNIQUE(file_path)
);

CREATE INDEX idx_queue_status ON processing_queue(status, priority);
CREATE INDEX idx_queue_worker ON processing_queue(worker_id);

-- Create update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_media_files_updated_at BEFORE UPDATE ON media_files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default admin user (password: AdminPass123!)
INSERT INTO users (username, email, password_hash, full_name, role) VALUES
    ('admin', 'admin@admin.com', '$2a$12$O9rSMplu3cJ8WAvn.k/WIeC2jRv5hG0fdKDESLPMP/ZUk9e8YoFdC', 'System Administrator', 'admin')
ON CONFLICT (username) DO NOTHING;