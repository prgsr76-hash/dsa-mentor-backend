
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 5000;

// ===== CORS =====
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('DSA Mentor API is running');
});
// ===== MONGODB =====
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dsa-mentor';
mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 5000,  // Fail faster
  socketTimeoutMS: 10000,
  connectTimeoutMS: 5000
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB error:', err.message));
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_here';

// ===== GMAIL SMTP TRANSPORTER =====
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: { rejectUnauthorized: false }
});

// ===== SCHEMAS =====

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isVerified: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

const otpSchema = new mongoose.Schema({
  user_id: { type: String, required: false },
  email: { type: String, required: true },
  otp: { type: String, required: true },
  purpose: { type: String, enum: ['verify', 'reset'], required: true },
  expires_at: { type: Date, required: true },
  verified: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});
const OTP = mongoose.model('OTP', otpSchema);

const problemSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  topic: { type: String, required: true },
  difficulty: { type: String, required: true },
  date: { type: String, required: true },
  nextRevisionDate: { type: String, default: null },
  revisionLevel: { type: Number, default: 0 }
});
const Problem = mongoose.model('Problem', problemSchema);

// ===== AUTH MIDDLEWARE =====
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    req.userId = decoded.id;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ============================================================
// OTP FUNCTIONS (Like Python)
// ============================================================

// 1. generate_otp() - Like Python
function generateOTP(length = 6) {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 2. hash_otp() - Like Python
function hashOTP(plain) {
  return bcrypt.hashSync(plain, 10);
}

// 3. verify_otp() - Like Python
function verifyOTP(plain, hashed) {
  return bcrypt.compareSync(plain, hashed);
}

// 4. create_otp_record() - Like Python
async function createOTPRecord(email, purpose, expiryMinutes = 5) {
  const plain = generateOTP();
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
  const hashedOTP = hashOTP(plain);
  
  await OTP.create({
    email: email.toLowerCase().trim(),
    otp: hashedOTP,
    purpose: purpose,
    expires_at: expiresAt,
    verified: false
  });
  
  return plain;
}

// 5. validate_latest_otp() - Like Python
async function validateLatestOTP(email, purpose, plainOTP) {
  const emailL = email.toLowerCase().trim();
  
  const row = await OTP.findOne({
    email: emailL,
    purpose: purpose,
    verified: false
  }).sort({ created_at: -1 });
  
  if (!row || row.expires_at < new Date()) {
    return null;
  }
  
  if (!verifyOTP(plainOTP, row.otp)) {
    return null;
  }
  
  return row;
}

// 6. mark_otp_used() - Like Python
async function markOTPUsed(row) {
  row.verified = true;
  await row.save();
}

// ============================================================
// SEND OTP EMAIL (Gmail SMTP)
// ============================================================

async function sendOTPEmail(email, otp, purpose) {
  const titles = {
    verify: 'Verify Your DSA Mentor Account',
    reset: 'Reset Your Password — Verification Code'
  };
  const subject = titles[purpose] || 'Your Verification Code';
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background: #0a0515; color: white; border-radius: 16px; border: 1px solid rgba(139,92,246,0.2);">
      <h1 style="text-align: center; color: #8b5cf6;">DSA Mentor</h1>
      <p style="text-align: center; color: #b0a0d0;">${purpose === 'verify' ? 'Verify your email address' : 'Reset your password'}</p>
      <p style="text-align: center; font-size: 14px; color: #b0a0d0;">Your one-time code is:</p>
      <h1 style="text-align: center; color: #8b5cf6; font-size: 40px; letter-spacing: 8px;">${otp}</h1>
      <p style="text-align: center; font-size: 12px; color: #666;">This code expires in ${process.env.OTP_EXPIRY_MINUTES || 5} minutes.</p>
      <p style="text-align: center; font-size: 12px; color: #666;">If you did not request this, you can ignore this email.</p>
    </div>
  `;
  
  try {
    const info = await transporter.sendMail({
      from: `"DSA Mentor" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: subject,
      html: html
    });
    console.log('✅ Email sent:', info.response);
    return true;
  } catch (error) {
    console.error('❌ Email error:', error);
    throw new Error('Failed to send email');
  }
}

// ===== ROUTES =====

// Test
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is running' });
});

// 1. Send OTP (Like Python's create_otp_record)
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Delete old OTPs
    await OTP.deleteMany({ email: email.toLowerCase().trim(), purpose: 'verify', verified: false });
    
    // Create OTP record (like Python)
    const plainOTP = await createOTPRecord(email, 'verify');
    
    // Send email
    await sendOTPEmail(email, plainOTP, 'verify');
    
    res.json({ message: 'OTP sent successfully' });
    
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// 2. Register (Like Python's validate_latest_otp)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, otp } = req.body;
    
    if (!name || !email || !password || !otp) {
      return res.status(400).json({ error: 'All fields including OTP are required' });
    }
    
    // Validate OTP (like Python)
    const otpRecord = await validateLatestOTP(email, 'verify', otp);
    if (!otpRecord) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }
    
    // Mark OTP as used (like Python)
    await markOTPUsed(otpRecord);
    
    // Create user
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email: email.toLowerCase().trim(), password: hashed, isVerified: true });
    await user.save();
    
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user._id, name, email: user.email } });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.isVerified) return res.status(403).json({ error: 'Please verify your email first' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Forgot Password - Send OTP
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ error: 'Email not found' });
    
    await OTP.deleteMany({ email: email.toLowerCase().trim(), purpose: 'reset', verified: false });
    
    const plainOTP = await createOTPRecord(email, 'reset');
    await sendOTPEmail(email, plainOTP, 'reset');
    
    res.json({ message: 'OTP sent successfully' });
    
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// 5. Reset Password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'All fields required' });
    }
    
    const otpRecord = await validateLatestOTP(email, 'reset', otp);
    if (!otpRecord) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }
    
    await markOTPUsed(otpRecord);
    
    const hashed = await bcrypt.hash(newPassword, 10);
    await User.findOneAndUpdate({ email: email.toLowerCase().trim() }, { password: hashed });
    
    res.json({ message: 'Password reset successfully' });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Get current user
app.get('/api/auth/me', auth, async (req, res) => {
  const user = await User.findById(req.userId).select('-password');
  res.json({ user });
});

// ===== PROBLEM ROUTES =====

app.get('/api/problems', auth, async (req, res) => {
  try {
    const problems = await Problem.find({ userId: req.userId }).sort({ date: -1 });
    res.json(problems);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/problems', auth, async (req, res) => {
  try {
    const { name, topic, difficulty, date } = req.body;
    if (!name || !topic || !date) {
      return res.status(400).json({ error: 'Name, Topic, and Date are required.' });
    }
    const addedDate = new Date(date);
    const nextDate = new Date(addedDate);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextRevisionDate = nextDate.toISOString().split('T')[0];
    const newProblem = new Problem({
      userId: req.userId,
      name,
      topic,
      difficulty,
      date,
      nextRevisionDate,
      revisionLevel: 1
    });
    const saved = await newProblem.save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/problems/:id', auth, async (req, res) => {
  try {
    const problem = await Problem.findOne({ _id: req.params.id, userId: req.userId });
    if (!problem) return res.status(404).json({ error: 'Problem not found.' });
    await Problem.findByIdAndDelete(req.params.id);
    res.json({ message: 'Problem deleted.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/problems/:id/review', auth, async (req, res) => {
  try {
    const problem = await Problem.findOne({ _id: req.params.id, userId: req.userId });
    if (!problem) return res.status(404).json({ error: 'Problem not found.' });
    let nextLevel = problem.revisionLevel + 1;
    let nextDate = new Date();
    if (nextLevel === 1) nextDate.setDate(nextDate.getDate() + 1);
    else if (nextLevel === 2) nextDate.setDate(nextDate.getDate() + 7);
    else if (nextLevel === 3) nextDate.setDate(nextDate.getDate() + 30);
    else { nextLevel = 4; nextDate = null; }
    problem.revisionLevel = nextLevel;
    problem.nextRevisionDate = nextDate ? nextDate.toISOString().split('T')[0] : null;
    await problem.save();
    res.json(problem);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== START SERVER =====
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;