require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./src/config/db');

const authRoutes = require('./src/routes/authRoutes');
const catalogRoutes = require('./src/routes/catalogRoutes');
const roomRoutes = require('./src/routes/roomRoutes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/rooms', roomRoutes);

// Centralized error handler — catches anything thrown/rejected in a route
// that wasn't already turned into a response (e.g. malformed ObjectId).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Room Designer API listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
