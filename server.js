const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.options('*', cors());
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dsa-mentor';

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB error:', err.message));

const problemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  topic: { type: String, required: true },
  difficulty: { type: String, required: true },
  date: { type: String, required: true },
  nextRevisionDate: { type: String, default: null },
  revisionLevel: { type: Number, default: 0 }
});

const Problem = mongoose.model('Problem', problemSchema);

app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is running' });
});

app.get('/api/problems', async (req, res) => {
  try {
    const problems = await Problem.find().sort({ date: -1 });
    res.json(problems);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/problems', async (req, res) => {
  try {
    const { name, topic, difficulty, date, nextRevisionDate, revisionLevel } = req.body;

    if (!name || !topic || !date) {
      return res.status(400).json({ error: 'Name, Topic, and Date are required.' });
    }

    const newProblem = new Problem({
      name,
      topic,
      difficulty,
      date,
      nextRevisionDate: nextRevisionDate || null,
      revisionLevel: revisionLevel || 0
    });

    const saved = await newProblem.save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/problems/:id', async (req, res) => {
  try {
    const { name, topic, difficulty, date, nextRevisionDate, revisionLevel } = req.body;
    const problem = await Problem.findById(req.params.id);

    if (!problem) {
      return res.status(404).json({ error: 'Problem not found.' });
    }

    problem.name = name || problem.name;
    problem.topic = topic || problem.topic;
    problem.difficulty = difficulty || problem.difficulty;
    problem.date = date || problem.date;
    problem.nextRevisionDate = nextRevisionDate !== undefined ? nextRevisionDate : problem.nextRevisionDate;
    problem.revisionLevel = revisionLevel !== undefined ? revisionLevel : problem.revisionLevel;

    await problem.save();
    res.json(problem);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/problems/:id', async (req, res) => {
  try {
    const problem = await Problem.findById(req.params.id);
    if (!problem) {
      return res.status(404).json({ error: 'Problem not found.' });
    }
    await Problem.findByIdAndDelete(req.params.id);
    res.json({ message: 'Problem deleted.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});