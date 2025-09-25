const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'GetContractorNow API is running',
    timestamp: new Date().toISOString()
  });
});

// Lead submission endpoint
app.post('/api/leads/submit', async (req, res) => {
  try {
    const leadData = req.body;
    console.log('Received lead:', leadData);
    
    // TODO: Add scoring logic later
    
    res.json({ 
      success: true, 
      message: 'Lead received successfully',
      leadId: 'temp-' + Date.now()
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});