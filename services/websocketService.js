const ws = require('ws');
const jwt = require('jsonwebtoken');
const CONFIG = require('../config/config');
const { User, Board } = require('../models');

class WebSocketManager {
    constructor(server) {
        this.wss = new ws.Server({ server });
        this.setup();
    }

    setup() {
        this.wss.on('connection', (socket) => {
            socket.isAlive = true;
            socket.on('pong', () => socket.isAlive = true);
            socket.on('message', async (msg) => this.handleMessage(socket, msg));
            socket.on('close', () => this.handleDisconnect(socket));
        });

        setInterval(() => {
            this.wss.clients.forEach((socket) => {
                if (!socket.isAlive) return socket.terminate();
                socket.isAlive = false;
                socket.ping();
            });
        }, 30000);
    }

    async handleMessage(socket, msg) {
        try {
            const data = JSON.parse(msg);

            if (data.type === 'AUTH') {
                try {
                    const decoded = jwt.verify(data.token, CONFIG.JWT_SECRET);
                    const user = await User.findById(decoded.id).lean();
                    if (user) {
                        socket.username = user.username;
                        socket.displayName = user.displayName;
                        socket.avatar = user.avatar;
                        socket.send(JSON.stringify({ type: 'AUTH_OK' }));
                    }
                } catch {
                    socket.close();
                }
            } else if (data.type === 'JOIN_BOARD' && socket.username) {
                const hasAccess = await this.checkBoardAccess(data.boardId, socket.username);
                if (hasAccess) {
                    socket.boardId = data.boardId;
                    this.broadcastPresence(data.boardId);
                }
            } else if (data.type === 'LEAVE_BOARD') {
                const oldBoard = socket.boardId;
                socket.boardId = null;
                if (oldBoard) this.broadcastPresence(oldBoard);
            }
        } catch {}
    }

    handleDisconnect(socket) {
        if (socket.boardId) this.broadcastPresence(socket.boardId);
    }

    async checkBoardAccess(boardId, username) {
        const board = await Board.findById(boardId).lean();
        if (!board) return false;
        if (board.owner === username) return true;
        return board.members.some(m => m.user === username);
    }

    broadcastToBoard(boardId, data) {
        const boardIdStr = boardId.toString();
        this.wss.clients.forEach(c => {
            if (c.readyState === ws.OPEN && c.boardId === boardIdStr) {
                c.send(JSON.stringify(data));
            }
        });
    }

    sendToUser(username, data) {
        this.wss.clients.forEach(c => {
            if (c.readyState === ws.OPEN && c.username === username) {
                c.send(JSON.stringify(data));
            }
        });
    }

    broadcastPresence(boardId) {
        const boardIdStr = boardId.toString();
        const activeUsers = new Map();

        this.wss.clients.forEach(c => {
            if (c.readyState === ws.OPEN && c.boardId === boardIdStr && c.username) {
                if (!activeUsers.has(c.username)) {
                    activeUsers.set(c.username, {
                        username: c.username,
                        displayName: c.displayName || c.username,
                        avatar: c.avatar
                    });
                }
            }
        });

        this.broadcastToBoard(boardIdStr, {
            type: 'PRESENCE',
            users: Array.from(activeUsers.values())
        });
    }
}

module.exports = WebSocketManager;
