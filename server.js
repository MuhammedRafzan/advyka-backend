require('dotenv').config();
const express    = require('express');
const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const path       = require('path');
const { Parser } = require('json2csv');
const { Registration, Admin } = require('./models');

const app  = express();
const PORT = process.env.PORT || 5000;
const JWT  = process.env.JWT_SECRET || 'dev_secret_change_this';

/* ══════════════════════════════════════
   MIDDLEWARE
══════════════════════════════════════ */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (frontend + admin)
app.use(express.static(path.join(__dirname, 'public')));

/* ══════════════════════════════════════
   DB CONNECTION
══════════════════════════════════════ */
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/advyka2026')
  .then(async () => {
    console.log('✅ MongoDB connected');
    await seedAdmin();
  })
  .catch(err => console.error('❌ MongoDB error:', err));

/* ══════════════════════════════════════
   SEED ADMIN ON FIRST RUN
══════════════════════════════════════ */
async function seedAdmin() {
  const exists = await Admin.findOne({ email: process.env.ADMIN_EMAIL || 'admin@iedccep.com' });
  if (!exists) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@2026', 12);
    await Admin.create({
      email:    process.env.ADMIN_EMAIL    || 'admin@iedccep.com',
      password: hash,
      name:     'IEDC Admin',
      role:     'superadmin',
    });
    console.log('✅ Admin seeded — email:', process.env.ADMIN_EMAIL || 'admin@iedccep.com');
  }
}

/* ══════════════════════════════════════
   AUTH MIDDLEWARE
══════════════════════════════════════ */
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT);
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/* ══════════════════════════════════════
   PUBLIC API
══════════════════════════════════════ */

// POST /api/register — submit registration from frontend
app.post('/api/register', async (req, res) => {
  try {
    const d = req.body;

    // Validate required fields
    if (!d.teamName || !d.leader?.name || !d.leader?.email || !d.payment?.id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Prevent duplicate payment ID
    const dup = await Registration.findOne({ 'payment.id': d.payment.id });
    if (dup) {
      return res.status(409).json({ error: 'Payment ID already used', registrationId: dup._id });
    }

    const reg = await Registration.create({
      teamName:    d.teamName,
      memberCount: d.memberCount || (d.members?.length || 0) + 1,
      leader:      d.leader,
      members:     d.members || [],
      project:     d.project,
      payment:     d.payment,
    });

    res.status(201).json({
      success:        true,
      registrationId: reg._id,
      message:        'Registration successful',
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

// GET /api/health — health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

/* ══════════════════════════════════════
   ADMIN AUTH
══════════════════════════════════════ */

// POST /api/admin/login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, admin.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    await Admin.findByIdAndUpdate(admin._id, { lastLogin: new Date() });

    const token = jwt.sign(
      { id: admin._id, email: admin.email, name: admin.name, role: admin.role },
      JWT,
      { expiresIn: '12h' }
    );

    res.json({ token, admin: { name: admin.name, email: admin.email, role: admin.role } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/me
app.get('/api/admin/me', auth, (req, res) => res.json({ admin: req.admin }));

/* ══════════════════════════════════════
   ADMIN — REGISTRATIONS
══════════════════════════════════════ */

// GET /api/admin/registrations
app.get('/api/admin/registrations', auth, async (req, res) => {
  try {
    const page     = parseInt(req.query.page)  || 1;
    const limit    = parseInt(req.query.limit) || 25;
    const search   = req.query.search   || '';
    const status   = req.query.status   || '';
    const attended = req.query.attendance;
    const category = req.query.category || '';

    const filter = {};

    if (search) {
      filter.$or = [
        { teamName:        { $regex: search, $options: 'i' } },
        { 'leader.name':   { $regex: search, $options: 'i' } },
        { 'leader.email':  { $regex: search, $options: 'i' } },
        { 'leader.phone':  { $regex: search, $options: 'i' } },
        { 'leader.college':{ $regex: search, $options: 'i' } },
        { 'project.title': { $regex: search, $options: 'i' } },
        { 'payment.id':    { $regex: search, $options: 'i' } },
      ];
    }
    if (status)   filter.status     = status;
    if (category) filter['project.category'] = category;
    if (attended === 'true')  filter.attendance = true;
    if (attended === 'false') filter.attendance = false;

    const total = await Registration.countDocuments(filter);
    const regs  = await Registration.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({ total, page, pages: Math.ceil(total / limit), limit, data: regs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/registrations/:id
app.get('/api/admin/registrations/:id', auth, async (req, res) => {
  try {
    const reg = await Registration.findById(req.params.id).lean();
    if (!reg) return res.status(404).json({ error: 'Not found' });
    res.json(reg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/registrations/:id
app.put('/api/admin/registrations/:id', auth, async (req, res) => {
  try {
    const allowed = [
      'teamName', 'leader', 'members', 'project',
      'payment', 'attendance', 'checkedInAt', 'notes', 'status'
    ];
    const update = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });

    const reg = await Registration.findByIdAndUpdate(
      req.params.id, { $set: update }, { new: true, runValidators: true }
    );
    if (!reg) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, data: reg });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/admin/registrations/:id/attendance
app.patch('/api/admin/registrations/:id/attendance', auth, async (req, res) => {
  try {
    const reg = await Registration.findById(req.params.id);
    if (!reg) return res.status(404).json({ error: 'Not found' });

    reg.attendance  = req.body.attendance !== undefined ? req.body.attendance : !reg.attendance;
    reg.checkedInAt = reg.attendance ? new Date() : null;
    await reg.save();

    res.json({ success: true, attendance: reg.attendance, checkedInAt: reg.checkedInAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/registrations/:id
app.delete('/api/admin/registrations/:id', auth, async (req, res) => {
  try {
    const reg = await Registration.findByIdAndDelete(req.params.id);
    if (!reg) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, message: 'Registration deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/registrations — bulk delete
app.delete('/api/admin/registrations', auth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    const result = await Registration.deleteMany({ _id: { $in: ids } });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════
   ADMIN — STATS DASHBOARD
══════════════════════════════════════ */
app.get('/api/admin/stats', auth, async (req, res) => {
  try {
    const [
      total, confirmed, attended, today,
      byCategory, byCollege, byDept, recentRegs
    ] = await Promise.all([
      Registration.countDocuments(),
      Registration.countDocuments({ status: 'confirmed' }),
      Registration.countDocuments({ attendance: true }),
      Registration.countDocuments({
        createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)) }
      }),
      Registration.aggregate([
        { $group: { _id: '$project.category', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Registration.aggregate([
        { $group: { _id: '$leader.college', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 10 }
      ]),
      Registration.aggregate([
        { $group: { _id: '$leader.dept', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Registration.find().sort({ createdAt: -1 }).limit(5)
        .select('teamName leader.name leader.college project.title createdAt attendance').lean()
    ]);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const daily = await Registration.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 }
      }},
      { $sort: { _id: 1 } }
    ]);

    res.json({
      total, confirmed, attended,
      notAttended: confirmed - attended,
      today,
      byCategory, byCollege, byDept,
      recentRegs, daily,
      totalRevenue: `₹${(total * 300).toLocaleString('en-IN')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════
   ADMIN — EXPORT CSV
══════════════════════════════════════ */
app.get('/api/admin/export/csv', auth, async (req, res) => {
  try {
    const regs = await Registration.find().sort({ createdAt: -1 }).lean();

    const rows = regs.map(r => ({
      'Registration ID':   r._id.toString(),
      'Team Name':         r.teamName,
      'Team Size':         r.memberCount,
      'Status':            r.status,
      'Attendance':        r.attendance ? 'Present' : 'Absent',
      'Checked In At':     r.checkedInAt ? new Date(r.checkedInAt).toLocaleString('en-IN') : '',
      'Leader Name':       r.leader.name,
      'Leader Email':      r.leader.email,
      'Leader Phone':      r.leader.phone,
      'Leader Dept':       r.leader.dept,
      'Leader College':    r.leader.college,
      'Leader Year':       r.leader.year,
      'Member Names':      r.members.map(m => m.name).join(' | '),
      'Member Emails':     r.members.map(m => m.email).join(' | '),
      'Member Phones':     r.members.map(m => m.phone).join(' | '),
      'Project Title':     r.project.title,
      'Project Category':  r.project.category,
      'Problem Statement': r.project.problem,
      'Description':       r.project.desc,
      'Power Requirement': r.project.power,
      'Special Needs':     r.project.special,
      'Payment ID':        r.payment.id,
      'Amount Paid':       r.payment.amount,
      'Payment Status':    r.payment.status,
      'Notes':             r.notes || '',
      'Registered At':     new Date(r.createdAt).toLocaleString('en-IN'),
    }));

    const parser = new Parser({ fields: Object.keys(rows[0] || {}) });
    const csv    = parser.parse(rows);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=advyka2026_registrations_${Date.now()}.csv`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════
   ADMIN — CHANGE PASSWORD
══════════════════════════════════════ */
app.put('/api/admin/password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password too short' });

    const admin = await Admin.findById(req.admin.id);
    const match = await bcrypt.compare(currentPassword, admin.password);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });

    admin.password = await bcrypt.hash(newPassword, 12);
    await admin.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════
   SERVE FRONTEND (MUST BE LAST!)
══════════════════════════════════════ */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Catch-all for frontend routing (SPA support)
app.get('*', (req, res) => {
  // Don't catch API routes
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ══════════════════════════════════════
   START
══════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(`🚀 Advyka 2026 API running on http://localhost:${PORT}`);
  console.log(`📋 Admin panel: http://localhost:${PORT}/admin`);
});