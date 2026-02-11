const mongoose = require('mongoose');

const ColumnSchema = new mongoose.Schema({
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
    title: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    created: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Column', ColumnSchema);
