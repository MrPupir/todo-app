const mongoose = require('mongoose');

const BoardSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    owner: { type: String, required: true },
    members: [{
        user: String,
        role: { type: String, enum: ['view', 'comment', 'edit'], default: 'comment' }
    }],
    created: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Board', BoardSchema);
