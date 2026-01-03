-- Fix admin user to be superadmin
UPDATE users SET role = 'superadmin' WHERE username = 'admin';

-- Verify the change
SELECT username, role FROM users WHERE username = 'admin';
