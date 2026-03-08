const mongoose = require('mongoose');

/* ══════════════════════════════════════
   REGISTRATION MODEL
══════════════════════════════════════ */
const memberSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  email:   { type: String, required: true, trim: true, lowercase: true },
  phone:   { type: String, required: true, trim: true },
  dept:    { type: String, required: true },
  college: { type: String, trim: true },
  year:    { type: String },
});

const registrationSchema = new mongoose.Schema({
  // Team
  teamName:    { type: String, required: true, trim: true },
  memberCount: { type: Number, required: true, min: 2, max: 4 },

  // Leader
  leader: {
    name:    { type: String, required: true, trim: true },
    email:   { type: String, required: true, trim: true, lowercase: true },
    phone:   { type: String, required: true, trim: true },
    dept:    { type: String, required: true },
    college: { type: String, required: true, trim: true },
    year:    { type: String, required: true },
  },

  // Other members
  members: [memberSchema],

  // Project
  project: {
    title:    { type: String, required: true, trim: true },
    category: { type: String, required: true },
    problem:  { type: String, required: true, trim: true },
    desc:     { type: String, required: true, trim: true },
    power:    { type: String, default: 'Standard (1 socket, 5A)' },
    special:  { type: String, default: '' },
  },

  // Payment
  payment: {
    id:     { type: String, required: true, trim: true },
    amount: { type: String, default: '₹300' },
    status: { type: String, enum: ['SUCCESS', 'PENDING', 'FAILED'], default: 'SUCCESS' },
    paidAt: { type: Date, default: Date.now },
  },

  // Admin fields
  attendance: { type: Boolean, default: false },
  checkedInAt: { type: Date, default: null },
  notes:       { type: String, default: '' },
  status:      { type: String, enum: ['confirmed', 'cancelled', 'waitlist'], default: 'confirmed' },

}, { timestamps: true });

// Indexes for fast lookup
registrationSchema.index({ 'leader.email': 1 });
registrationSchema.index({ 'payment.id': 1 });
registrationSchema.index({ teamName: 1 });
registrationSchema.index({ attendance: 1 });
registrationSchema.index({ createdAt: -1 });

/* ══════════════════════════════════════
   ADMIN MODEL
══════════════════════════════════════ */
const adminSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  name:     { type: String, required: true, trim: true },
  role:     { type: String, enum: ['superadmin', 'admin'], default: 'admin' },
  lastLogin: { type: Date, default: null },
}, { timestamps: true });

const Registration = mongoose.model('Registration', registrationSchema);
const Admin        = mongoose.model('Admin', adminSchema);

module.exports = { Registration, Admin };