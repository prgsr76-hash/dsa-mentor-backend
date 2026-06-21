require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const otpGenerator = require('otp-generator');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json());

// ... rest of your code
// ========== MONGODB CONNECTION ==========
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dsa-mentor';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.log('❌ MongoDB error:', err.message));

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_here';

// ========== EMAIL CONFIG ==========
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER || 'your_email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your_app_password_here'
  }
});

// ========== SCHEMAS ==========

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isVerified: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true },
  otp: { type: String, required: true },
  type: { type: String, enum: ['verify', 'reset'], required: true },
  expiresAt: { type: Date, default: Date.now, expires: 300 }
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

// ========== AUTH MIDDLEWARE ==========
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

// ========== SEND OTP FUNCTION ==========
async function sendOTP(email, otp, type) {
  const subject = type === 'verify' ? 'Verify Your DSA Mentor Account' : 'Reset Your DSA Mentor Password';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background: #0a0515; color: white; border-radius: 16px; border: 1px solid rgba(139,92,246,0.2);">
      <h1 style="text-align: center; color: #8b5cf6;">DSA Mentor</h1>
      <p style="text-align: center; color: #b0a0d0;">${type === 'verify' ? 'Verify your email address' : 'Reset your password'}</p>
      <h1 style="text-align: center; color: #8b5cf6; font-size: 40px; letter-spacing: 8px;">${otp}</h1>
      <p style="text-align: center; font-size: 12px; color: #666;">This OTP will expire in 5 minutes.</p>
    </div>
  `;
  await transporter.sendMail({
    from: `"DSA Mentor" <${process.env.EMAIL_USER || 'your_email@gmail.com'}>`,
    to: email,
    subject: subject,
    html: html
  });
}

// ========== TEST ROUTE ==========
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is running' });
});

// ========== AUTH ROUTES ==========

// 1. Send OTP for Registration
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    await OTP.deleteMany({ email, type: 'verify' });

    const otp = otpGenerator.generate(6, { digits: true, lowerCaseAlphabets: false, upperCaseAlphabets: false, specialChars: false });
    await OTP.create({ email, otp, type: 'verify' });
    await sendOTP(email, otp, 'verify');

    res.json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// 2. Register with OTP
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, otp } = req.body;

    if (!name || !email || !password || !otp) {
      return res.status(400).json({ error: 'All fields including OTP are required' });
    }

    const otpRecord = await OTP.findOne({ email, otp, type: 'verify' });
    if (!otpRecord) return res.status(400).json({ error: 'Invalid or expired OTP' });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashed, isVerified: true });
    await user.save();

    await OTP.deleteMany({ email, type: 'verify' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user._id, name, email } });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Login (only if verified)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.isVerified === false) return res.status(403).json({ error: 'Please verify your email first' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Forgot Password - Send OTP
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'Email not found' });

    await OTP.deleteMany({ email, type: 'reset' });

    const otp = otpGenerator.generate(6, { digits: true, lowerCaseAlphabets: false, upperCaseAlphabets: false, specialChars: false });
    await OTP.create({ email, otp, type: 'reset' });
    await sendOTP(email, otp, 'reset');

    res.json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// 5. Reset Password with OTP
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) return res.status(400).json({ error: 'All fields required' });

    const otpRecord = await OTP.findOne({ email, otp, type: 'reset' });
    if (!otpRecord) return res.status(400).json({ error: 'Invalid or expired OTP' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await User.findOneAndUpdate({ email }, { password: hashed });
    await OTP.deleteMany({ email, type: 'reset' });

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

// ========== PROBLEM ROUTES ==========

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

    if (nextLevel === 1) {
      nextDate.setDate(nextDate.getDate() + 1);
    } else if (nextLevel === 2) {
      nextDate.setDate(nextDate.getDate() + 7);
    } else if (nextLevel === 3) {
      nextDate.setDate(nextDate.getDate() + 30);
    } else {
      nextLevel = 4;
      nextDate = null;
    }

    problem.revisionLevel = nextLevel;
    problem.nextRevisionDate = nextDate ? nextDate.toISOString().split('T')[0] : null;

    await problem.save();
    res.json(problem);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});