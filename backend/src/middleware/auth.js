function requireStudent(req, res, next) {
  if (!req.session || !req.session.student) {
    return res.status(401).json({ message: "Student login required" });
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ message: "Admin login required" });
  }
  return next();
}

module.exports = { requireStudent, requireAdmin };

