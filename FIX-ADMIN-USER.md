# Fix Admin User to Superadmin

If the admin user is not showing as superadmin, use one of these methods:

## ⭐ Method 1: Use the Reset Script (RECOMMENDED)

### On Host Machine (Local Development)
```bash
# Run the Node.js script
npm run reset-admin

# Or run it directly
node reset-admin.js
```

### In Docker Container
```bash
# Copy script to container and run it
docker cp reset-admin.sh <container-name>:/tmp/reset-admin.sh
docker exec <container-name> sh /tmp/reset-admin.sh

# Or run the Node.js version
docker exec <container-name> node /app/reset-admin.js
```

### Using Docker Compose
```bash
# Run the Node.js script in the container
docker-compose exec bambu-web node reset-admin.js

# Or run the shell script
docker cp reset-admin.sh bambu-lab-integration:/tmp/reset-admin.sh
docker-compose exec bambu-web sh /tmp/reset-admin.sh
```

---

## Method 2: Restart the Container
The database.js file has code that automatically upgrades admin to superadmin on startup.

```bash
# Stop and restart your container
docker-compose restart
```

## Method 3: Execute SQL Directly

### Quick One-Liner
```bash
docker-compose exec bambu-web sqlite3 /app/data/bambu-lab.db "UPDATE users SET role = 'superadmin' WHERE username = 'admin'; SELECT username, role FROM users WHERE username = 'admin';"
```

### Using the SQL File
```bash
# Copy the SQL file to the container and execute it
docker cp fix-admin.sql <container-name>:/tmp/fix-admin.sql
docker-compose exec bambu-web sqlite3 /app/data/bambu-lab.db < /tmp/fix-admin.sql
```

## Method 4: Interactive Shell

```bash
# Get a shell in the container
docker-compose exec bambu-web sh

# Run SQLite
sqlite3 /app/data/bambu-lab.db

# In SQLite prompt, run:
UPDATE users SET role = 'superadmin', password = 'admin' WHERE username = 'admin';
SELECT username, role FROM users;
.exit
```

---

## Verify

Check the container logs after restart:
```bash
docker-compose logs | grep -i "admin\|superadmin"
```

You should see:
```
✓ Current admin user role: superadmin
```
or
```
✓ Upgraded admin user to superadmin
```

## Default Credentials
After running the reset script:
- **Username:** `admin`
- **Password:** `admin`
- **Role:** `superadmin`

⚠️ **Please change the password after logging in!**
