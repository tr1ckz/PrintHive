# Fix Admin User to Superadmin

If the admin user is not showing as superadmin, run one of these commands:

## Option 1: Restart the container (easiest)
The database.js file has code that automatically upgrades admin to superadmin on startup.

```bash
# Stop and restart your container
docker-compose restart
```

## Option 2: Execute SQL directly in the container

```bash
# Access the SQLite database in the running container
docker-compose exec <your-service-name> sqlite3 /app/data/bambu-lab.db "UPDATE users SET role = 'superadmin' WHERE username = 'admin'; SELECT username, role FROM users WHERE username = 'admin';"
```

## Option 3: Use the SQL file

```bash
# Copy the SQL file to the container and execute it
docker cp fix-admin.sql <container-name>:/tmp/fix-admin.sql
docker-compose exec <your-service-name> sqlite3 /app/data/bambu-lab.db < /tmp/fix-admin.sql
```

## Option 4: Interactive shell

```bash
# Get a shell in the container
docker-compose exec <your-service-name> sh

# Run SQLite
sqlite3 /app/data/bambu-lab.db

# In SQLite prompt, run:
UPDATE users SET role = 'superadmin' WHERE username = 'admin';
SELECT username, role FROM users;
.exit
```

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
