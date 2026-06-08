// src/routes/userRoutes.js
const express = require('express');
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');

const router = express.Router();

// Consulta de perfil próprio
router.get('/me', authMiddleware, userController.getUserProfile);

// Consulta de perfil por ID (com proteção IDOR)
router.get('/:id', authMiddleware, userController.getUserById);

// Checklist 1: PATCH /api/users/me/adult-content
router.patch('/me/adult-content', authMiddleware, userController.updateAdultContent);

// Rota genérica com proteção IDOR
router.put('/:id', authMiddleware, userController.updateUserById);

module.exports = router;