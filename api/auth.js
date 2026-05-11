// auth.js is no longer needed for Google SSO
// Token verification is now handled in query.js via Firebase ID tokens
module.exports = function handler(req, res) {
  res.status(410).json({ message: 'Password auth replaced by Google SSO' });
};
