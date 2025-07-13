const bcrypt = require('bcryptjs');

async function generatePasswordHash(password) {
  try {
    const hash = await bcrypt.hash(password, 12);
    return hash;
  } catch (error) {
    console.error('Error generating hash:', error);
    return null;
  }
}

async function verifyPasswordHash(password, hash) {
  try {
    const isValid = await bcrypt.compare(password, hash);
    return isValid;
  } catch (error) {
    console.error('Error verifying hash:', error);
    return false;
  }
}

async function main() {
  const password = process.argv[2];
  
  if (!password) {
    console.log('Usage: node generate-password-hash.js <password>');
    console.log('Example: node generate-password-hash.js MySecurePassword123!');
    process.exit(1);
  }

  console.log('\n=== Password Hash Generator ===');
  console.log(`Password: ${password}`);
  
  const hash = await generatePasswordHash(password);
  console.log(`Hash: ${hash}`);
  
  console.log('\n=== Verification Test ===');
  const isValid = await verifyPasswordHash(password, hash);
  console.log(`Verification: ${isValid ? 'PASSED' : 'FAILED'}`);
  
  console.log('\n=== SQL Insert Statement ===');
  console.log(`INSERT INTO users (username, email, password_hash, full_name, role) VALUES`);
  console.log(`  ('testuser', 'test@example.com', '${hash}', 'Test User', 'user');`);
}

main();