# Quick Fix: Reset Admin User to Superadmin

## 🚀 Fastest Method (One Command)

Run this single command to fix the admin user in your Docker container:

```bash
docker exec bambu-lab-integration sqlite3 /app/data/bambu-lab.db "UPDATE users SET role = 'superadmin', password = 'admin' WHERE username = 'admin'; SELECT username, role FROM users WHERE username = 'admin';"
```

**If using docker-compose:**
```bash
docker-compose exec bambu-web sqlite3 /app/data/bambu-lab.db "UPDATE users SET role = 'superadmin', password = 'admin' WHERE username = 'admin'; SELECT username, role FROM users WHERE username = 'admin';"
```

### What this does:
1. Updates the admin user to have `superadmin` role
2. Resets password to `admin`
3. Shows you the updated user info

### After running:
- Username: `admin`
- Password: `admin`
- Role: `superadmin`

---

## 🔧 Alternative: Use the Reset Script

The script shows more info and handles edge cases:

```bash
# Copy the script to your container
docker cp reset-admin.sh bambu-lab-integration:/tmp/reset-admin.sh

# Run it
docker exec bambu-lab-integration sh /tmp/reset-admin.sh
```

**Or use the Node.js version (better output):**
```bash
docker exec bambu-lab-integration node /app/reset-admin.js
```

---

## 📋 Need to find your container name?

```bash
# List all running containers
docker ps

# Look for a name like "bambu-lab-integration" or "bambu-lab"
```

---

## ✅ Verify it worked

After running any method above, you should see output like:
```
admin|superadmin
```

Now you can log in with:
- Username: `admin`
- Password: `admin`

**⚠️ Change your password after logging in!**

---

For more methods and troubleshooting, see [FIX-ADMIN-USER.md](FIX-ADMIN-USER.md)
