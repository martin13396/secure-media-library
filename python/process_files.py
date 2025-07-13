#!/usr/bin/env python3
"""
Media Processing Script with HLS Encryption and Animated Thumbnails
Monitors import directory and processes media files
"""

import os
import subprocess
import secrets
import asyncio
import json
import hashlib
import time
import logging
from pathlib import Path
from typing import Tuple, Optional
from datetime import datetime
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from PIL import Image
import pillow_heif
import yaml
from dotenv import load_dotenv

# Register HEIF/HEIC opener with Pillow
pillow_heif.register_heif_opener()

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class Config:
    """Configuration management"""
    def __init__(self):
        self.db_config = {
            'host': os.getenv('DB_HOST', 'localhost'),
            'port': os.getenv('DB_PORT', '5432'),
            'database': os.getenv('DB_NAME', 'media_streaming'),
            'user': os.getenv('DB_USER', 'postgres'),
            'password': os.getenv('DB_PASSWORD', 'password')
        }
        
        self.storage = {
            'imports': Path('/app/imports'),
            'assets': Path('/app/assets'),
            'images': Path('/app/assets/images'),
            'videos': Path('/app/assets/videos'),
            'private': Path('/app/private'),
            'temp': Path('/app/temp')
        }
        
        self.media = {
            'image': {
                'extensions': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.dng'],
                'output_format': 'webp',
                'quality': 85,
                'max_width': 3840,
                'max_height': 2160
            },
            'video': {
                'extensions': ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'],
                'output_format': 'hls',
                'segment_duration': 10,
                'preset': 'veryfast',
                'crf': 23,
                'audio_bitrate': '128k'
            },
            'thumbnail': {
                'width': 320,
                'fps': 10,
                'duration': 3,
                'quality': 75,
                'compression_level': 6,
                'start_position': '10%'
            },
            'preview': {
                'width': 480,
                'fps': 5,
                'max_frames': 20,
                'quality': 80,
                'compression_level': 6,
                'scene_threshold': 0.4
            }
        }
        
        # Create directories if they don't exist
        for path in self.storage.values():
            path.mkdir(parents=True, exist_ok=True)


class DatabaseManager:
    """Database operations manager with connection pooling and auto-reconnection"""
    def __init__(self, config: dict):
        self.config = config
        self.connection_pool = None
        self.max_retries = 3
        self.retry_delay = 2  # seconds
        
    def connect(self):
        """Establish database connection pool"""
        try:
            self.connection_pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=1,
                maxconn=10,
                **self.config
            )
            logger.info("Connected to database with connection pool")
        except Exception as e:
            logger.error(f"Database connection pool creation failed: {e}")
            raise
            
    def disconnect(self):
        """Close database connection pool"""
        if self.connection_pool:
            self.connection_pool.closeall()
            logger.info("Database connection pool closed")
    
    def _get_connection(self):
        """Get a connection from the pool with retry logic"""
        for attempt in range(self.max_retries):
            try:
                if not self.connection_pool:
                    logger.warning("Connection pool not initialized, reconnecting...")
                    self.connect()
                
                conn = self.connection_pool.getconn()
                
                # Test connection health
                with conn.cursor() as test_cursor:
                    test_cursor.execute("SELECT 1")
                
                return conn
                
            except (psycopg2.OperationalError, psycopg2.InterfaceError, psycopg2.DatabaseError) as e:
                logger.warning(f"Database connection attempt {attempt + 1} failed: {e}")
                
                if self.connection_pool:
                    try:
                        self.connection_pool.closeall()
                    except:
                        pass
                    self.connection_pool = None
                
                if attempt < self.max_retries - 1:
                    import time
                    time.sleep(self.retry_delay * (attempt + 1))  # Exponential backoff
                    try:
                        self.connect()
                    except Exception as reconnect_error:
                        logger.error(f"Reconnection attempt failed: {reconnect_error}")
                        continue
                else:
                    logger.error("All database connection attempts failed")
                    raise
        
        raise psycopg2.OperationalError("Could not establish database connection after retries")
    
    def _put_connection(self, conn):
        """Return connection to pool"""
        if self.connection_pool and conn:
            try:
                self.connection_pool.putconn(conn)
            except Exception as e:
                logger.warning(f"Error returning connection to pool: {e}")
                
    def execute(self, query: str, params: tuple = None):
        """Execute a query with automatic retry"""
        conn = None
        try:
            conn = self._get_connection()
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(query, params)
                conn.commit()
        except Exception as e:
            if conn:
                try:
                    conn.rollback()
                except:
                    pass
            logger.error(f"Database execute error: {e}")
            raise
        finally:
            self._put_connection(conn)
            
    def fetch_one(self, query: str, params: tuple = None) -> dict:
        """Fetch one record with automatic retry"""
        conn = None
        try:
            conn = self._get_connection()
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(query, params)
                return cursor.fetchone()
        except Exception as e:
            logger.error(f"Database fetch_one error: {e}")
            raise
        finally:
            self._put_connection(conn)
            
    def fetch_all(self, query: str, params: tuple = None) -> list:
        """Fetch all records with automatic retry"""
        conn = None
        try:
            conn = self._get_connection()
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(query, params)
                return cursor.fetchall()
        except Exception as e:
            logger.error(f"Database fetch_all error: {e}")
            raise
        finally:
            self._put_connection(conn)
    
    def check_connection_health(self) -> bool:
        """Check if database connection pool is healthy"""
        try:
            conn = self._get_connection()
            with conn.cursor() as cursor:
                cursor.execute("SELECT version()")
                version = cursor.fetchone()
                logger.debug(f"Database health check passed: {version[0] if version else 'Connected'}")
            self._put_connection(conn)
            return True
        except Exception as e:
            logger.warning(f"Database health check failed: {e}")
            return False
    
    def get_connection_stats(self) -> dict:
        """Get connection pool statistics"""
        if not self.connection_pool:
            return {"status": "disconnected", "pool": None}
        
        try:
            # Get pool statistics if available
            stats = {
                "status": "connected",
                "pool": {
                    "minconn": getattr(self.connection_pool, 'minconn', 'unknown'),
                    "maxconn": getattr(self.connection_pool, 'maxconn', 'unknown'),
                    "closed": getattr(self.connection_pool, 'closed', 'unknown')
                }
            }
            return stats
        except Exception as e:
            logger.warning(f"Error getting connection stats: {e}")
            return {"status": "error", "error": str(e)}
            
    def get_or_create_encryption_key(self) -> dict:
        """Get active encryption key or create new one"""
        query = """
            SELECT id, key_value, iv_value 
            FROM encryption_keys 
            WHERE is_active = true 
            LIMIT 1
        """
        key = self.fetch_one(query)
        
        if not key:
            # Create new key using a separate connection to ensure proper transaction handling
            conn = None
            try:
                conn = self._get_connection()
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    new_key = secrets.token_hex(16)
                    new_iv = secrets.token_hex(16)
                    
                    insert_query = """
                        INSERT INTO encryption_keys (key_value, iv_value, is_active)
                        VALUES (%s, %s, true)
                        RETURNING id, key_value, iv_value
                    """
                    cursor.execute(insert_query, (new_key, new_iv))
                    key = cursor.fetchone()
                    conn.commit()
                    logger.info(f"Created new encryption key with ID: {key['id']}")
                    
                    # Verify the key was actually saved
                    cursor.execute(query)
                    verification = cursor.fetchone()
                    if not verification:
                        raise Exception("Encryption key was not properly saved to database")
                    logger.info(f"Verified encryption key exists in database: {verification['id']}")
                    
            except Exception as e:
                if conn:
                    try:
                        conn.rollback()
                    except:
                        pass
                logger.error(f"Failed to create encryption key: {e}")
                # Try to get existing key again in case another process created one
                key = self.fetch_one(query)
                if not key:
                    raise Exception("Unable to create or retrieve encryption key")
            finally:
                self._put_connection(conn)
        
        # Ensure the encryption key file contains binary data (FFmpeg requirement)
        self._write_binary_key_file(key['key_value'])
            
        return key
    
    def _write_binary_key_file(self, key_hex: str):
        """Write binary key file for FFmpeg (expects 16 bytes, not hex string)"""
        key_path = Path('/app/private/encryption.key')
        key_bytes = bytes.fromhex(key_hex)
        with open(key_path, 'wb') as f:
            f.write(key_bytes)
        
    def add_to_processing_queue(self, file_path: str, file_type: str):
        """Add file to processing queue"""
        query = """
            INSERT INTO processing_queue (file_path, file_type, status)
            VALUES (%s, %s, 'queued')
            ON CONFLICT (file_path) DO NOTHING
        """
        self.execute(query, (file_path, file_type))
        
    def update_queue_status(self, file_path: str, status: str, error_message: str = None):
        """Update processing queue status"""
        query = """
            UPDATE processing_queue
            SET status = %s, error_message = %s, 
                started_at = CASE WHEN %s = 'processing' THEN NOW() ELSE started_at END,
                completed_at = CASE WHEN %s IN ('completed', 'failed') THEN NOW() ELSE completed_at END
            WHERE file_path = %s
        """
        self.execute(query, (status, error_message, status, status, file_path))
        
    def check_duplicate_by_hash(self, file_hash: str) -> Optional[dict]:
        """Check if a file with this hash already exists"""
        query = """
            SELECT id, original_name, file_type, storage_path
            FROM media_files
            WHERE file_hash = %s
            LIMIT 1
        """
        return self.fetch_one(query, (file_hash,))
    
    def save_media_metadata(self, metadata: dict):
        """Save media file metadata"""
        query = """
            INSERT INTO media_files (
                id, original_name, file_hash, file_type, mime_type, file_size_bytes,
                width, height, duration_seconds, storage_path, 
                thumbnail_path, preview_path, encryption_key_id,
                processing_status, processing_completed_at, metadata
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s
            )
        """
        self.execute(query, (
            metadata['id'], metadata['original_name'], metadata['file_hash'],
            metadata['file_type'], metadata['mime_type'], metadata['file_size_bytes'],
            metadata.get('width'), metadata.get('height'), metadata.get('duration_seconds'),
            metadata['storage_path'], metadata.get('thumbnail_path'),
            metadata.get('preview_path'), metadata['encryption_key_id'],
            'completed', json.dumps(metadata.get('extra_metadata', {}))
        ))
        
    def get_pending_jobs(self, limit: int = 5) -> list:
        """Get pending jobs from the queue"""
        query = """
            SELECT id, file_path, file_type, retry_count, max_retries
            FROM processing_queue
            WHERE status = 'queued'
            AND retry_count < max_retries
            ORDER BY priority DESC, queued_at ASC
            LIMIT %s
        """
        return self.fetch_all(query, (limit,))
        
    def get_failed_jobs_for_retry(self, limit: int = 5) -> list:
        """Get failed jobs that can be retried"""
        query = """
            SELECT id, file_path, file_type, retry_count, max_retries
            FROM processing_queue
            WHERE status = 'failed'
            AND retry_count < max_retries
            AND (completed_at IS NULL OR completed_at < NOW() - INTERVAL '5 minutes')
            ORDER BY priority DESC, queued_at ASC
            LIMIT %s
        """
        return self.fetch_all(query, (limit,))
        
    def increment_retry_count(self, queue_id: str):
        """Increment retry count for a job"""
        query = """
            UPDATE processing_queue
            SET retry_count = retry_count + 1,
                status = 'queued',
                error_message = NULL,
                started_at = NULL,
                completed_at = NULL
            WHERE id = %s
        """
        self.execute(query, (queue_id,))
        
    def mark_job_as_processing(self, queue_id: str):
        """Mark a job as processing"""
        query = """
            UPDATE processing_queue
            SET status = 'processing',
                started_at = NOW()
            WHERE id = %s
        """
        self.execute(query, (queue_id,))


class MediaProcessor:
    """Media processing engine"""
    def __init__(self, config: Config, db: DatabaseManager):
        self.config = config
        self.db = db
        self.encryption_key_path = config.storage['private'] / 'encryption.key'
        # Ensure encryption key is in binary format on startup
        logger.info("Initializing encryption key...")
        self.encryption_key = self.db.get_or_create_encryption_key()
        logger.info(f"Encryption key initialized with ID: {self.encryption_key['id']}")
        
    def generate_file_id(self, file_path: str) -> str:
        """Generate unique ID for file"""
        timestamp = str(int(time.time() * 1000000))
        hash_input = f"{file_path}{timestamp}".encode()
        return hashlib.sha256(hash_input).hexdigest()[:16]
    
    def calculate_file_hash(self, file_path: Path) -> str:
        """Calculate SHA-256 hash of file contents"""
        sha256_hash = hashlib.sha256()
        with open(file_path, "rb") as f:
            # Read in chunks to handle large files
            for byte_block in iter(lambda: f.read(4096), b""):
                sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()
        
    def get_mime_type(self, file_path: Path) -> str:
        """Get MIME type from file extension"""
        ext = file_path.suffix.lower()
        mime_types = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
            '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic','.dng': 'image/dng',
            '.mp4': 'video/mp4', '.avi': 'video/avi', '.mov': 'video/quicktime',
            '.mkv': 'video/x-matroska', '.webm': 'video/webm'
        }
        return mime_types.get(ext, 'application/octet-stream')
        
    async def process_file(self, file_path: Path):
        """Process a single file"""
        try:
            logger.info(f"Processing file: {file_path}")
            
            # Update queue status
            self.db.update_queue_status(str(file_path), 'processing')
            
            # Calculate file hash first to check for duplicates
            file_hash = self.calculate_file_hash(file_path)
            logger.info(f"File hash: {file_hash}")
            
            # Check if this file already exists
            duplicate = self.db.check_duplicate_by_hash(file_hash)
            if duplicate:
                logger.warning(f"Duplicate file detected: {file_path.name} matches existing file '{duplicate['original_name']}' (ID: {duplicate['id']})")
                # Mark as completed in queue and remove the duplicate file
                self.db.update_queue_status(str(file_path), 'completed', f"Duplicate of existing file ID: {duplicate['id']}")
                file_path.unlink()
                logger.info(f"Removed duplicate file: {file_path}")
                return
            
            # Get file info
            file_stats = file_path.stat()
            file_id = self.generate_file_id(str(file_path))
            mime_type = self.get_mime_type(file_path)
            
            # Use the cached encryption key, but refresh it from DB to ensure it exists
            encryption_key = self.db.get_or_create_encryption_key()
            logger.info(f"Using encryption key ID: {encryption_key['id']}")
            
            # Determine file type
            ext = file_path.suffix.lower()
            if ext in self.config.media['image']['extensions']:
                result = await self.process_image(file_path, file_id, encryption_key)
                file_type = 'image'
            elif ext in self.config.media['video']['extensions']:
                result = await self.process_video(file_path, file_id, encryption_key)
                file_type = 'video'
            else:
                raise ValueError(f"Unsupported file type: {ext}")
                
            # Verify encryption key exists before saving metadata
            key_check = self.db.fetch_one(
                "SELECT id FROM encryption_keys WHERE id = %s",
                (encryption_key['id'],)
            )
            if not key_check:
                logger.error(f"Encryption key {encryption_key['id']} does not exist in database!")
                raise Exception(f"Encryption key {encryption_key['id']} not found in database")
            
            # Save metadata
            metadata = {
                'id': file_id,
                'original_name': file_path.name,
                'file_hash': file_hash,
                'file_type': file_type,
                'mime_type': mime_type,
                'file_size_bytes': file_stats.st_size,
                'encryption_key_id': encryption_key['id'],
                **result
            }
            
            logger.info(f"Saving media metadata with encryption_key_id: {encryption_key['id']}")
            self.db.save_media_metadata(metadata)
            
            # Update queue status
            self.db.update_queue_status(str(file_path), 'completed')
            
            # Remove original file
            file_path.unlink()
            logger.info(f"Successfully processed: {file_path.name}")
            
        except Exception as e:
            logger.error(f"Error processing {file_path}: {e}")
            self.db.update_queue_status(str(file_path), 'failed', str(e))
            
    async def process_image(self, input_path: Path, image_id: str, encryption_key: dict) -> dict:
        """Process image file"""
        output_path = self.config.storage['images'] / f"{image_id}.webp"
        thumbnail_path = self.config.storage['images'] / f"{image_id}_thumb.webp"
        
        # Open and convert image
        with Image.open(input_path) as img:
            # Convert to RGB if necessary
            if img.mode in ('RGBA', 'LA'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[-1])
                img = background
            elif img.mode not in ('RGB',):
                img = img.convert('RGB')
                
            # Save original dimensions
            original_width, original_height = img.size
            
            # Resize if needed for main image
            max_width = self.config.media['image']['max_width']
            max_height = self.config.media['image']['max_height']
            
            if img.width > max_width or img.height > max_height:
                img.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)
                
            # Save as WebP
            img.save(output_path, 'WEBP', quality=self.config.media['image']['quality'])
            
            width, height = img.size
            
        # Generate thumbnail
        self.generate_image_thumbnail(input_path, thumbnail_path)
        
        # Encrypt both the image and thumbnail
        encrypted_path = self.encrypt_file(output_path, encryption_key['key_value'])
        encrypted_thumbnail = self.encrypt_file(thumbnail_path, encryption_key['key_value'])
        
        return {
            'width': width,
            'height': height,
            'storage_path': f"images/{image_id}.webp.enc",
            'thumbnail_path': f"images/{image_id}_thumb.webp.enc"
        }
        
    def encrypt_file(self, file_path: Path, key_hex: str) -> Path:
        """Encrypt file with AES-128"""
        encrypted_path = file_path.with_suffix(file_path.suffix + '.enc')
        
        # Check if file exists and has content
        if not file_path.exists():
            logger.error(f"File to encrypt does not exist: {file_path}")
            # Create a minimal placeholder encrypted file
            # This is a 1x1 black WebP encrypted with zeros IV
            placeholder_webp = b'RIFF$\x00\x00\x00WEBPVP8 \x18\x00\x00\x000\x01\x00\x9d\x01*\x01\x00\x01\x00\x01@%\xa4\x00\x03p\x00\xfe\xfb\x94\x00\x00'
            key = bytes.fromhex(key_hex)
            iv = b'\x00' * 16
            
            # Pad and encrypt placeholder
            pad_len = 16 - (len(placeholder_webp) % 16)
            padded = placeholder_webp + bytes([pad_len]) * pad_len
            
            cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
            encryptor = cipher.encryptor()
            ciphertext = encryptor.update(padded) + encryptor.finalize()
            
            with open(encrypted_path, 'wb') as f:
                f.write(iv + ciphertext)
            
            logger.warning(f"Created placeholder encrypted file: {encrypted_path}")
            return encrypted_path
            
        file_size = file_path.stat().st_size
        if file_size == 0:
            logger.error(f"File to encrypt is empty: {file_path}")
            # Handle same as non-existent file
            file_path.unlink()  # Remove empty file
            return self.encrypt_file(Path("non-existent"), key_hex)  # Recursive call to create placeholder
        
        if file_size < 100:
            logger.warning(f"File to encrypt is suspiciously small ({file_size} bytes): {file_path}")
            
        key = bytes.fromhex(key_hex)
        iv = os.urandom(16)
        
        # Read file
        try:
            with open(file_path, 'rb') as f:
                plaintext = f.read()
                
            logger.info(f"Encrypting file: {file_path} ({len(plaintext)} bytes)")
            
            # Pad data to 16-byte boundary
            pad_len = 16 - (len(plaintext) % 16)
            plaintext += bytes([pad_len]) * pad_len
            
            # Encrypt
            cipher = Cipher(
                algorithms.AES(key),
                modes.CBC(iv),
                backend=default_backend()
            )
            encryptor = cipher.encryptor()
            ciphertext = encryptor.update(plaintext) + encryptor.finalize()
            
            # Write encrypted file (IV + ciphertext)
            with open(encrypted_path, 'wb') as f:
                f.write(iv + ciphertext)
                
            encrypted_size = encrypted_path.stat().st_size
            logger.info(f"Encrypted file created: {encrypted_path} ({encrypted_size} bytes)")
            
            # Validate encrypted file
            if encrypted_size < 32:  # Minimum size: 16 bytes IV + 16 bytes data
                logger.error(f"Encrypted file too small: {encrypted_size} bytes")
                
            # Remove original only if encryption was successful
            file_path.unlink()
            
        except Exception as e:
            logger.error(f"Encryption failed for {file_path}: {e}")
            # Create placeholder if encryption fails
            if encrypted_path.exists():
                encrypted_path.unlink()
            return self.encrypt_file(Path("non-existent"), key_hex)
        
        return encrypted_path
        
    def generate_image_thumbnail(self, input_path: Path, output_path: Path):
        """Generate thumbnail for image"""
        with Image.open(input_path) as img:
            # Convert to RGB if necessary
            if img.mode in ('RGBA', 'LA'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[-1])
                img = background
            elif img.mode not in ('RGB',):
                img = img.convert('RGB')
            
            # Create thumbnail with fixed width
            thumbnail_width = self.config.media['thumbnail']['width']
            
            # Calculate proportional height
            aspect_ratio = img.height / img.width
            thumbnail_height = int(thumbnail_width * aspect_ratio)
            
            # Resize for thumbnail
            img_thumb = img.resize((thumbnail_width, thumbnail_height), Image.Resampling.LANCZOS)
            
            # Save thumbnail as WebP
            img_thumb.save(output_path, 'WEBP', quality=self.config.media['thumbnail']['quality'])
        
    async def process_video(self, input_path: Path, video_id: str, encryption_key: dict) -> dict:
        """Process video with HLS encryption and animated thumbnails"""
        output_dir = self.config.storage['videos'] / video_id
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Get video information
        duration, width, height = self.get_video_info(input_path)
        
        # Generate unique IV for this video
        iv = secrets.token_hex(16)
        
        # Create key info file
        key_info_path = self.create_key_info_file(video_id, iv)
        
        # Generate animated thumbnails first (in parallel)
        thumbnail_task = asyncio.create_task(
            asyncio.to_thread(
                self.generate_animated_thumbnail,
                input_path, output_dir, video_id, duration
            )
        )
        
        # FFmpeg command with HLS encryption
        cmd = [
            'ffmpeg', '-i', str(input_path),
            '-vf', f'scale=w=trunc(iw*min(1\\,min(1280/iw\\,720/ih))/2)*2:h=trunc(ih*min(1\\,min(1280/iw\\,720/ih))/2)*2',
            '-c:v', 'libx264',
            '-preset', self.config.media['video']['preset'],
            '-crf', str(self.config.media['video']['crf']),
            '-c:a', 'aac',
            '-b:a', self.config.media['video']['audio_bitrate'],
            '-hls_time', str(self.config.media['video']['segment_duration']),
            '-hls_list_size', '0',
            '-hls_segment_filename', str(output_dir / 'segment%03d.ts'),
            '-hls_key_info_file', str(key_info_path),
            '-hls_segment_type', 'mpegts',
            '-hls_flags', 'delete_segments+independent_segments',
            str(output_dir / 'stream.m3u8')
        ]
        
        # Execute FFmpeg for HLS
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            raise Exception(f"FFmpeg error: {result.stderr}")
            
        # Wait for thumbnail generation
        thumbnail_path, preview_path = await thumbnail_task
        
        # Encrypt thumbnails
        encrypted_thumbnail = self.encrypt_file(thumbnail_path, encryption_key['key_value'])
        encrypted_preview = self.encrypt_file(preview_path, encryption_key['key_value'])
        
        # Clean up temporary key info file
        key_info_path.unlink()
        
        return {
            'width': width,
            'height': height,
            'duration_seconds': duration,
            'storage_path': f"videos/{video_id}/stream.m3u8",
            'thumbnail_path': f"videos/{video_id}/thumbnail.webp.enc",
            'preview_path': f"videos/{video_id}/preview.webp.enc",
            'extra_metadata': {'iv': iv}
        }
        
    def get_video_info(self, input_path: Path) -> Tuple[float, int, int]:
        """Get video duration and dimensions"""
        cmd = [
            'ffprobe', '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,duration',
            '-of', 'json',
            str(input_path)
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        data = json.loads(result.stdout)
        
        if not data.get('streams'):
            raise ValueError("No video stream found")
            
        stream = data['streams'][0]
        
        return (
            float(stream.get('duration', 0)),
            int(stream.get('width', 0)),
            int(stream.get('height', 0))
        )
        
    def create_key_info_file(self, video_id: str, iv: str) -> Path:
        """Create key_info.txt for FFmpeg HLS encryption"""
        key_info_path = self.config.storage['private'] / f"key_info_{video_id}.txt"
        
        # Use environment variable or default to localhost
        base_url = os.getenv('PUBLIC_BASE_URL', 'https://localhost:1027')
        
        with open(key_info_path, 'w') as f:
            # URL where the player will fetch the key
            f.write(f"{base_url}/api/media/keys/{video_id}\n")
            # Local path to encryption key
            f.write(f"{self.encryption_key_path}\n")
            # IV for this specific video
            f.write(f"{iv}\n")
            
        return key_info_path
        
    def generate_animated_thumbnail(self, input_path: Path, output_dir: Path, 
                                   video_id: str, duration: float) -> Tuple[Path, Path]:
        """Generate animated WebP thumbnail"""
        thumbnail_path = output_dir / 'thumbnail.webp'
        preview_path = output_dir / 'preview.webp'
        
        # Calculate start time (skip first 10% of video)
        start_time = max(5, duration * 0.1)  # Start at 10% or 5 seconds
        
        # First try to generate animated thumbnails
        animated_success = False
        
        # Generate 3-second animated thumbnail with improved settings
        cmd_thumbnail = [
            'ffmpeg', '-i', str(input_path),
            '-ss', str(start_time),
            '-t', str(self.config.media['thumbnail']['duration']),
            '-vf', f"fps={self.config.media['thumbnail']['fps']},scale={self.config.media['thumbnail']['width']}:-1:flags=lanczos",
            '-c:v', 'libwebp',  # Explicitly specify WebP codec
            '-lossless', '0',   # Use lossy compression
            '-compression_level', str(self.config.media['thumbnail']['compression_level']),
            '-quality', str(self.config.media['thumbnail']['quality']),
            '-preset', 'default',
            '-loop', '0',  # Infinite loop
            '-an',  # No audio
            '-vsync', '0',  # Passthrough timestamps
            str(thumbnail_path)
        ]
        
        # Execute thumbnail generation
        logger.info(f"Generating animated thumbnail with command: {' '.join(cmd_thumbnail)}")
        result_thumb = subprocess.run(cmd_thumbnail, capture_output=True, text=True)
        
        if result_thumb.returncode != 0:
            logger.error(f"Animated thumbnail generation failed: {result_thumb.stderr}")
            # Create a simple static thumbnail as fallback
            self.create_static_thumbnail(input_path, thumbnail_path, start_time)
        else:
            animated_success = True
            # Verify file size
            if thumbnail_path.exists() and thumbnail_path.stat().st_size > 1000:
                logger.info(f"Animated thumbnail created successfully: {thumbnail_path.stat().st_size} bytes")
            else:
                logger.error(f"Animated thumbnail too small or missing, creating static fallback")
                self.create_static_thumbnail(input_path, thumbnail_path, start_time)
                animated_success = False
        
        # For preview, use a simpler approach if animated thumbnails are failing
        if animated_success:
            # Try scene-based preview with simpler settings
            cmd_preview = [
                'ffmpeg', '-i', str(input_path),
                '-ss', str(start_time),
                '-t', '10',  # Sample 10 seconds
                '-vf', f"fps=1,scale={self.config.media['preview']['width']}:-1:flags=lanczos,select='not(mod(n\\,{int(self.config.media['preview']['fps'])}))'",
                '-frames:v', str(self.config.media['preview']['max_frames']),
                '-c:v', 'libwebp',
                '-lossless', '0',
                '-compression_level', str(self.config.media['preview']['compression_level']),
                '-quality', str(self.config.media['preview']['quality']),
                '-preset', 'default',
                '-loop', '0',
                '-an',
                '-vsync', '0',
                str(preview_path)
            ]
            
            logger.info(f"Generating preview with command: {' '.join(cmd_preview)}")
            result_preview = subprocess.run(cmd_preview, capture_output=True, text=True)
            
            if result_preview.returncode != 0:
                logger.error(f"Preview generation failed: {result_preview.stderr}")
                # Use thumbnail as preview if preview generation fails
                if thumbnail_path.exists() and thumbnail_path.stat().st_size > 1000:
                    import shutil
                    shutil.copy(thumbnail_path, preview_path)
                else:
                    self.create_static_thumbnail(input_path, preview_path, start_time + 5)
        else:
            # If animated thumbnails aren't working, just create static previews
            logger.info("Skipping animated preview due to thumbnail issues, creating static preview")
            self.create_static_thumbnail(input_path, preview_path, start_time + 5)
        
        # Validate generated files
        for path, name in [(thumbnail_path, "thumbnail"), (preview_path, "preview")]:
            if not path.exists():
                logger.error(f"{name} file not created, generating fallback")
                self.create_static_thumbnail(input_path, path, start_time)
            elif path.stat().st_size < 1000:
                logger.error(f"{name} file too small ({path.stat().st_size} bytes), regenerating")
                self.create_static_thumbnail(input_path, path, start_time)
        
        return thumbnail_path, preview_path
    
    def create_static_thumbnail(self, input_path: Path, output_path: Path, start_time: float):
        """Create a static thumbnail as fallback"""
        # Try different approaches to ensure we get a valid thumbnail
        attempts = [
            # Attempt 1: Standard static WebP
            [
                'ffmpeg', '-i', str(input_path),
                '-ss', str(start_time),
                '-vframes', '1',  # Extract single frame
                '-vf', f"scale={self.config.media['thumbnail']['width']}:-1:flags=lanczos",
                '-c:v', 'libwebp',
                '-lossless', '0',
                '-compression_level', str(self.config.media['thumbnail']['compression_level']),
                '-quality', str(self.config.media['thumbnail']['quality']),
                '-y',  # Overwrite output
                str(output_path)
            ],
            # Attempt 2: Try without explicit codec
            [
                'ffmpeg', '-i', str(input_path),
                '-ss', str(max(0, start_time - 2)),  # Try a bit earlier
                '-vframes', '1',
                '-vf', f"scale={self.config.media['thumbnail']['width']}:-1:flags=lanczos",
                '-y',
                str(output_path)
            ]
        ]
        
        success = False
        for i, cmd in enumerate(attempts):
            logger.info(f"Static thumbnail attempt {i+1}: {' '.join(cmd)}")
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                # Check if file was created successfully
                if output_path.exists() and output_path.stat().st_size > 1000:
                    success = True
                    logger.info(f"Successfully created static thumbnail: {output_path.stat().st_size} bytes")
                    break
                else:
                    logger.error(f"Attempt {i+1} created file too small or missing")
            else:
                logger.error(f"Attempt {i+1} failed: {result.stderr}")
        
        if not success:
            logger.error(f"All thumbnail generation attempts failed, creating placeholder")
            # Create a placeholder image
            try:
                from PIL import Image, ImageDraw
                img = Image.new('RGB', (320, 180), color='#1a1a1a')
                draw = ImageDraw.Draw(img)
                # Add a simple icon or text
                draw.rectangle([(140, 70), (180, 110)], outline='#666666', width=2)
                draw.polygon([(150, 80), (170, 90), (150, 100)], fill='#666666')
                img.save(output_path, 'WEBP', quality=80)
                logger.info(f"Created placeholder thumbnail: {output_path}")
            except Exception as e:
                logger.error(f"Failed to create placeholder: {e}")
                # Last resort: create minimal WebP
                with open(output_path, 'wb') as f:
                    # This is a minimal valid WebP file (1x1 black pixel)
                    f.write(b'RIFF$\x00\x00\x00WEBPVP8 \x18\x00\x00\x000\x01\x00\x9d\x01*\x01\x00\x01\x00\x01@%\xa4\x00\x03p\x00\xfe\xfb\x94\x00\x00')


class FileWatcher(FileSystemEventHandler):
    """Watch for new files in imports directory"""
    def __init__(self, processor: MediaProcessor, db: DatabaseManager):
        self.processor = processor
        self.db = db
        
    def on_created(self, event):
        """Handle new file creation"""
        if event.is_directory:
            return
            
        file_path = Path(event.src_path)
        ext = file_path.suffix.lower()
        
        # Check if it's a supported file type
        if (ext in self.processor.config.media['image']['extensions'] or 
            ext in self.processor.config.media['video']['extensions']):
            
            try:
                # Add to processing queue
                file_type = 'image' if ext in self.processor.config.media['image']['extensions'] else 'video'
                self.db.add_to_processing_queue(str(file_path), file_type)
                logger.info(f"Added new file to processing queue: {file_path}")
            except Exception as e:
                logger.error(f"Error adding file to queue in file watcher: {e}")
                # File will be picked up by periodic scanner if this fails


async def scan_for_new_files(config: Config, db: DatabaseManager):
    """Periodically scan for new files that might have been missed"""
    last_scan_time = time.time()
    scan_interval = 60  # Scan every 60 seconds
    consecutive_errors = 0
    max_consecutive_errors = 5
    
    while True:
        try:
            current_time = time.time()
            if current_time - last_scan_time >= scan_interval:
                logger.info("Running periodic scan for new files...")
                imports_path = config.storage['imports']
                new_files_found = 0
                
                for file_path in imports_path.iterdir():
                    if file_path.is_file():
                        ext = file_path.suffix.lower()
                        if (ext in config.media['image']['extensions'] or 
                            ext in config.media['video']['extensions']):
                            
                            try:
                                # Check if file is already in queue
                                existing = db.fetch_one(
                                    "SELECT id FROM processing_queue WHERE file_path = %s",
                                    (str(file_path),)
                                )
                                
                                if not existing:
                                    file_type = 'image' if ext in config.media['image']['extensions'] else 'video'
                                    db.add_to_processing_queue(str(file_path), file_type)
                                    logger.info(f"Found new file during scan: {file_path}")
                                    new_files_found += 1
                            except Exception as db_error:
                                logger.error(f"Database error while scanning {file_path}: {db_error}")
                                continue
                
                if new_files_found > 0:
                    logger.info(f"Periodic scan found {new_files_found} new files")
                else:
                    logger.debug("Periodic scan found no new files")
                    
                last_scan_time = current_time
                consecutive_errors = 0  # Reset error count on successful scan
                
            await asyncio.sleep(10)  # Check every 10 seconds if it's time to scan
            
        except Exception as e:
            consecutive_errors += 1
            logger.error(f"Error in periodic scanner (attempt {consecutive_errors}): {e}")
            
            if consecutive_errors >= max_consecutive_errors:
                logger.error(f"Too many consecutive scanner errors ({consecutive_errors}), increasing wait time")
                await asyncio.sleep(120)  # Wait 2 minutes
                consecutive_errors = 0  # Reset counter
            else:
                await asyncio.sleep(30 * consecutive_errors)  # Exponential backoff


async def process_queue_worker(processor: MediaProcessor, db: DatabaseManager):
    """Background worker to process queued jobs"""
    consecutive_errors = 0
    max_consecutive_errors = 5
    
    while True:
        try:
            # Get pending jobs
            pending_jobs = db.get_pending_jobs(limit=5)
            
            # Get failed jobs that can be retried
            failed_jobs = db.get_failed_jobs_for_retry(limit=3)
            
            # Combine all jobs
            all_jobs = pending_jobs + failed_jobs
            
            if all_jobs:
                logger.info(f"Found {len(all_jobs)} jobs to process")
                
                # Process each job
                for job in all_jobs:
                    file_path = Path(job['file_path'])
                    
                    try:
                        # Check if file still exists
                        if not file_path.exists():
                            logger.warning(f"File not found, marking as failed: {file_path}")
                            db.update_queue_status(str(file_path), 'failed', 'File not found')
                            continue
                        
                        # Mark as processing
                        db.mark_job_as_processing(job['id'])
                        
                        # If this is a retry, increment the retry count
                        if job['retry_count'] > 0:
                            logger.info(f"Retrying job (attempt {job['retry_count'] + 1}): {file_path}")
                        
                        # Process the file
                        await processor.process_file(file_path)
                        
                    except (psycopg2.OperationalError, psycopg2.InterfaceError, psycopg2.DatabaseError) as db_error:
                        logger.error(f"Database error processing job {job['id']}: {db_error}")
                        # Don't mark job as failed - let it retry when DB is back
                        break  # Exit job loop to retry connection
                        
                    except Exception as e:
                        logger.error(f"Failed to process {file_path}: {e}")
                        # The process_file method already updates the status to 'failed'
                        
                        try:
                            # If we still have retries left, increment retry count
                            if job['retry_count'] + 1 < job['max_retries']:
                                db.increment_retry_count(job['id'])
                                logger.info(f"Job will be retried later: {file_path}")
                        except Exception as retry_error:
                            logger.error(f"Error updating retry count: {retry_error}")
            
            # Reset error count on successful iteration
            consecutive_errors = 0
            # Wait before checking again
            await asyncio.sleep(5)
            
        except (psycopg2.OperationalError, psycopg2.InterfaceError, psycopg2.DatabaseError) as db_error:
            consecutive_errors += 1
            logger.error(f"Database error in queue worker (attempt {consecutive_errors}): {db_error}")
            
            if consecutive_errors >= max_consecutive_errors:
                logger.error(f"Too many consecutive database errors ({consecutive_errors}), waiting longer")
                await asyncio.sleep(60)  # Wait 1 minute
                consecutive_errors = 0  # Reset counter
            else:
                await asyncio.sleep(10 * consecutive_errors)  # Exponential backoff
                
        except Exception as e:
            consecutive_errors += 1
            logger.error(f"Error in queue worker (attempt {consecutive_errors}): {e}")
            await asyncio.sleep(10 * min(consecutive_errors, 6))  # Wait longer on error


async def database_health_monitor(db: DatabaseManager):
    """Monitor database connection health"""
    health_check_interval = 300  # Check every 5 minutes
    
    while True:
        try:
            await asyncio.sleep(health_check_interval)
            
            # Check connection health
            is_healthy = db.check_connection_health()
            stats = db.get_connection_stats()
            
            if is_healthy:
                logger.info(f"Database health check: OK - {stats}")
            else:
                logger.error(f"Database health check: FAILED - {stats}")
                
        except Exception as e:
            logger.error(f"Error in database health monitor: {e}")
            await asyncio.sleep(60)  # Wait 1 minute on error


async def main():
    """Main function"""
    config = Config()
    db = DatabaseManager(config.db_config)
    
    try:
        # Connect to database
        db.connect()
        
        # Log initial connection status
        stats = db.get_connection_stats()
        logger.info(f"Database connected successfully: {stats}")
        
        # Initialize processor (this will ensure encryption key exists)
        processor = MediaProcessor(config, db)
        
        # Set up file watcher
        event_handler = FileWatcher(processor, db)
        observer = Observer()
        observer.schedule(event_handler, str(config.storage['imports']), recursive=True)
        
        # Start watching
        observer.start()
        logger.info(f"Watching directory: {config.storage['imports']}")
        
        # Start queue worker
        queue_worker_task = asyncio.create_task(process_queue_worker(processor, db))
        logger.info("Started queue processing worker")
        
        # Start periodic file scanner
        scanner_task = asyncio.create_task(scan_for_new_files(config, db))
        logger.info("Started periodic file scanner (scans every 60 seconds)")
        
        # Start database health monitor
        health_monitor_task = asyncio.create_task(database_health_monitor(db))
        logger.info("Started database health monitor (checks every 5 minutes)")
        
        # Process any existing files in imports directory on startup
        imports_path = config.storage['imports']
        startup_files_added = 0
        for file_path in imports_path.iterdir():
            if file_path.is_file():
                ext = file_path.suffix.lower()
                if (ext in config.media['image']['extensions'] or 
                    ext in config.media['video']['extensions']):
                    try:
                        file_type = 'image' if ext in config.media['image']['extensions'] else 'video'
                        db.add_to_processing_queue(str(file_path), file_type)
                        logger.info(f"Added existing file to queue: {file_path}")
                        startup_files_added += 1
                    except Exception as e:
                        logger.error(f"Error adding existing file to queue: {file_path}, error: {e}")
        
        if startup_files_added > 0:
            logger.info(f"Added {startup_files_added} existing files to processing queue")
        else:
            logger.info("No existing files found in imports directory")
        
        # Keep running
        try:
            await asyncio.gather(queue_worker_task, scanner_task, health_monitor_task)
        except KeyboardInterrupt:
            logger.info("Shutting down gracefully...")
            observer.stop()
            queue_worker_task.cancel()
            scanner_task.cancel()
            health_monitor_task.cancel()
            
        observer.join()
        
    finally:
        db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())