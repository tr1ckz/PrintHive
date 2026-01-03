#!/bin/sh
# Reset Admin User Script
# This script resets the admin user password and ensures superadmin role

DB_PATH="/app/data/bambu-lab.db"

echo "===================================="
echo "Bambu Lab Admin Reset Script"
echo "===================================="
echo ""

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    echo "❌ Error: Database not found at $DB_PATH"
    exit 1
fi

echo "✓ Database found"
echo ""

# Show current admin user status
echo "Current admin user status:"
sqlite3 "$DB_PATH" "SELECT id, username, password, role, created_at FROM users WHERE username = 'admin';"
echo ""

# Update admin user to superadmin with password 'admin'
echo "Resetting admin user..."
sqlite3 "$DB_PATH" "UPDATE users SET role = 'superadmin', password = 'admin' WHERE username = 'admin';"

# If no admin user exists, create one
ADMIN_EXISTS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users WHERE username = 'admin';")
if [ "$ADMIN_EXISTS" = "0" ]; then
    echo "No admin user found. Creating new admin user..."
    sqlite3 "$DB_PATH" "INSERT INTO users (username, password, role) VALUES ('admin', 'admin', 'superadmin');"
fi

echo ""
echo "✓ Admin user reset complete!"
echo ""

# Show updated admin user status
echo "Updated admin user status:"
sqlite3 "$DB_PATH" "SELECT id, username, password, role, created_at FROM users WHERE username = 'admin';"
echo ""

# Show all users
echo "All users in database:"
sqlite3 "$DB_PATH" "SELECT id, username, role FROM users;"
echo ""

echo "===================================="
echo "✓ Done!"
echo "===================================="
echo ""
echo "Admin credentials:"
echo "  Username: admin"
echo "  Password: admin"
echo "  Role: superadmin"
echo ""
echo "⚠️  Please change the password after logging in!"
