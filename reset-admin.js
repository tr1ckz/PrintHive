#!/usr/bin/env node
/**
 * Reset Admin User Script
 * Resets the admin user's password (and ensures superadmin role), or
 * creates the admin user if it doesn't exist yet. Use this if you're
 * locked out and can't reset the password from the Settings UI.
 *
 * PrintHive uses PostgreSQL, so this connects using the same PG_* environment
 * variables as the application (PG_HOST, PG_USER, PG_PASSWORD, PG_DB).
 *
 * Usage:
 *   npm run reset-admin                          # generates a random password
 *   npm run reset-admin -- --password=NewPass123  # sets a specific password
 *   npm run reset-admin -- --username=root --password=NewPass123
 *
 * The password may also be supplied via the ADMIN_RESET_PASSWORD env var
 * (handy for non-interactive/scripted resets where you don't want the
 * plaintext password showing up in shell history).
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const MIN_PASSWORD_LENGTH = 8;

function parseArgs(argv) {
  const args = { username: 'admin', password: null };
  for (const raw of argv) {
    const [key, ...rest] = raw.replace(/^--/, '').split('=');
    const value = rest.join('=');
    if (key === 'password') args.password = value;
    if (key === 'username') args.username = value || 'admin';
  }
  return args;
}

function generatePassword() {
  // 16 random bytes, base64url-encoded, trimmed to a clean 20-char token.
  return crypto.randomBytes(16).toString('base64url').slice(0, 20);
}

console.log('====================================');
console.log('PrintHive Admin Reset Script');
console.log('====================================');
console.log('');

(async () => {
  let db;
  let initDatabase;
  try {
    ({ db, initDatabase } = require('./database'));
  } catch (e) {
    console.error('❌ Error: could not load database module:', e.message);
    console.error('');
    console.error('Ensure dependencies are installed (npm install) and PG_HOST/PG_USER/PG_PASSWORD/PG_DB are set.');
    process.exit(1);
  }

  const { username } = parseArgs(process.argv.slice(2));
  let { password } = parseArgs(process.argv.slice(2));
  password = password || process.env.ADMIN_RESET_PASSWORD || null;

  let generated = false;
  if (!password) {
    password = generatePassword();
    generated = true;
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`❌ Error: password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }

  try {
    // Ensure the connection is up and the schema exists.
    await initDatabase();
    console.log('✓ Connected to PostgreSQL');
    console.log('');

    // Show current admin user status
    console.log(`Current "${username}" user status:`);
    const currentUser = await db.prepare('SELECT id, username, role, created_at FROM users WHERE username = ?').get(username);
    console.log(currentUser || `No user named "${username}" found`);
    console.log('');

    // Reset (or create) the user
    console.log(`Resetting "${username}" user...`);
    const passwordHash = bcrypt.hashSync(password, 12);

    if (currentUser) {
      await db.prepare('UPDATE users SET role = ?, password = ? WHERE username = ?')
        .run('superadmin', passwordHash, username);
      console.log('✓ Updated existing user (password reset, role set to superadmin)');
    } else {
      await db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
        .run(username, passwordHash, 'superadmin');
      console.log('✓ Created new superadmin user');
    }
    console.log('');

    // Show all users
    console.log('All users in database:');
    const allUsers = await db.prepare('SELECT id, username, role FROM users').all();
    console.table(allUsers);
    console.log('');

    await db.close();

    console.log('====================================');
    console.log('✓ Done!');
    console.log('====================================');
    console.log('');
    console.log('Admin credentials:');
    console.log(`  Username: ${username}`);
    console.log(`  Password: ${password}`);
    console.log('  Role:     superadmin');
    console.log('');
    if (generated) {
      console.log('⚠️  This password was auto-generated and is shown only once — save it now.');
    }
    console.log('⚠️  Consider changing the password from Settings after logging in.');
    console.log('');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('');
    console.error('Stack trace:');
    console.error(error.stack);
    process.exit(1);
  }
})();
