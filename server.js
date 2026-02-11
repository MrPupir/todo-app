const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const CONFIG = require('./config/config');
const errorHandler = require('./middleware/errorHandler');
const WebSocketManager = require('./services/websocketService');
const { startCleanupScheduler } = require('./services/cleanupService');

if (!fs.existsSync(CONFIG.UPLOAD_DIR)) {
    fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true });
}

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const boardRoutes = require('./routes/boardRoutes');
const columnRoutes = require('./routes/columnRoutes');
const taskRoutes = require('./routes/taskRoutes');
const uploadRoutes = require('./routes/uploadRoutes');

const app = express();
const server = http.createServer(app);
const wsManager = new WebSocketManager(server);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/boards', boardRoutes(wsManager));
app.use('/api/columns', columnRoutes(wsManager));
app.use('/api/tasks', taskRoutes(wsManager));
app.use('/uploads', uploadRoutes);

app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.use(errorHandler);

startCleanupScheduler();

mongoose.connect(CONFIG.MONGO_URI)
    .then(() => {
        server.listen(CONFIG.PORT, () => {
            console.log(`Server running on port ${CONFIG.PORT}`);
        });
    })
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });

process.on('SIGTERM', () => {
    server.close(() => {
        mongoose.connection.close();
    });
});
