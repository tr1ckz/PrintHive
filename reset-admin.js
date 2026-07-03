#!/usr/bin/env node
/**
 * Reset Admin User Script (Node.js version)
 * Resets the admin user password and ensures superadmin role.
 *
 * PrintHive uses PostgreSQL, so this connects using the same PG_* environment
 * variables as the application (PG_HOST, PG_USER, PG_PASSWORD, PG_DB).
 */

const bcrypt = require('bcryptjs');

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

  try {
    // Ensure the connection is up and the schema exists.
    await initDatabase();
    console.log('✓ Connected to PostgreSQL');
    console.log('');

    // Show current admin user status
    console.log('Current admin user status:');
    const currentAdmin = await db.prepare('SELECT id, username, role, created_at FROM users WHERE username = ?').get('admin');
    if (currentAdmin) {
      console.log(currentAdmin);
    } else {
      console.log('No admin user found');
    }
    console.log('');

    // Reset admin user
    console.log('Resetting admin user...');
    const passwordHash = bcrypt.hashSync('admin', 12);

    if (currentAdmin) {
      await db.prepare('UPDATE users SET role = ?, password = ? WHERE username = ?')
        .run('superadmin', passwordHash, 'admin');
      console.log('✓ Updated existing admin user');
    } else {
      await db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
        .run('admin', passwordHash, 'superadmin');
      console.log('✓ Created new admin user');
    }
    console.log('');

    // Show updated admin user status
    console.log('Updated admin user status:');
    const updatedAdmin = await db.prepare('SELECT id, username, role, created_at FROM users WHERE username = ?').get('admin');
    console.log(updatedAdmin);
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
    console.log('  Username: admin');
    console.log('  Password: admin');
    console.log('  Role: superadmin');
    console.log('');
    console.log('⚠️  Please change the password after logging in!');
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
