const mongoose = require('mongoose');

const HistorySchema = new mongoose.Schema({
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
    text: String,
    user: String,
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('History', HistorySchema);
