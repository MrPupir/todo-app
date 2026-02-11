const express = require('express');
const router = express.Router();
const catchAsync = require('../utils/catchAsync');
const uploadController = require('../controllers/uploadController');

router.get('/:filename', catchAsync(uploadController.downloadFile));

module.exports = router;
