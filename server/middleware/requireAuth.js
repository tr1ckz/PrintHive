const { db } = require('../../database');

// Session-based auth guard. Route handlers historically inline this check;
// new/extracted routes should use the middleware instead.
const requireAuth = (req, res, next) => {
  if (!req.session?.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
};

// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
  if (!req.session?.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const user = (await db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId));
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { requireAuth, requireAdmin };
