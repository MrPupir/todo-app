const express = require('express');
const catchAsync = require('../utils/catchAsync');
const authenticate = require('../middleware/auth');
const boardController = require('../controllers/boardController');

const injectWsManager = (wsManager) => (req, res, next) => {
    req.wsManager = wsManager;
    next();
};

const createRoutes = (wsManager) => {
    const router = express.Router();
    
    router.get('/', authenticate, catchAsync(boardController.getBoards));
    router.post('/create', authenticate, injectWsManager(wsManager), catchAsync(boardController.createBoard));
    router.delete('/delete', authenticate, injectWsManager(wsManager), catchAsync(boardController.deleteBoard));
    router.put('/rename', authenticate, injectWsManager(wsManager), catchAsync(boardController.renameBoard));
    router.post('/invite', authenticate, injectWsManager(wsManager), catchAsync(boardController.inviteUser));
    router.put('/role', authenticate, injectWsManager(wsManager), catchAsync(boardController.changeRole));
    router.delete('/member', authenticate, injectWsManager(wsManager), catchAsync(boardController.removeMember));
    
    router.get('/data', authenticate, catchAsync(boardController.getBoardData));
    
    return router;
};

module.exports = createRoutes;