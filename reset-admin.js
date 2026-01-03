#!/usr/bin/env node
/**
 * Reset Admin User Script (Node.js version)
 * Resets the admin user password and ensures superadmin role
 */

const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'bambu-lab.db');

console.log('====================================');
console.log('Bambu Lab Admin Reset Script');
console.log('====================================');
console.log('');

try {
  // Check if better-sqlite3 is available
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    console.error('❌ Error: better-sqlite3 module not found');
    console.error('');
    console.error('Please install dependencies first:');
    console.error('  npm install');
    console.error('');
    console.error('Or run the shell script version instead:');
    console.error('  sh reset-admin.sh');
    console.error('');
    console.error('For Docker containers, use:');
    console.error('  docker-compose exec bambu-web node reset-admin.js');
    process.exit(1);
  }

  // Check if database exists
  if (!fs.existsSync(DB_PATH)) {
    console.error('❌ Error: Database not found at:', DB_PATH);
    console.error('');
    console.error('Make sure the application has been run at least once to create the database.');
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  console.log('✓ Database found at:', DB_PATH);
  console.log('');

  // Show current admin user status
  console.log('Current admin user status:');
  const currentAdmin = db.prepare('SELECT id, username, password, role, created_at FROM users WHERE username = ?').get('admin');
  if (currentAdmin) {
    console.log(currentAdmin);
  } else {
    console.log('No admin user found');
  }
  console.log('');

  // Reset admin user
  console.log('Resetting admin user...');
  
  if (currentAdmin) {
    // Update existing admin user
    db.prepare('UPDATE users SET role = ?, password = ? WHERE username = ?')
      .run('superadmin', 'admin', 'admin');
    console.log('✓ Updated existing admin user');
  } else {
    // Create new admin user
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
      .run('admin', 'admin', 'superadmin');
    console.log('✓ Created new admin user');
  }
  
  console.log('');

  // Show updated admin user status
  console.log('Updated admin user status:');
  const updatedAdmin = db.prepare('SELECT id, username, password, role, created_at FROM users WHERE username = ?').get('admin');
  console.log(updatedAdmin);
  console.log('');

  // Show all users
  console.log('All users in database:');
  const allUsers = db.prepare('SELECT id, username, role FROM users').all();
  console.table(allUsers);
  console.log('');

  db.close();

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

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('');
  console.error('Stack trace:');
  console.error(error.stack);
  process.exit(1);
}
