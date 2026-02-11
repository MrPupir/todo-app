require('dotenv').config();
const path = require('path');

const REQUIRED_ENV = ['MONGO_URI', 'JWT_SECRET'];
REQUIRED_ENV.forEach((key) => {
    if (!process.env[key]) {
        console.error(`Missing required environment variable: ${key}`);
        process.exit(1);
    }
});

module.exports = {
    PORT: process.env.PORT || 3000,
    MONGO_URI: process.env.MONGO_URI,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES: process.env.JWT_EXPIRES || '7d',
    UPLOAD_DIR: path.join(__dirname, '..', 'public', 'uploads'),
    MAX_FILE_SIZE: 10 * 1024 * 1024,
    CLEANUP_INTERVAL: process.env.CLEANUP_INTERVAL || 24 * 60 * 60 * 1000
};
