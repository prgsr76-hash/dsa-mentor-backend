const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection (Local for now)
const MONGO_URI = 'mongodb://prgsr76_db_user:R2jG9hdcjID0wSpi@ac-pdq95xu-shard-00-00.yxgj8ef.mongodb.net:27017,ac-pdq95xu-shard-00-01.yxgj8ef.mongodb.net:27017,ac-pdq95xu-shard-00-02.yxgj8ef.mongodb.net:27017/?ssl=true&replicaSet=atlas-x3pnc1-shard-0&authSource=admin&appName=Cluster0';

console.log("⏳ Connecting to MongoDB...");
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => {
    console.log('❌ MongoDB Connection ERROR:');
    console.log(err.message);  // This prints the REAL reason
  });

// Database Schema
const problemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  topic: { type: String, required: true },
  difficulty: { type: String, required: true },
  date: { type: String, required: true }
});

const Problem = mongoose.model('Problem', problemSchema);

// ---------- API ROUTES ----------

// GET all problems
app.get('/api/problems', async (req, res) => {
  try {
    const problems = await Problem.find().sort({ date: -1 });
    res.json(problems);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST a new problem
app.post('/api/problems', async (req, res) => {
  try {
    const { name, topic, difficulty, date } = req.body;
    if (!name || !topic || !date) {
      return res.status(400).json({ error: 'Name, Topic, and Date are required' });
    }
    const newProblem = new Problem({ name, topic, difficulty, date });
    const saved = await newProblem.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE a problem
app.delete('/api/problems/:id', async (req, res) => {
  try {
    await Problem.findByIdAndDelete(req.params.id);
    res.json({ message: 'Problem deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});